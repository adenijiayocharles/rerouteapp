//! Tauri command surface, split by concern into submodules:
//! - `entries` — CRUD + preview/confirm for structured, app-managed entries
//! - `adopt` — surfacing and importing hosts-file lines outside the managed block
//! - `raw_save` — the raw hosts-file editor's preview/lint/save + reconciliation
//! - `dns` — the standalone "Flush DNS now" action
//! - `helper` — privileged helper daemon lifecycle
//! - `settings` — generic settings-table accessors
//! - `doctor` — read-only self-diagnostics ("doctor panel")
//!
//! This module itself only holds what's genuinely shared across more than
//! one of those: the write pipeline (backup, elevation, the file watcher's
//! own-write guard), draft validation/conversion, and history pruning.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::AppHandle;

use crate::dns_flush;
use crate::elevate;
use crate::helper_client;
use crate::helper_install;
use crate::hosts_parser;
use crate::models::{Entry, EntryDraft, IpCandidate};
use crate::state::{AppState, PoisonRecoverExt};
use crate::store;
use crate::validate;

pub mod adopt;
pub mod dns;
pub mod doctor;
pub mod entries;
pub mod helper;
pub mod raw_save;
pub mod settings;

/// Result of any command that writes the hosts file. `flush_ok` is `None`
/// when no flush was attempted for this action (e.g. toggling an entry's
/// enabled state); `flush_message` is populated whenever the flush didn't
/// cleanly succeed, so the frontend can show the mockup's "Retry DNS flush"
/// affordance.
#[derive(Serialize, Clone)]
pub struct WriteResult {
    pub entry: Option<Entry>,
    #[serde(rename = "flushOk")]
    pub flush_ok: Option<bool>,
    #[serde(rename = "flushMessage")]
    pub flush_message: Option<String>,
    #[serde(rename = "conflictWarning")]
    pub conflict_warning: Option<String>,
}

/// Rewrites the draft's hostname field to its canonical form: individual
/// hostnames (however the user separated them — commas, whitespace, or the
/// hosts file's native space-separated syntax) joined by a single space,
/// which is exactly what a hosts file line looks like on disk.
fn normalize_draft_hostname(draft: &mut EntryDraft) {
    draft.hostname = validate::split_hostnames(&draft.hostname).join(" ");
}

/// `comment` and `group` end up interpolated verbatim into a rendered
/// hosts-file line (`hosts_parser::build_line`) rather than going through
/// hostname/IP-style syntax validation, so a control character — most
/// importantly `\n`/`\r` — could otherwise inject an extra, unvalidated
/// line (or the managed-block marker text) into the file. The only UI path
/// to these fields is a plain `<input>`, whose own value-sanitization
/// already strips embedded newlines, but the backend shouldn't rely on
/// that alone.
fn contains_control_chars(s: &str) -> bool {
    s.chars().any(|c| c.is_control())
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
    if contains_control_chars(&draft.comment) {
        return Err("Comment can\u{2019}t contain control characters or line breaks.".to_string());
    }
    if contains_control_chars(&draft.group) {
        return Err("Group name can\u{2019}t contain control characters or line breaks.".to_string());
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
        favorite: false,
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
    // `current` was just read above to compute `new_content` — reuse it as
    // the backup snapshot below instead of having
    // `write_content_to_hosts_file` read the same file a second time.
    write_content_to_hosts_file(app, state, &new_content, do_flush, Some(current))
}

/// Backs up the current hosts file and writes `new_content` to it verbatim.
/// Prefers the privileged helper daemon (no prompt) when it's reachable;
/// otherwise installs it and performs this write in the same elevated
/// prompt, so only the very first write (or a write after the daemon has
/// somehow stopped) ever prompts. Primes `last_written` before issuing the
/// write so the file watcher doesn't mistake this write for an out-of-band
/// edit.
///
/// `current`, when the caller already has the pre-write file content in
/// hand (as `backup_and_write` does, having just read it to compute
/// `new_content`), avoids reading `hosts_path` a second time purely to
/// snapshot it for the backup file. Callers without an existing snapshot
/// (adopt/raw-save, which build `new_content` some other way) pass `None`.
fn write_content_to_hosts_file(
    app: &AppHandle,
    state: &AppState,
    new_content: &str,
    do_flush: bool,
    current: Option<String>,
) -> Result<(elevate::WriteOutcome, String), String> {
    let current = match current {
        Some(c) => c,
        None => std::fs::read_to_string(&state.hosts_path).map_err(|e| format!("Failed to read the hosts file: {e}"))?,
    };

    let timestamp = chrono::Utc::now().format("%Y%m%dT%H%M%S%.3fZ");
    let backup_path = state.backups_dir.join(format!("hosts-{timestamp}.bak"));
    std::fs::write(&backup_path, &current).map_err(|e| format!("Failed to write backup: {e}"))?;
    prune_backups(&state.backups_dir);

    *state.last_written.lock_recover() = Some(new_content.to_string());

    let flush_cmd = if do_flush { dns_flush::flush_command() } else { None };

    let plain_elevated_write = |content: &str| -> Result<elevate::WriteOutcome, String> {
        let staging_path = state.backups_dir.join(".staging-hosts");
        hosts_parser::atomic_write(&staging_path, content)
            .map_err(|e| format!("Failed to stage the hosts file: {e}"))?;
        elevate::write_hosts_file(state.executor.as_ref(), &staging_path, &state.hosts_path, flush_cmd.as_deref())
    };

    let client_token = helper_client::load_token(&state.app_data_dir);
    let reachable_token = client_token.as_deref().filter(|t| helper_client::ping(t));

    // The attempt is a labeled block (not a helper function) so every
    // failure path — not just a successfully *attempted* write that came
    // back unsuccessful — goes through the same `last_written` cleanup
    // below. Without this, a hard failure to even run the elevated command
    // (cancelled, timed out, osascript/pkexec missing) would return early
    // via `?` and skip resetting `last_written`, leaving it primed with
    // content that was never actually written — so a later, unrelated
    // external edit that happened to produce those exact same bytes would be
    // silently mistaken for this write having landed.
    let attempt: Result<elevate::WriteOutcome, String> = 'attempt: {
        if let Some(token) = reachable_token {
            let write_ok = helper_client::write_hosts(token, new_content).is_ok();
            let flush_ok = if write_ok && do_flush {
                Some(helper_client::flush_dns(token).is_ok())
            } else {
                None
            };
            break 'attempt Ok(elevate::WriteOutcome { write_ok, flush_ok });
        }
        if state.helper_enabled.load(std::sync::atomic::Ordering::Relaxed) {
            match helper_install::install_and_write(
                app,
                state.executor.as_ref(),
                &state.backups_dir,
                new_content,
                &state.hosts_path,
                flush_cmd.as_deref(),
            ) {
                Ok(outcome) => Ok(outcome),
                Err(_) => plain_elevated_write(new_content),
            }
        } else {
            plain_elevated_write(new_content)
        }
    };
    let outcome = match attempt {
        Ok(outcome) => outcome,
        Err(e) => {
            *state.last_written.lock_recover() = None;
            return Err(e);
        }
    };

    if !outcome.write_ok {
        *state.last_written.lock_recover() = None;
    }

    Ok((outcome, backup_path.to_string_lossy().to_string()))
}

/// Number of `hosts-*.bak` snapshots to retain in `backups_dir`; older ones
/// are deleted after every write. Mirrors `history`'s row-count pruning
/// (`prune_history`) — without this, backups accumulate one file per write
/// forever, unlike every other piece of app-managed state.
const BACKUP_RETENTION_COUNT: usize = 200;

fn prune_backups(backups_dir: &Path) {
    let Ok(read_dir) = std::fs::read_dir(backups_dir) else {
        return;
    };
    let mut backups: Vec<PathBuf> = read_dir
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with("hosts-") && n.ends_with(".bak"))
        })
        .collect();
    if backups.len() <= BACKUP_RETENTION_COUNT {
        return;
    }
    // Filenames embed a sortable timestamp (hosts-%Y%m%dT%H%M%S%.3fZ.bak),
    // so lexicographic order is chronological order.
    backups.sort();
    for path in &backups[..backups.len() - BACKUP_RETENTION_COUNT] {
        let _ = std::fs::remove_file(path);
    }
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

/// A ceiling under the Settings page's "Unlimited" history retention option
/// — large enough that no realistic amount of everyday use ever reaches it
/// (thousands of writes), but finite, so `HistoryView`'s unvirtualized list
/// (and the `get_history` payload feeding it) has a hard upper bound instead
/// of being able to grow without limit over months/years of use.
const UNLIMITED_HISTORY_CAP: i64 = 5_000;

/// Reads the Settings page "History retention" limit. Defaults to 200
/// when unset; the "unlimited" option maps to `UNLIMITED_HISTORY_CAP`.
fn history_retention_limit(conn: &rusqlite::Connection) -> Option<i64> {
    match store::get_setting(conn, "history_retention").ok().flatten() {
        None => Some(200),
        Some(v) if v == "unlimited" => Some(UNLIMITED_HISTORY_CAP),
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

/// Reads the Settings page "Propagate new IPs across group" toggle (on by
/// default).
fn propagate_group_ips_enabled(conn: &rusqlite::Connection) -> bool {
    store::get_setting(conn, "propagate_group_ips")
        .ok()
        .flatten()
        .map(|v| v != "false")
        .unwrap_or(true)
}

/// The IP candidates on `after` that weren't already on `before` — i.e.
/// what this save just introduced. `before` is `None` for a brand-new
/// entry, in which case every one of its IPs counts as newly introduced.
fn newly_added_ips(before: Option<&Entry>, after: &Entry) -> Vec<IpCandidate> {
    match before {
        None => after.ips.clone(),
        Some(before) => {
            let existing: std::collections::HashSet<&str> = before.ips.iter().map(|i| i.id.as_str()).collect();
            after.ips.iter().filter(|ip| !existing.contains(ip.id.as_str())).cloned().collect()
        }
    }
}

/// The IP candidates on `after` whose *label* changed from `before` while
/// their address stayed the same (an address that also changed isn't a
/// "relabel" — `newly_added_ips` handles genuinely new candidates instead).
/// `before` is `None` for a brand-new entry, which has nothing to relabel.
fn relabeled_ips(before: Option<&Entry>, after: &Entry) -> Vec<IpCandidate> {
    let Some(before) = before else {
        return Vec::new();
    };
    let before_by_id: std::collections::HashMap<&str, &IpCandidate> = before.ips.iter().map(|i| (i.id.as_str(), i)).collect();
    after
        .ips
        .iter()
        .filter(|ip| before_by_id.get(ip.id.as_str()).is_some_and(|prev| prev.ip == ip.ip && prev.label != ip.label))
        .cloned()
        .collect()
}

/// Computes both group-propagation plans for a just-saved entry (read-only
/// — safe to call from `preview_save`): new IPs that should be added as
/// candidates to every other entry in its group, and label edits that
/// should be carried over to matching-address candidates there too. Also
/// returns the review-changes-modal notices describing whichever of those
/// actually apply. Every list comes back empty when the setting is off or
/// the entry isn't in a group.
fn group_propagation_plans(
    conn: &rusqlite::Connection,
    before: Option<&Entry>,
    after: &Entry,
) -> Result<(store::GroupPropagationPlan, store::GroupRelabelPlan, Vec<crate::models::GroupPropagationNotice>), String> {
    if !propagate_group_ips_enabled(conn) || after.group.is_empty() {
        return Ok((Vec::new(), Vec::new(), Vec::new()));
    }

    // Fetched once and shared by both plan functions below, rather than
    // each independently re-querying the full entry list.
    let entries = store::list_entries(conn).map_err(|e| e.to_string())?;

    let new_ips = newly_added_ips(before, after);
    let add_plan = store::group_propagation_plan(&entries, &after.group, &after.id, &new_ips);

    let relabeled = relabeled_ips(before, after);
    let relabel_plan = store::group_relabel_plan(&entries, &after.group, &after.id, &relabeled);

    let mut notices = Vec::new();
    if !add_plan.is_empty() {
        let mut ips: Vec<String> = Vec::new();
        for (_, added) in &add_plan {
            for ip in added {
                if !ips.contains(&ip.ip) {
                    ips.push(ip.ip.clone());
                }
            }
        }
        notices.push(crate::models::GroupPropagationNotice {
            group: after.group.clone(),
            kind: "added".to_string(),
            ips,
            hostnames: add_plan.iter().map(|(entry, _)| entry.hostname.clone()).collect(),
        });
    }
    if !relabel_plan.is_empty() {
        let mut ips: Vec<String> = Vec::new();
        for (_, updates) in &relabel_plan {
            for u in updates {
                if !ips.contains(&u.ip) {
                    ips.push(u.ip.clone());
                }
            }
        }
        notices.push(crate::models::GroupPropagationNotice {
            group: after.group.clone(),
            kind: "relabeled".to_string(),
            ips,
            hostnames: relabel_plan.iter().map(|(entry, _)| entry.hostname.clone()).collect(),
        });
    }

    Ok((add_plan, relabel_plan, notices))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::IpDraft;

    fn touch(dir: &Path, name: &str) {
        std::fs::write(dir.join(name), "backup").unwrap();
    }

    fn valid_draft() -> EntryDraft {
        EntryDraft {
            id: None,
            hostname: "api.local".to_string(),
            comment: String::new(),
            group: String::new(),
            enabled: true,
            active_uid: "ip-1".to_string(),
            ips: vec![IpDraft { uid: "ip-1".to_string(), label: String::new(), ip: "10.0.0.1".to_string() }],
        }
    }

    #[test]
    fn validate_draft_accepts_a_plain_comment_and_group() {
        let mut draft = valid_draft();
        draft.comment = "staging box".to_string();
        draft.group = "Work".to_string();
        assert!(validate_draft(&draft).is_ok());
    }

    #[test]
    fn validate_draft_rejects_a_newline_in_the_comment() {
        let mut draft = valid_draft();
        draft.comment = "ok\n169.254.169.254\tmetadata.internal".to_string();
        assert!(validate_draft(&draft).is_err());
    }

    #[test]
    fn validate_draft_rejects_a_newline_in_the_group() {
        let mut draft = valid_draft();
        draft.group = "Work\n# reroute:end".to_string();
        assert!(validate_draft(&draft).is_err());
    }

    #[test]
    fn prune_backups_keeps_only_the_most_recent_n_by_filename_order() {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..(BACKUP_RETENTION_COUNT + 5) {
            touch(dir.path(), &format!("hosts-{i:04}.bak"));
        }

        prune_backups(dir.path());

        let remaining: Vec<String> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(remaining.len(), BACKUP_RETENTION_COUNT);
        // The oldest 5 (lowest-numbered) should be the ones removed.
        assert!(!remaining.contains(&"hosts-0000.bak".to_string()));
        assert!(remaining.contains(&format!("hosts-{:04}.bak", BACKUP_RETENTION_COUNT + 4)));
    }

    #[test]
    fn prune_backups_is_a_noop_when_under_the_limit() {
        let dir = tempfile::tempdir().unwrap();
        touch(dir.path(), "hosts-0001.bak");
        touch(dir.path(), "hosts-0002.bak");

        prune_backups(dir.path());

        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 2);
    }

    #[test]
    fn prune_backups_ignores_non_backup_files() {
        let dir = tempfile::tempdir().unwrap();
        touch(dir.path(), ".staging-hosts");
        touch(dir.path(), "not-a-backup.txt");

        prune_backups(dir.path());

        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 2);
    }

    fn db_with_setting(value: Option<&str>) -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        store::init_db(&conn).unwrap();
        if let Some(v) = value {
            store::set_setting(&conn, "history_retention", v).unwrap();
        }
        conn
    }

    #[test]
    fn history_retention_limit_defaults_to_200_when_unset() {
        let conn = db_with_setting(None);
        assert_eq!(history_retention_limit(&conn), Some(200));
    }

    #[test]
    fn history_retention_limit_parses_a_numeric_setting() {
        let conn = db_with_setting(Some("50"));
        assert_eq!(history_retention_limit(&conn), Some(50));
    }

    // "Unlimited" is capped, not truly boundless — a genuinely unbounded
    // history table backs HistoryView's unvirtualized list, so this caps it
    // at a large-but-finite ceiling instead (see UNLIMITED_HISTORY_CAP).
    #[test]
    fn history_retention_limit_caps_unlimited_instead_of_disabling_pruning() {
        let conn = db_with_setting(Some("unlimited"));
        assert_eq!(history_retention_limit(&conn), Some(UNLIMITED_HISTORY_CAP));
    }
}
