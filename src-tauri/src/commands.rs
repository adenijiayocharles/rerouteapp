use serde::Serialize;
use tauri::{AppHandle, State};

use crate::diff;
use crate::dns_flush;
use crate::elevate;
use crate::helper_client;
use crate::helper_install;
use crate::hosts_parser;
use crate::lint;
use crate::models::{DiffPreview, Entry, EntryDraft, HistoryEntry, IpCandidate};
use crate::state::AppState;
use crate::store;
use crate::validate;

/// Result of any command that writes the hosts file. `flush_ok` is `None`
/// when no flush was attempted for this action (e.g. a plain edit);
/// `flush_message` is populated whenever the flush didn't cleanly succeed,
/// so the frontend can show the mockup's "Retry DNS flush" affordance.
#[derive(Serialize, Clone)]
pub struct WriteResult {
    pub entry: Option<Entry>,
    #[serde(rename = "flushOk")]
    pub flush_ok: Option<bool>,
    #[serde(rename = "flushMessage")]
    pub flush_message: Option<String>,
}

/// Rewrites the draft's hostname field to its canonical form: individual
/// hostnames (however the user separated them — commas, whitespace, or the
/// hosts file's native space-separated syntax) joined by a single space,
/// which is exactly what a hosts file line looks like on disk.
fn normalize_draft_hostname(draft: &mut EntryDraft) {
    draft.hostname = validate::split_hostnames(&draft.hostname).join(" ");
}

fn validate_draft(draft: &EntryDraft) -> Result<(), String> {
    let hostnames = validate::split_hostnames(&draft.hostname);
    if hostnames.is_empty() {
        return Err("Hostname is required.".to_string());
    }
    for hostname in &hostnames {
        if !validate::is_valid_hostname(hostname) {
            return Err(format!("\u{201c}{hostname}\u{201d} is not a valid hostname."));
        }
    }
    if draft.ips.is_empty() {
        return Err("At least one IP address is required.".to_string());
    }
    for ip in &draft.ips {
        if !validate::is_valid_ip(&ip.ip) {
            return Err(format!("\u{201c}{}\u{201d} is not a valid IP address.", ip.ip));
        }
    }
    if !draft.ips.iter().any(|ip| ip.uid == draft.active_uid) {
        return Err("The active IP selection is invalid.".to_string());
    }
    Ok(())
}

fn draft_to_entry(id: &str, draft: &EntryDraft) -> Entry {
    Entry {
        id: id.to_string(),
        hostname: draft.hostname.trim().to_string(),
        comment: draft.comment.clone(),
        group: draft.group.trim().to_string(),
        enabled: draft.enabled,
        active_ip_id: draft.active_uid.clone(),
        ips: draft
            .ips
            .iter()
            .map(|r| IpCandidate {
                id: r.uid.clone(),
                label: if r.label.trim().is_empty() {
                    r.ip.clone()
                } else {
                    r.label.clone()
                },
                ip: r.ip.clone(),
            })
            .collect(),
        last_modified: "Just now".to_string(),
    }
}

/// Backs up the current hosts file, regenerates it from `entries`, and
/// writes it. See `write_content_to_hosts_file` for the actual write.
fn backup_and_write(
    app: &AppHandle,
    state: &AppState,
    entries: &[Entry],
    do_flush: bool,
) -> Result<(elevate::WriteOutcome, String), String> {
    let current = std::fs::read_to_string(&state.hosts_path)
        .map_err(|e| format!("Failed to read the hosts file: {e}"))?;
    let parsed = hosts_parser::parse(&current);
    let new_content = hosts_parser::render(&parsed, entries);
    write_content_to_hosts_file(app, state, &new_content, do_flush)
}

/// Backs up the current hosts file and writes `new_content` to it verbatim.
/// Prefers the privileged helper daemon (no prompt) when it's reachable;
/// otherwise installs it and performs this write in the same elevated
/// prompt, so only the very first write (or a write after the daemon has
/// somehow stopped) ever prompts. Primes `last_written` before issuing the
/// write so the file watcher doesn't mistake this write for an out-of-band
/// edit.
fn write_content_to_hosts_file(
    app: &AppHandle,
    state: &AppState,
    new_content: &str,
    do_flush: bool,
) -> Result<(elevate::WriteOutcome, String), String> {
    let current = std::fs::read_to_string(&state.hosts_path)
        .map_err(|e| format!("Failed to read the hosts file: {e}"))?;

    let timestamp = chrono::Utc::now().format("%Y%m%dT%H%M%S%.3fZ");
    let backup_path = state.backups_dir.join(format!("hosts-{timestamp}.bak"));
    std::fs::write(&backup_path, &current).map_err(|e| format!("Failed to write backup: {e}"))?;

    *state.last_written.lock().unwrap() = Some(new_content.to_string());

    let flush_cmd = if do_flush { dns_flush::flush_command() } else { None };

    let plain_elevated_write = |content: &str| -> Result<elevate::WriteOutcome, String> {
        let staging_path = state.backups_dir.join(".staging-hosts");
        hosts_parser::atomic_write(&staging_path, content)
            .map_err(|e| format!("Failed to stage the hosts file: {e}"))?;
        elevate::write_hosts_file(state.executor.as_ref(), &staging_path, &state.hosts_path, flush_cmd.as_deref())
    };

    let outcome = if helper_client::ping() {
        let write_ok = helper_client::write_hosts(new_content).is_ok();
        let flush_ok = if write_ok && do_flush {
            Some(helper_client::flush_dns().is_ok())
        } else {
            None
        };
        elevate::WriteOutcome { write_ok, flush_ok }
    } else if state.helper_enabled.load(std::sync::atomic::Ordering::Relaxed) {
        match helper_install::install_and_write(
            app,
            state.executor.as_ref(),
            &state.backups_dir,
            new_content,
            &state.hosts_path,
            flush_cmd.as_deref(),
        ) {
            Ok(outcome) => outcome,
            Err(_) => plain_elevated_write(new_content)?,
        }
    } else {
        plain_elevated_write(new_content)?
    };

    if !outcome.write_ok {
        *state.last_written.lock().unwrap() = None;
    }

    Ok((outcome, backup_path.to_string_lossy().to_string()))
}

fn flush_message_for(do_flush: bool, outcome: &elevate::WriteOutcome, hostname: &str, ip: &str) -> Option<String> {
    if !do_flush {
        return None;
    }
    match outcome.flush_ok {
        Some(true) => None,
        Some(false) => Some(format!(
            "{hostname} now resolves to {ip}. The hosts file was saved, but the DNS cache could not be flushed \u{2014} the old address may still be cached."
        )),
        None => Some(
            "No supported DNS resolver cache was found on this system. The hosts file was saved, but you may need to flush DNS manually."
                .to_string(),
        ),
    }
}

#[tauri::command]
pub fn list_entries(state: State<AppState>) -> Result<Vec<Entry>, String> {
    let conn = state.conn.lock().unwrap();
    store::list_entries(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_history(state: State<AppState>) -> Result<Vec<HistoryEntry>, String> {
    let conn = state.conn.lock().unwrap();
    store::list_history(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn is_shadow_domain(hostname: String) -> bool {
    validate::split_hostnames(&hostname)
        .iter()
        .any(|h| validate::is_shadow_domain(h))
}

/// Computes the diff to show in the confirmation modal without writing
/// anything. The frontend calls `confirm_save` with the same draft once
/// the user approves.
#[tauri::command]
pub fn preview_save(state: State<AppState>, mut draft: EntryDraft) -> Result<DiffPreview, String> {
    normalize_draft_hostname(&mut draft);
    validate_draft(&draft)?;
    let conn = state.conn.lock().unwrap();
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

    // Matches the approved design mockup: add/edit saves through the diff
    // modal don't trigger a DNS flush (only an explicit active-IP switch
    // does, per spec Step 3 and the mockup's switchIp handler).
    let do_flush = false;
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

    Ok(WriteResult {
        entry: Some(after_entry),
        flush_ok: None,
        flush_message: None,
    })
}

/// Reads the Settings page "History retention" limit. Defaults to 200
/// when unset; the "unlimited" option maps to `None` (no pruning).
fn history_retention_limit(conn: &rusqlite::Connection) -> Option<i64> {
    match store::get_setting(conn, "history_retention").ok().flatten() {
        None => Some(200),
        Some(v) if v == "unlimited" => None,
        Some(v) => v.parse::<i64>().ok().or(Some(200)),
    }
}

fn prune_history(conn: &rusqlite::Connection) -> Result<(), String> {
    store::prune_history(conn, history_retention_limit(conn)).map_err(|e| e.to_string())
}

/// Reads the Settings page "Auto-flush DNS" toggle (on by default).
fn auto_flush_dns_enabled(conn: &rusqlite::Connection) -> bool {
    store::get_setting(conn, "auto_flush_dns")
        .ok()
        .flatten()
        .map(|v| v != "false")
        .unwrap_or(true)
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

    Ok(WriteResult {
        entry: Some(after_entry),
        flush_ok: None,
        flush_message: None,
    })
}

/// Read-only diff for the History view's "View diff" button (no restore).
#[tauri::command]
pub fn history_diff(state: State<AppState>, history_id: String) -> Result<DiffPreview, String> {
    let conn = state.conn.lock().unwrap();
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
    let conn = state.conn.lock().unwrap();
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
    let conn = state.conn.lock().unwrap();
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

    Ok(WriteResult {
        entry: None,
        flush_ok: None,
        flush_message: None,
    })
}

/// Reads `/etc/hosts` fresh off disk, for opening the raw editor and for
/// refreshing it after an external-change reload.
#[tauri::command]
pub fn read_hosts_file(state: State<AppState>) -> Result<String, String> {
    std::fs::read_to_string(&state.hosts_path).map_err(|e| format!("Failed to read the hosts file: {e}"))
}

/// Read-only diff + lint pass for the raw editor's Save confirmation.
/// Diffs the given `content` against what's currently on disk and lints
/// its managed block, without writing anything.
#[tauri::command]
pub fn preview_raw_save(state: State<AppState>, content: String) -> Result<DiffPreview, String> {
    let current = std::fs::read_to_string(&state.hosts_path).map_err(|e| format!("Failed to read the hosts file: {e}"))?;
    let diff_lines = diff::diff_lines(&current, &content);
    let diagnostics = lint::lint_managed_block(&content);

    Ok(DiffPreview {
        mode: "raw".to_string(),
        is_new: false,
        is_removal: false,
        title: "Save changes to the hosts file".to_string(),
        subtitle: "Review what will change before writing.".to_string(),
        before_line: None,
        after_line: None,
        is_shadow_domain: false,
        restore_target_id: None,
        history_before: None,
        history_after: None,
        diff_lines: Some(diff_lines),
        diagnostics: Some(diagnostics),
    })
}

/// Live linting while typing in the raw editor. Shares `lint::lint_managed_block`
/// with `preview_raw_save` so the two can never disagree about what's invalid.
#[tauri::command]
pub fn lint_hosts_content(content: String) -> Vec<lint::LintDiagnostic> {
    lint::lint_managed_block(&content)
}

/// One structured-entry change produced by reconciling a raw save's
/// managed block against the existing entry table.
enum ReconcileChange {
    Added { after: Entry },
    Edited { before: Entry, after: Entry },
    Deleted { before: Entry },
}

/// Mutates the entries table to match `parsed_lines` (the newly-saved
/// managed block), matching by exact hostname string:
/// - A line whose hostname matches an existing entry updates that entry in
///   place (keeping its id and any extra, non-active IP candidates) — but
///   only if something actually differs, so untouched lines produce no
///   history noise.
/// - An unmatched line becomes a new entry.
/// - An existing entry whose hostname no longer appears is deleted.
/// Returns the list of changes so the caller can record history for them
/// once the on-disk write (which needs to happen first, for rollback
/// safety) has succeeded.
fn plan_reconciliation(
    tx: &rusqlite::Transaction,
    parsed_lines: &[hosts_parser::ParsedManagedLine],
) -> Result<Vec<ReconcileChange>, String> {
    let existing = store::list_entries(tx).map_err(|e| e.to_string())?;
    let mut existing_by_hostname: std::collections::HashMap<String, Vec<Entry>> =
        std::collections::HashMap::new();
    for e in existing {
        existing_by_hostname.entry(e.hostname.clone()).or_default().push(e);
    }
    let mut changes = Vec::new();

    for line in parsed_lines {
        let matched_entry = match existing_by_hostname.entry(line.hostname.clone()) {
            std::collections::hash_map::Entry::Occupied(mut occ) => {
                let popped = occ.get_mut().pop();
                if occ.get().is_empty() {
                    occ.remove();
                }
                popped
            }
            std::collections::hash_map::Entry::Vacant(_) => None,
        };
        if let Some(existing_entry) = matched_entry {
            let active_ip = existing_entry
                .ips
                .iter()
                .find(|ip| ip.id == existing_entry.active_ip_id)
                .map(|ip| ip.ip.as_str());
            let changed = existing_entry.comment != line.comment
                || existing_entry.enabled != line.enabled
                || active_ip != Some(line.ip.as_str());
            if !changed {
                continue;
            }
            let draft = EntryDraft {
                id: Some(existing_entry.id.clone()),
                hostname: line.hostname.clone(),
                comment: line.comment.clone(),
                group: existing_entry.group.clone(),
                enabled: line.enabled,
                active_uid: existing_entry.active_ip_id.clone(),
                ips: existing_entry
                    .ips
                    .iter()
                    .map(|ip| crate::models::IpDraft {
                        uid: ip.id.clone(),
                        label: ip.label.clone(),
                        ip: if ip.id == existing_entry.active_ip_id { line.ip.clone() } else { ip.ip.clone() },
                    })
                    .collect(),
            };
            let after = store::update_entry(tx, &existing_entry.id, &draft).map_err(|e| e.to_string())?;
            changes.push(ReconcileChange::Edited { before: existing_entry, after });
        } else {
            let ip_uid = uuid::Uuid::new_v4().to_string();
            let draft = EntryDraft {
                id: None,
                hostname: line.hostname.clone(),
                comment: line.comment.clone(),
                group: String::new(),
                enabled: line.enabled,
                active_uid: ip_uid.clone(),
                ips: vec![crate::models::IpDraft { uid: ip_uid, label: line.ip.clone(), ip: line.ip.clone() }],
            };
            let after = store::insert_entry(tx, &draft).map_err(|e| e.to_string())?;
            changes.push(ReconcileChange::Added { after });
        }
    }

    for (_, orphaned_list) in existing_by_hostname {
        for orphaned in orphaned_list {
            store::delete_entry(tx, &orphaned.id).map_err(|e| e.to_string())?;
            changes.push(ReconcileChange::Deleted { before: orphaned });
        }
    }

    Ok(changes)
}

/// Records one History row per change, using the shared backup path from
/// the write that just succeeded. Called only after the write succeeds.
fn record_reconciliation_history(
    tx: &rusqlite::Transaction,
    changes: &[ReconcileChange],
    backup_path: &str,
) -> Result<(), String> {
    for change in changes {
        match change {
            ReconcileChange::Added { after } => {
                store::insert_history(tx, &after.hostname, "Added entry", Some(&after.id), None, Some(after), Some(backup_path))
                    .map_err(|e| e.to_string())?;
            }
            ReconcileChange::Edited { before, after } => {
                store::insert_history(tx, &after.hostname, "Edited entry", Some(&after.id), Some(before), Some(after), Some(backup_path))
                    .map_err(|e| e.to_string())?;
            }
            ReconcileChange::Deleted { before } => {
                store::insert_history(tx, &before.hostname, "Deleted entry", Some(&before.id), Some(before), None, Some(backup_path))
                    .map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

/// Writes `content` verbatim to the hosts file, then reconciles the
/// structured entry table to match its managed block. DB mutation happens
/// before the disk write (so a write failure rolls the transaction back
/// and nothing diverges); history rows are recorded after, once the
/// backup path from the successful write is known.
#[tauri::command]
pub fn confirm_raw_save(app: AppHandle, state: State<AppState>, content: String) -> Result<WriteResult, String> {
    let mut conn = state.conn.lock().unwrap();
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let parsed_lines = hosts_parser::parse_managed_block(&content);
    let changes = plan_reconciliation(&tx, &parsed_lines)?;

    let (outcome, backup_path) = write_content_to_hosts_file(&app, &state, &content, false)?;
    if !outcome.write_ok {
        return Err("Failed to write the hosts file.".to_string());
    }

    record_reconciliation_history(&tx, &changes, &backup_path)?;
    prune_history(&tx)?;
    tx.commit().map_err(|e| e.to_string())?;

    Ok(WriteResult { entry: None, flush_ok: None, flush_message: None })
}

/// Standalone "Flush DNS now" action, independent of any edit. Prefers
/// the helper daemon (no prompt); falls back to a one-off elevated call
/// if the daemon isn't installed/running (this action alone never
/// triggers a daemon install — that only happens on an actual write).
#[tauri::command]
pub fn flush_dns(state: State<AppState>) -> Result<WriteResult, String> {
    if helper_client::ping() {
        return match helper_client::flush_dns() {
            Ok(()) => Ok(WriteResult {
                entry: None,
                flush_ok: Some(true),
                flush_message: None,
            }),
            Err(e) => Ok(WriteResult {
                entry: None,
                flush_ok: Some(false),
                flush_message: Some(format!("DNS flush failed: {e}")),
            }),
        };
    }

    let Some(cmd) = dns_flush::flush_command() else {
        return Ok(WriteResult {
            entry: None,
            flush_ok: None,
            flush_message: Some(
                "No supported DNS resolver cache was found on this system.".to_string(),
            ),
        });
    };
    let ok = elevate::run_flush_only(state.executor.as_ref(), &cmd)?;
    Ok(WriteResult {
        entry: None,
        flush_ok: Some(ok),
        flush_message: if ok {
            None
        } else {
            Some("DNS flush failed. You can retry from here.".to_string())
        },
    })
}

/// Whether the privileged helper daemon is currently installed and
/// reachable (drives the sidebar's helper-status indicator).
#[tauri::command]
pub fn helper_status() -> bool {
    helper_client::ping()
}

/// Removes the helper daemon (one elevated prompt): stops it via launchd
/// and deletes its binary and LaunchDaemon plist. Subsequent writes fall
/// back to per-write elevation until it's reinstalled.
#[tauri::command]
pub fn uninstall_helper(state: State<AppState>) -> Result<(), String> {
    let cmd = elevate::build_uninstall_command();
    state.executor.run_privileged_shell(&cmd).map(|_| ())
}

/// Whether the app is allowed to auto-install the background helper on
/// the next write (Settings page toggle; on by default).
#[tauri::command]
pub fn get_helper_enabled(state: State<AppState>) -> bool {
    state.helper_enabled.load(std::sync::atomic::Ordering::Relaxed)
}

/// Persists the Settings page toggle. Does not itself install or remove
/// the helper daemon — the frontend calls `uninstall_helper` separately
/// when turning this off while the helper is currently active.
#[tauri::command]
pub fn set_helper_enabled(state: State<AppState>, enabled: bool) -> Result<(), String> {
    let conn = state.conn.lock().unwrap();
    store::set_setting(&conn, "helper_enabled", if enabled { "true" } else { "false" }).map_err(|e| e.to_string())?;
    state.helper_enabled.store(enabled, std::sync::atomic::Ordering::Relaxed);
    Ok(())
}

/// Generic settings-table accessors for Settings page preferences that
/// don't need to be read from inside a write command while `conn` is
/// already locked (unlike `helper_enabled`, which does — see its comment
/// on `AppState`). Simple UI preferences can go straight through these
/// instead of growing a bespoke pair of commands each.
#[tauri::command]
pub fn get_setting(state: State<AppState>, key: String) -> Result<Option<String>, String> {
    let conn = state.conn.lock().unwrap();
    store::get_setting(&conn, &key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_setting(state: State<AppState>, key: String, value: String) -> Result<(), String> {
    let conn = state.conn.lock().unwrap();
    store::set_setting(&conn, &key, &value).map_err(|e| e.to_string())
}
