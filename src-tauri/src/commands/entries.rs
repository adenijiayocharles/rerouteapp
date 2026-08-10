//! CRUD and preview/confirm commands for structured, app-managed entries
//! (the main Hosts list): add/edit, switch active IP, enable/disable,
//! restore from history, and delete.

use tauri::{AppHandle, State};

use super::{
    auto_flush_dns_enabled, backup_and_write, draft_to_entry, flush_message_for, normalize_draft_hostname,
    prune_history, validate_draft, WriteResult,
};
use crate::hosts_parser;
use crate::models::{DiffPreview, Entry, EntryDraft, HistoryEntry};
use crate::state::AppState;
use crate::store;
use crate::validate;

#[tauri::command]
pub fn list_entries(state: State<AppState>) -> Result<Vec<Entry>, String> {
    let conn = state.read_conn.lock().unwrap();
    store::list_entries(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_history(state: State<AppState>) -> Result<Vec<HistoryEntry>, String> {
    let conn = state.read_conn.lock().unwrap();
    store::list_history(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn is_shadow_domain(hostname: String) -> bool {
    validate::split_hostnames(&hostname)
        .iter()
        .any(|h| validate::is_shadow_domain(h))
}

/// Renames a group across every entry that has it, e.g. editing a group
/// name inline from the sidebar. Group is UI-only metadata — it's never
/// written to the hosts file (see `hosts_parser::build_line`) — so this
/// skips the write pipeline entirely: no backup, no elevation, no history
/// entry, just a DB update. Still syncs the tray and emits the usual
/// entries-changed event so every open surface picks up the rename.
#[tauri::command]
pub fn rename_group(app: AppHandle, state: State<AppState>, old_name: String, new_name: String) -> Result<Vec<Entry>, String> {
    let old_name = old_name.trim().to_string();
    let new_name = new_name.trim().to_string();
    if new_name.is_empty() {
        return Err("Group name can\u{2019}t be empty.".to_string());
    }

    let conn = state.conn.lock().unwrap();
    if old_name != new_name {
        store::rename_group(&conn, &old_name, &new_name).map_err(|e| e.to_string())?;
    }
    let entries = store::list_entries(&conn).map_err(|e| e.to_string())?;
    crate::tray::sync(&app, &entries);

    Ok(entries)
}

/// Computes the diff to show in the confirmation modal without writing
/// anything. The frontend calls `confirm_save` with the same draft once
/// the user approves.
#[tauri::command]
pub fn preview_save(state: State<AppState>, mut draft: EntryDraft) -> Result<DiffPreview, String> {
    normalize_draft_hostname(&mut draft);
    validate_draft(&draft)?;
    let conn = state.read_conn.lock().unwrap();
    let is_new = draft.id.is_none();
    let before = match &draft.id {
        Some(id) => store::get_entry(&conn, id).map_err(|e| e.to_string())?,
        None => None,
    };
    let target_id = draft.id.clone().unwrap_or_else(|| "pending".to_string());
    let after = draft_to_entry(&target_id, &draft);
    let is_shadow = validate::is_shadow_domain(&after.hostname);
    let title = if is_new {
        format!("Add \u{201c}{}\u{201d}", after.hostname)
    } else {
        format!("Save changes to \u{201c}{}\u{201d}", after.hostname)
    };

    Ok(DiffPreview {
        mode: "save".to_string(),
        is_new,
        is_removal: false,
        title,
        subtitle: "Review the line that will change in the hosts file before writing.".to_string(),
        before_line: before.as_ref().map(hosts_parser::build_line),
        after_line: Some(hosts_parser::build_line(&after)),
        is_shadow_domain: is_shadow,
        restore_target_id: None,
        history_before: None,
        history_after: None,
        diff_lines: None,
        diagnostics: None,
    })
}

#[tauri::command]
pub fn confirm_save(app: AppHandle, state: State<AppState>, mut draft: EntryDraft) -> Result<WriteResult, String> {
    normalize_draft_hostname(&mut draft);
    validate_draft(&draft)?;
    let is_new = draft.id.is_none();

    let mut conn = state.conn.lock().unwrap();
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let before_snapshot = match &draft.id {
        Some(id) => store::get_entry(&tx, id).map_err(|e| e.to_string())?,
        None => None,
    };
    let after_entry = if is_new {
        store::insert_entry(&tx, &draft).map_err(|e| e.to_string())?
    } else {
        store::update_entry(&tx, draft.id.as_ref().unwrap(), &draft).map_err(|e| e.to_string())?
    };
    let entries = store::list_entries(&tx).map_err(|e| e.to_string())?;

    let do_flush = auto_flush_dns_enabled(&tx); // Settings page toggle, on by default
    let (outcome, backup_path) = backup_and_write(&app, &state, &entries, do_flush)?;
    if !outcome.write_ok {
        // tx drops here without being committed, rolling back the DB
        // mutation above so it never diverges from what's actually on disk.
        return Err("Failed to write the hosts file.".to_string());
    }

    store::insert_history(
        &tx,
        &after_entry.hostname,
        if is_new { "Added entry" } else { "Edited entry" },
        Some(&after_entry.id),
        before_snapshot.as_ref(),
        Some(&after_entry),
        Some(&backup_path),
    )
    .map_err(|e| e.to_string())?;
    prune_history(&tx)?;
    tx.commit().map_err(|e| e.to_string())?;
    crate::tray::sync(&app, &entries);

    let active_ip = after_entry
        .ips
        .iter()
        .find(|ip| ip.id == after_entry.active_ip_id)
        .map(|ip| ip.ip.as_str())
        .unwrap_or("");
    let flush_message = flush_message_for(do_flush, &outcome, &after_entry.hostname, active_ip);
    Ok(WriteResult {
        entry: Some(after_entry),
        flush_ok: outcome.flush_ok,
        flush_message,
    })
}

#[tauri::command]
pub fn switch_active_ip(
    app: AppHandle,
    state: State<AppState>,
    entry_id: String,
    ip_id: String,
) -> Result<WriteResult, String> {
    let mut conn = state.conn.lock().unwrap();
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let before = store::get_entry(&tx, &entry_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Entry not found.".to_string())?;
    let target_ip = before
        .ips
        .iter()
        .find(|i| i.id == ip_id)
        .ok_or_else(|| "IP candidate not found.".to_string())?
        .clone();

    let after_entry = store::set_active_ip(&tx, &entry_id, &ip_id).map_err(|e| e.to_string())?;
    let entries = store::list_entries(&tx).map_err(|e| e.to_string())?;

    let do_flush = auto_flush_dns_enabled(&tx); // Settings page toggle, on by default
    let (outcome, backup_path) = backup_and_write(&app, &state, &entries, do_flush)?;
    if !outcome.write_ok {
        return Err("Failed to write the hosts file.".to_string());
    }

    store::insert_history(
        &tx,
        &after_entry.hostname,
        "Switched active IP",
        Some(&entry_id),
        Some(&before),
        Some(&after_entry),
        Some(&backup_path),
    )
    .map_err(|e| e.to_string())?;
    prune_history(&tx)?;
    tx.commit().map_err(|e| e.to_string())?;
    crate::tray::sync(&app, &entries);

    let flush_message = flush_message_for(do_flush, &outcome, &after_entry.hostname, &target_ip.ip);
    Ok(WriteResult {
        entry: Some(after_entry),
        flush_ok: outcome.flush_ok,
        flush_message,
    })
}

#[tauri::command]
pub fn toggle_enabled(app: AppHandle, state: State<AppState>, entry_id: String) -> Result<WriteResult, String> {
    let mut conn = state.conn.lock().unwrap();
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let before = store::get_entry(&tx, &entry_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Entry not found.".to_string())?;
    let after_entry = store::set_enabled(&tx, &entry_id, !before.enabled).map_err(|e| e.to_string())?;
    let entries = store::list_entries(&tx).map_err(|e| e.to_string())?;

    let (outcome, backup_path) = backup_and_write(&app, &state, &entries, false)?;
    if !outcome.write_ok {
        return Err("Failed to write the hosts file.".to_string());
    }

    store::insert_history(
        &tx,
        &after_entry.hostname,
        if after_entry.enabled { "Enabled entry" } else { "Disabled entry" },
        Some(&entry_id),
        Some(&before),
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

/// Read-only diff for the History view's "View diff" button (no restore).
#[tauri::command]
pub fn history_diff(state: State<AppState>, history_id: String) -> Result<DiffPreview, String> {
    let conn = state.read_conn.lock().unwrap();
    let h = store::get_history_entry(&conn, &history_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "History entry not found.".to_string())?;
    Ok(DiffPreview {
        mode: "view".to_string(),
        is_new: false,
        is_removal: false,
        title: format!("Change: {}", h.action),
        subtitle: format!("{} \u{b7} {}", h.hostname, h.time),
        before_line: h.before.as_ref().map(hosts_parser::build_line),
        after_line: h.after.as_ref().map(hosts_parser::build_line),
        is_shadow_domain: false,
        restore_target_id: None,
        history_before: h.before,
        history_after: h.after,
        diff_lines: None,
        diagnostics: None,
    })
}

#[tauri::command]
pub fn preview_restore(state: State<AppState>, history_id: String) -> Result<DiffPreview, String> {
    let conn = state.read_conn.lock().unwrap();
    let h = store::get_history_entry(&conn, &history_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "History entry not found.".to_string())?;

    let target_id = h
        .after
        .as_ref()
        .map(|e| e.id.clone())
        .or_else(|| h.before.as_ref().map(|e| e.id.clone()))
        .ok_or_else(|| "History entry has no associated data.".to_string())?;

    let current = store::get_entry(&conn, &target_id).map_err(|e| e.to_string())?;
    let is_removal = h.before.is_none();

    Ok(DiffPreview {
        mode: "restore".to_string(),
        is_new: false,
        is_removal,
        title: format!("Restore \u{201c}{}\u{201d}", h.hostname),
        subtitle: format!(
            "Revert to the version from before \u{201c}{}\u{201d} ({})",
            h.action.to_lowercase(),
            h.time
        ),
        before_line: current.as_ref().map(hosts_parser::build_line),
        after_line: h.before.as_ref().map(hosts_parser::build_line),
        is_shadow_domain: false,
        restore_target_id: Some(target_id),
        history_before: current,
        history_after: h.before,
        diff_lines: None,
        diagnostics: None,
    })
}

#[tauri::command]
pub fn confirm_restore(app: AppHandle, state: State<AppState>, history_id: String) -> Result<WriteResult, String> {
    let mut conn = state.conn.lock().unwrap();
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let h = store::get_history_entry(&tx, &history_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "History entry not found.".to_string())?;

    let target_id = h
        .after
        .as_ref()
        .map(|e| e.id.clone())
        .or_else(|| h.before.as_ref().map(|e| e.id.clone()))
        .ok_or_else(|| "History entry has no associated data.".to_string())?;

    let is_removal = h.before.is_none();

    let before_restore = store::get_entry(&tx, &target_id).map_err(|e| e.to_string())?;
    let after_entry = if is_removal {
        store::delete_entry(&tx, &target_id).map_err(|e| e.to_string())?;
        None
    } else {
        let snapshot = h.before.as_ref().unwrap();
        Some(store::restore_entry_snapshot(&tx, snapshot).map_err(|e| e.to_string())?)
    };

    let entries = store::list_entries(&tx).map_err(|e| e.to_string())?;

    let (outcome, backup_path) = backup_and_write(&app, &state, &entries, false)?;
    if !outcome.write_ok {
        return Err("Failed to write the hosts file.".to_string());
    }

    store::insert_history(
        &tx,
        &h.hostname,
        "Restored previous version",
        Some(&target_id),
        before_restore.as_ref(),
        after_entry.as_ref(),
        Some(&backup_path),
    )
    .map_err(|e| e.to_string())?;
    prune_history(&tx)?;
    tx.commit().map_err(|e| e.to_string())?;
    crate::tray::sync(&app, &entries);

    Ok(WriteResult {
        entry: after_entry,
        flush_ok: None,
        flush_message: None,
    })
}

/// Read-only diff for the Edit panel's "Delete" button — shows the line
/// that will be removed, with no replacement line (mirrors
/// `preview_restore`'s removal case).
#[tauri::command]
pub fn preview_delete(state: State<AppState>, entry_id: String) -> Result<DiffPreview, String> {
    let conn = state.read_conn.lock().unwrap();
    let entry = store::get_entry(&conn, &entry_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Entry not found.".to_string())?;

    Ok(DiffPreview {
        mode: "delete".to_string(),
        is_new: false,
        is_removal: true,
        title: format!("Delete \u{201c}{}\u{201d}", entry.hostname),
        subtitle: "Review the line that will be removed from the hosts file.".to_string(),
        before_line: Some(hosts_parser::build_line(&entry)),
        after_line: None,
        is_shadow_domain: false,
        restore_target_id: None,
        history_before: Some(entry),
        history_after: None,
        diff_lines: None,
        diagnostics: None,
    })
}

#[tauri::command]
pub fn confirm_delete(app: AppHandle, state: State<AppState>, entry_id: String) -> Result<WriteResult, String> {
    let mut conn = state.conn.lock().unwrap();
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let before = store::get_entry(&tx, &entry_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Entry not found.".to_string())?;

    store::delete_entry(&tx, &entry_id).map_err(|e| e.to_string())?;
    let entries = store::list_entries(&tx).map_err(|e| e.to_string())?;

    let (outcome, backup_path) = backup_and_write(&app, &state, &entries, false)?;
    if !outcome.write_ok {
        return Err("Failed to write the hosts file.".to_string());
    }

    store::insert_history(
        &tx,
        &before.hostname,
        "Deleted entry",
        Some(&entry_id),
        Some(&before),
        None,
        Some(&backup_path),
    )
    .map_err(|e| e.to_string())?;
    prune_history(&tx)?;
    tx.commit().map_err(|e| e.to_string())?;
    crate::tray::sync(&app, &entries);

    Ok(WriteResult {
        entry: None,
        flush_ok: None,
        flush_message: None,
    })
}
