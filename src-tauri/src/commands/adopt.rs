//! Surfacing and importing hosts-file lines that live outside the
//! app-managed block (added manually or by another tool).

use tauri::{AppHandle, State};

use super::{draft_to_entry, prune_history, write_content_to_hosts_file, WriteResult};
use crate::hosts_parser;
use crate::models::{DiffPreview, Entry, EntryDraft};
use crate::state::AppState;
use crate::store;
use crate::validate;

/// Lists plain hostname entries that live outside the app-managed block
/// (added manually or by another tool) and are safe to adopt. Re-read from
/// disk on every call rather than cached, since they're not tracked in the
/// DB until adopted.
#[tauri::command]
pub fn list_unmanaged_entries(state: State<AppState>) -> Result<Vec<hosts_parser::UnmanagedEntry>, String> {
    let content = std::fs::read_to_string(&state.hosts_path).map_err(|e| format!("Failed to read the hosts file: {e}"))?;
    Ok(hosts_parser::list_unmanaged_entries(&content))
}

fn find_unmanaged_entry(content: &str, id: &str) -> Result<hosts_parser::UnmanagedEntry, String> {
    hosts_parser::list_unmanaged_entries(content)
        .into_iter()
        .find(|u| u.id == id)
        .ok_or_else(|| "That entry is no longer available to adopt \u{2014} reload and try again.".to_string())
}

fn draft_for_unmanaged(unmanaged: &hosts_parser::UnmanagedEntry) -> EntryDraft {
    // `ip.uid` becomes the `ip_candidates` table's primary key, which is
    // keyed table-wide (not scoped per entry) — it must be unique across
    // every adopted entry, not just within this one, or adopting a second
    // entry in the same session collides on insert.
    let uid = uuid::Uuid::new_v4().to_string();
    EntryDraft {
        id: None,
        hostname: unmanaged.hostname.clone(),
        comment: unmanaged.comment.clone(),
        group: String::new(),
        enabled: true,
        active_uid: uid.clone(),
        ips: vec![crate::models::IpDraft {
            uid,
            label: "Imported".to_string(),
            ip: unmanaged.ip.clone(),
        }],
    }
}

/// Preview for moving an unmanaged entry into the app-managed block. Reads
/// straight from disk; writes nothing.
#[tauri::command]
pub fn preview_adopt(state: State<AppState>, id: String) -> Result<DiffPreview, String> {
    let content = std::fs::read_to_string(&state.hosts_path).map_err(|e| format!("Failed to read the hosts file: {e}"))?;
    let unmanaged = find_unmanaged_entry(&content, &id)?;
    let draft = draft_for_unmanaged(&unmanaged);
    let after = draft_to_entry("pending", &draft);

    Ok(DiffPreview {
        mode: "adopt".to_string(),
        is_new: true,
        is_removal: false,
        title: format!("Adopt \u{201c}{}\u{201d}", after.hostname),
        subtitle: "Move this entry from outside the managed block into Reroute.".to_string(),
        before_line: None,
        after_line: Some(hosts_parser::build_line(&after)),
        is_shadow_domain: validate::is_shadow_domain(&after.hostname),
        restore_target_id: None,
        history_before: None,
        history_after: None,
        diff_lines: None,
        diagnostics: None,
    })
}

/// Moves an unmanaged entry into the app-managed block in one write:
/// inserts it as a new DB entry, removes its original raw line, and
/// regenerates the hosts file. Re-verifies the line still matches what was
/// listed before removing it, in case the file changed out from under us.
#[tauri::command]
pub fn confirm_adopt(app: AppHandle, state: State<AppState>, id: String) -> Result<WriteResult, String> {
    let mut conn = state.conn.lock().unwrap();
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let current = std::fs::read_to_string(&state.hosts_path).map_err(|e| format!("Failed to read the hosts file: {e}"))?;
    let unmanaged = find_unmanaged_entry(&current, &id)?;
    let line_index: usize = unmanaged
        .id
        .parse()
        .map_err(|_| "Invalid unmanaged entry id.".to_string())?;

    let draft = draft_for_unmanaged(&unmanaged);
    let after_entry = store::insert_entry(&tx, &draft).map_err(|e| e.to_string())?;
    let entries = store::list_entries(&tx).map_err(|e| e.to_string())?;

    let parsed = hosts_parser::remove_unmanaged_line(
        &current,
        line_index,
        &unmanaged.ip,
        &unmanaged.hostname,
        &unmanaged.comment,
    )
    .ok_or_else(|| "The hosts file changed since this was listed \u{2014} reload and try again.".to_string())?;
    let new_content = hosts_parser::render(&parsed, &entries);

    let (outcome, backup_path) = write_content_to_hosts_file(&app, &state, &new_content, false)?;
    if !outcome.write_ok {
        return Err("Failed to write the hosts file.".to_string());
    }

    store::insert_history(
        &tx,
        &after_entry.hostname,
        "Adopted entry",
        Some(&after_entry.id),
        None,
        Some(&after_entry),
        Some(&backup_path),
    )
    .map_err(|e| e.to_string())?;
    prune_history(&tx)?;
    tx.commit().map_err(|e| e.to_string())?;
    crate::tray::sync(&app, &entries);

    Ok(WriteResult {
        entry: Some(after_entry),
        flush_ok: None,
        flush_message: None,
    })
}

/// Moves several unmanaged entries into the app-managed block in a single
/// write, for the first-run onboarding checklist. All-or-nothing: if any id
/// can no longer be resolved (the file changed since it was listed) or the
/// write fails, nothing is adopted.
#[tauri::command]
pub fn confirm_adopt_many(app: AppHandle, state: State<AppState>, ids: Vec<String>) -> Result<Vec<Entry>, String> {
    if ids.is_empty() {
        return Err("No entries selected.".to_string());
    }

    let mut conn = state.conn.lock().unwrap();
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let current = std::fs::read_to_string(&state.hosts_path).map_err(|e| format!("Failed to read the hosts file: {e}"))?;
    let all_unmanaged = hosts_parser::list_unmanaged_entries(&current);

    let stale_err = || "The hosts file changed since this was listed \u{2014} reload and try again.".to_string();
    let mut resolved = Vec::with_capacity(ids.len());
    for id in &ids {
        let unmanaged = all_unmanaged.iter().find(|u| &u.id == id).cloned().ok_or_else(stale_err)?;
        resolved.push(unmanaged);
    }

    // Captured before inserting the new entries below: the managed block's
    // line count must stay fixed while we remove raw lines by their
    // original absolute index, or later indices would drift.
    let pre_adopt_entries = store::list_entries(&tx).map_err(|e| e.to_string())?;

    // Insert in the order the caller selected them; the resulting order_index
    // (and therefore hosts-file position) reflects that.
    let mut after_entries = Vec::with_capacity(resolved.len());
    for unmanaged in &resolved {
        let draft = draft_for_unmanaged(unmanaged);
        after_entries.push(store::insert_entry(&tx, &draft).map_err(|e| e.to_string())?);
    }

    // Remove highest line index first so removing one line never shifts the
    // index of another still waiting to be removed.
    let mut removal_order = resolved.clone();
    removal_order.sort_by_key(|u| std::cmp::Reverse(u.id.parse::<usize>().unwrap_or(0)));

    let mut content = current;
    let mut parsed = hosts_parser::parse(&content);
    for unmanaged in &removal_order {
        let line_index: usize = unmanaged.id.parse().map_err(|_| "Invalid unmanaged entry id.".to_string())?;
        parsed = hosts_parser::remove_unmanaged_line(&content, line_index, &unmanaged.ip, &unmanaged.hostname, &unmanaged.comment)
            .ok_or_else(stale_err)?;
        content = hosts_parser::render(&parsed, &pre_adopt_entries);
    }

    let final_entries = store::list_entries(&tx).map_err(|e| e.to_string())?;
    let new_content = hosts_parser::render(&parsed, &final_entries);

    let (outcome, backup_path) = write_content_to_hosts_file(&app, &state, &new_content, false)?;
    if !outcome.write_ok {
        return Err("Failed to write the hosts file.".to_string());
    }

    for entry in &after_entries {
        store::insert_history(&tx, &entry.hostname, "Adopted entry", Some(&entry.id), None, Some(entry), Some(&backup_path))
            .map_err(|e| e.to_string())?;
    }
    prune_history(&tx)?;
    tx.commit().map_err(|e| e.to_string())?;
    crate::tray::sync(&app, &final_entries);

    Ok(after_entries)
}
