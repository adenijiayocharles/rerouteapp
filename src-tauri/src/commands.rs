//! Tauri command surface, split by concern into submodules:
//! - `entries` — CRUD + preview/confirm for structured, app-managed entries
//! - `adopt` — surfacing and importing hosts-file lines outside the managed block
//! - `raw_save` — the raw hosts-file editor's preview/lint/save + reconciliation
//! - `dns` — the standalone "Flush DNS now" action
//! - `helper` — privileged helper daemon lifecycle
//! - `settings` — generic settings-table accessors
//!
//! This module itself only holds what's genuinely shared across more than
//! one of those: the write pipeline (backup, elevation, the file watcher's
//! own-write guard), draft validation/conversion, and history pruning.

use serde::Serialize;
use tauri::AppHandle;

use crate::dns_flush;
use crate::elevate;
use crate::helper_client;
use crate::helper_install;
use crate::hosts_parser;
use crate::models::{Entry, EntryDraft, IpCandidate};
use crate::state::AppState;
use crate::store;
use crate::validate;

pub mod adopt;
pub mod dns;
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

    let new_ips = newly_added_ips(before, after);
    let add_plan = store::group_propagation_plan(conn, &after.group, &after.id, &new_ips).map_err(|e| e.to_string())?;

    let relabeled = relabeled_ips(before, after);
    let relabel_plan = store::group_relabel_plan(conn, &after.group, &after.id, &relabeled).map_err(|e| e.to_string())?;

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
