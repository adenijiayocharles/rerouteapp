//! Surfacing and importing hosts-file lines that live outside the
//! app-managed block (added manually or by another tool).

use tauri::{AppHandle, State};

use super::{draft_to_entry, prune_history, write_content_to_hosts_file};
use crate::hosts_parser;
use crate::models::{DiffPreview, Entry, EntryDraft};
use crate::state::{AppState, PoisonRecoverExt};
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

/// Builds one draft per hostname on the unmanaged line: `UnmanagedEntry.hostname`
/// is already normalized (by `parse_unmanaged_line`) to a space-joined list,
/// regardless of whether the original line used spaces, commas, or both, so
/// splitting it back apart here turns `1.2.3.4 a,b c` into three entries that
/// each keep the line's original IP and comment. When a line names more than
/// one hostname, the resulting entries are also put in a shared group —
/// named after the IP they came from — so the split-out entries stay
/// visibly related (and filterable) via the sidebar's group list instead of
/// scattering into the ungrouped list.
fn drafts_for_unmanaged(unmanaged: &hosts_parser::UnmanagedEntry) -> Vec<EntryDraft> {
    let hostnames = validate::split_hostnames(&unmanaged.hostname);
    let group = if hostnames.len() > 1 { unmanaged.ip.clone() } else { String::new() };
    hostnames
        .into_iter()
        .map(|hostname| {
            // `ip.uid` becomes the `ip_candidates` table's primary key, which is
            // keyed table-wide (not scoped per entry) — it must be unique across
            // every adopted entry, not just within this one, or adopting a second
            // entry in the same session collides on insert.
            let uid = uuid::Uuid::new_v4().to_string();
            EntryDraft {
                id: None,
                hostname,
                comment: unmanaged.comment.clone(),
                group: group.clone(),
                enabled: true,
                active_uid: uid.clone(),
                ips: vec![crate::models::IpDraft {
                    uid,
                    label: "Imported".to_string(),
                    ip: unmanaged.ip.clone(),
                }],
            }
        })
        .collect()
}

/// Preview for moving an unmanaged entry into the app-managed block. Reads
/// straight from disk; writes nothing.
#[tauri::command]
pub fn preview_adopt(state: State<AppState>, id: String) -> Result<DiffPreview, String> {
    let content = std::fs::read_to_string(&state.hosts_path).map_err(|e| format!("Failed to read the hosts file: {e}"))?;
    let unmanaged = find_unmanaged_entry(&content, &id)?;
    let drafts = drafts_for_unmanaged(&unmanaged);
    let after_entries: Vec<Entry> = drafts.iter().map(|d| draft_to_entry("pending", d)).collect();
    let after_lines: Vec<String> = after_entries.iter().map(hosts_parser::build_line).collect();

    let title = match after_entries.as_slice() {
        [only] => format!("Adopt \u{201c}{}\u{201d}", only.hostname),
        many => format!("Adopt {} entries", many.len()),
    };
    let subtitle = if after_entries.len() > 1 {
        "Move these entries from outside the managed block into re:route, one hostname per line.".to_string()
    } else {
        "Move this entry from outside the managed block into re:route.".to_string()
    };

    Ok(DiffPreview {
        mode: "adopt".to_string(),
        is_new: true,
        is_removal: false,
        title,
        subtitle,
        before_line: None,
        after_line: Some(after_lines.join("\n")),
        is_shadow_domain: after_entries.iter().any(|e| validate::is_shadow_domain(&e.hostname)),
        restore_target_id: None,
        history_before: None,
        history_after: None,
        diff_lines: None,
        diagnostics: None,
        group_propagation: None,
        conflict_warning: None,
    })
}

/// Moves an unmanaged entry into the app-managed block in one write: splits
/// it into one DB entry per hostname (space/comma-separated lines adopt as
/// several entries sharing the original IP), removes the original raw line,
/// and regenerates the hosts file. A single-entry call into
/// `confirm_adopt_many`, which is already a strict superset of this
/// behavior (its multi-removal handling degenerates to the same single
/// remove-then-render sequence when there's only one id).
#[tauri::command]
pub fn confirm_adopt(app: AppHandle, state: State<AppState>, id: String) -> Result<Vec<Entry>, String> {
    confirm_adopt_many(app, state, vec![id])
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

    let mut conn = state.conn.lock_recover();
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

    // Split each selected line into one draft per hostname, then group the
    // whole batch by IP address (stable sort, so within an IP group the
    // caller's selection order — and a split line's original hostname
    // order — is preserved) before inserting. The resulting order_index
    // (and therefore hosts-file position) reflects that grouping.
    let mut drafts: Vec<EntryDraft> = resolved.iter().flat_map(drafts_for_unmanaged).collect();
    drafts.sort_by(|a, b| a.ips[0].ip.cmp(&b.ips[0].ip));

    let mut after_entries = Vec::with_capacity(drafts.len());
    for draft in &drafts {
        after_entries.push(store::insert_entry(&tx, draft).map_err(|e| e.to_string())?);
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

    let (outcome, backup_path) = write_content_to_hosts_file(&app, &state, &new_content, false, None)?;
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

#[cfg(test)]
mod tests {
    use super::*;

    fn unmanaged(hostname: &str) -> hosts_parser::UnmanagedEntry {
        hosts_parser::UnmanagedEntry {
            id: "0".to_string(),
            ip: "10.0.0.1".to_string(),
            hostname: hostname.to_string(),
            comment: "note".to_string(),
        }
    }

    #[test]
    fn splits_a_multi_hostname_line_into_one_draft_per_hostname() {
        let drafts = drafts_for_unmanaged(&unmanaged("api.local admin.local mail.local"));
        assert_eq!(drafts.len(), 3);
        assert_eq!(drafts[0].hostname, "api.local");
        assert_eq!(drafts[1].hostname, "admin.local");
        assert_eq!(drafts[2].hostname, "mail.local");
        for d in &drafts {
            assert_eq!(d.ips.len(), 1);
            assert_eq!(d.ips[0].ip, "10.0.0.1");
            assert_eq!(d.comment, "note");
            // Split from the same multi-hostname line: grouped by the shared
            // IP so they show up together in the sidebar's group list.
            assert_eq!(d.group, "10.0.0.1");
        }
    }

    #[test]
    fn single_hostname_line_produces_exactly_one_ungrouped_draft() {
        let drafts = drafts_for_unmanaged(&unmanaged("api.local"));
        assert_eq!(drafts.len(), 1);
        assert_eq!(drafts[0].hostname, "api.local");
        assert_eq!(drafts[0].group, "");
    }

    #[test]
    fn drafts_from_one_line_get_distinct_ip_candidate_uids() {
        let drafts = drafts_for_unmanaged(&unmanaged("api.local admin.local"));
        assert_ne!(drafts[0].active_uid, drafts[1].active_uid);
    }
}
