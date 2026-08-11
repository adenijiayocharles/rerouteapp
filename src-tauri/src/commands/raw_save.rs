//! The raw hosts-file editor: preview/lint/save, plus reconciling the
//! structured entry table to match whatever managed block the user saved.

use tauri::{AppHandle, State};

use super::{prune_history, write_content_to_hosts_file, WriteResult};
use crate::diff;
use crate::hosts_parser;
use crate::lint;
use crate::models::{DiffPreview, Entry, EntryDraft};
use crate::state::{AppState, PoisonRecoverExt};
use crate::store;

/// Reads `/etc/hosts` fresh off disk, for opening the raw editor and for
/// refreshing it after an external-change reload.
#[tauri::command]
pub fn read_hosts_file(state: State<AppState>) -> Result<String, String> {
    std::fs::read_to_string(&state.hosts_path).map_err(|e| format!("Failed to read the hosts file: {e}"))
}

/// Reconciliation (see `plan_reconciliation` below) matches lines to
/// existing entries purely by hostname string, so a hostname that
/// disappears from the managed block is indistinguishable from a rename —
/// it's deleted, and a new entry is created for whatever hostname now
/// occupies that spot. For an entry with more than one saved IP candidate,
/// that silently discards every candidate except whichever IP is on the
/// line that replaced it. Warn about it here so the user sees it before
/// confirming, since the diff view alone only shows the line-level
/// add/remove, not what's being lost from underneath it.
fn multi_ip_loss_warnings(existing: &[Entry], parsed_lines: &[hosts_parser::ParsedManagedLine]) -> Vec<lint::LintDiagnostic> {
    let remaining_hostnames: std::collections::HashSet<&str> =
        parsed_lines.iter().map(|l| l.hostname.as_str()).collect();
    existing
        .iter()
        .filter(|e| e.ips.len() > 1 && !remaining_hostnames.contains(e.hostname.as_str()))
        .map(|e| lint::LintDiagnostic {
            line: 0,
            severity: "warning".to_string(),
            message: format!(
                "\u{201c}{}\u{201d} has {} saved IPs \u{2014} removing or renaming it here will discard all but the active one. Use the Edit panel instead to keep them.",
                e.hostname,
                e.ips.len()
            ),
        })
        .collect()
}

/// Read-only diff + lint pass for the raw editor's Save confirmation.
/// Diffs the given `content` against what's currently on disk and lints
/// its managed block, without writing anything.
#[tauri::command]
pub fn preview_raw_save(state: State<AppState>, content: String) -> Result<DiffPreview, String> {
    let current = std::fs::read_to_string(&state.hosts_path).map_err(|e| format!("Failed to read the hosts file: {e}"))?;
    let diff_lines = diff::diff_lines(&current, &content);
    let mut diagnostics = lint::lint_managed_block(&content);

    let existing = {
        let conn = state.read_conn.lock_recover();
        store::list_entries(&conn).map_err(|e| e.to_string())?
    };
    let parsed_lines = hosts_parser::parse_managed_block(&content);
    diagnostics.extend(multi_ip_loss_warnings(&existing, &parsed_lines));

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
        group_propagation: None,
        conflict_warning: None,
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
    let mut conn = state.conn.lock_recover();
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let parsed_lines = hosts_parser::parse_managed_block(&content);
    let changes = plan_reconciliation(&tx, &parsed_lines)?;

    let (outcome, backup_path) = write_content_to_hosts_file(&app, &state, &content, false, None)?;
    if !outcome.write_ok {
        return Err("Failed to write the hosts file.".to_string());
    }

    record_reconciliation_history(&tx, &changes, &backup_path)?;
    prune_history(&tx)?;
    let entries = store::list_entries(&tx).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    crate::tray::sync(&app, &entries);

    Ok(WriteResult { entry: None, flush_ok: None, flush_message: None, conflict_warning: None })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::IpCandidate;

    fn entry_with_ips(hostname: &str, ip_count: usize) -> Entry {
        Entry {
            id: hostname.to_string(),
            hostname: hostname.to_string(),
            comment: String::new(),
            group: String::new(),
            enabled: true,
            active_ip_id: "ip0".to_string(),
            ips: (0..ip_count)
                .map(|i| IpCandidate { id: format!("ip{i}"), label: format!("label{i}"), ip: format!("10.0.0.{i}") })
                .collect(),
            last_modified: "now".to_string(),
        }
    }

    fn line(hostname: &str) -> hosts_parser::ParsedManagedLine {
        hosts_parser::ParsedManagedLine {
            enabled: true,
            ip: "10.0.0.0".to_string(),
            hostname: hostname.to_string(),
            comment: String::new(),
        }
    }

    #[test]
    fn warns_when_a_multi_ip_entry_disappears() {
        let existing = vec![entry_with_ips("api.local", 3)];
        let parsed_lines = vec![line("api-v2.local")];
        let warnings = multi_ip_loss_warnings(&existing, &parsed_lines);
        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].message.contains("api.local"));
        assert!(warnings[0].message.contains("3 saved IPs"));
    }

    #[test]
    fn no_warning_when_the_hostname_is_kept() {
        let existing = vec![entry_with_ips("api.local", 3)];
        let parsed_lines = vec![line("api.local")];
        assert!(multi_ip_loss_warnings(&existing, &parsed_lines).is_empty());
    }

    #[test]
    fn no_warning_for_single_ip_entries() {
        let existing = vec![entry_with_ips("api.local", 1)];
        let parsed_lines: Vec<hosts_parser::ParsedManagedLine> = vec![];
        assert!(multi_ip_loss_warnings(&existing, &parsed_lines).is_empty());
    }
}
