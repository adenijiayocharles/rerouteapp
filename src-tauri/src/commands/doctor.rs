//! Read-only self-diagnostics ("doctor panel"): a handful of independent
//! health checks a user can run themselves before filing a bug, rather than
//! having to interpret raw error messages or app logs. Each check catches
//! its own failures and downgrades to `Fail`/`Warn` instead of propagating
//! an error, so one broken check never prevents the others from reporting.

use serde::Serialize;
use tauri::State;

use crate::conflicts;
use crate::dns_flush;
use crate::helper_client;
use crate::hosts_parser;
use crate::state::{AppState, PoisonRecoverExt};
use crate::store;

#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum DoctorStatus {
    Ok,
    Warn,
    Fail,
}

#[derive(Serialize, Clone)]
pub struct DoctorCheck {
    pub id: String,
    pub label: String,
    pub status: DoctorStatus,
    pub detail: String,
}

impl DoctorCheck {
    fn new(id: &str, label: &str, status: DoctorStatus, detail: String) -> Self {
        Self { id: id.to_string(), label: label.to_string(), status, detail }
    }
}

#[tauri::command]
pub fn run_diagnostics(state: State<AppState>) -> Vec<DoctorCheck> {
    vec![
        check_hosts_file_access(&state),
        check_helper_daemon(&state),
        check_dns_flush(),
        check_storage(&state),
        check_file_watcher(&state),
        check_hostname_conflicts(&state),
    ]
}

/// The hosts file is readable, and the managed block's marker comments
/// (`# reroute:start` / `# reroute:end`) appear exactly once each — more
/// than one of either means something (another tool, a manual edit)
/// duplicated or otherwise mangled the block; zero while re:route still has
/// managed entries in its own database means the block was likely removed
/// by an external edit.
fn check_hosts_file_access(state: &AppState) -> DoctorCheck {
    let id = "hosts_file";
    let label = "Hosts file access";

    let content = match std::fs::read_to_string(&state.hosts_path) {
        Ok(c) => c,
        Err(e) => {
            return DoctorCheck::new(id, label, DoctorStatus::Fail, format!("Couldn't read {}: {e}", state.hosts_path.display()));
        }
    };

    let start_count = content.lines().filter(|l| l.trim_end() == hosts_parser::START_MARKER).count();
    let end_count = content.lines().filter(|l| l.trim_end() == hosts_parser::END_MARKER).count();

    if start_count > 1 || end_count > 1 || start_count != end_count {
        return DoctorCheck::new(
            id,
            label,
            DoctorStatus::Warn,
            format!(
                "The managed block markers look corrupted (found {start_count} start marker(s), {end_count} end marker(s)). Try re-saving from the Raw File view."
            ),
        );
    }

    if start_count == 0 {
        let entry_count = {
            let conn = state.read_conn.lock_recover();
            store::list_entries(&conn).map(|e| e.len()).unwrap_or(0)
        };
        if entry_count > 0 {
            return DoctorCheck::new(
                id,
                label,
                DoctorStatus::Warn,
                format!(
                    "re:route has {entry_count} managed entries, but no managed block was found in the hosts file — it may have been edited externally."
                ),
            );
        }
    }

    DoctorCheck::new(id, label, DoctorStatus::Ok, "The hosts file is readable and the managed block is intact.".to_string())
}

/// Whether the privileged helper daemon (macOS-only background writer) is
/// enabled, and if so, whether it's actually reachable right now — mirrors
/// the same reachability check `helper_status` uses for the sidebar
/// indicator, so this doesn't drift from what the write path itself sees.
fn check_helper_daemon(state: &AppState) -> DoctorCheck {
    let id = "helper";
    let label = "Helper daemon";

    if !state.helper_enabled.load(std::sync::atomic::Ordering::Relaxed) {
        return DoctorCheck::new(
            id,
            label,
            DoctorStatus::Ok,
            "Helper daemon is disabled; writes use a one-off elevation prompt instead.".to_string(),
        );
    }

    let reachable = helper_client::load_token(&state.app_data_dir).is_some_and(|t| helper_client::ping(&t));
    if reachable {
        DoctorCheck::new(
            id,
            label,
            DoctorStatus::Ok,
            "Helper daemon is installed and reachable; writes won't prompt for a password.".to_string(),
        )
    } else {
        DoctorCheck::new(
            id,
            label,
            DoctorStatus::Warn,
            "Helper daemon is enabled but not currently reachable; it will be reinstalled (one prompt) on the next write.".to_string(),
        )
    }
}

/// Whether this OS has a supported way to flush the DNS resolver cache —
/// always true on macOS/Windows, conditional on Linux (`resolvectl`/`nscd`
/// detection in `dns_flush::flush_command`).
fn check_dns_flush() -> DoctorCheck {
    let id = "dns_flush";
    let label = "DNS flush capability";
    match dns_flush::flush_command() {
        Some(_) => {
            let detail = match dns_flush::resolver_name() {
                Some(name) => format!("A DNS cache flush command is available ({name} detected)."),
                None => "A DNS cache flush command is available on this system.".to_string(),
            };
            DoctorCheck::new(id, label, DoctorStatus::Ok, detail)
        }
        None => DoctorCheck::new(
            id,
            label,
            DoctorStatus::Warn,
            "No supported DNS resolver cache (systemd-resolved, dnsmasq, or nscd) was detected; changes may take a while to apply."
                .to_string(),
        ),
    }
}

/// The backups directory is actually writable (probed with a throwaway
/// file, since a stale/permission-denied directory would otherwise only
/// surface as a failure deep inside the next write) and the local database
/// connection responds.
fn check_storage(state: &AppState) -> DoctorCheck {
    let id = "storage";
    let label = "Backups & app data";

    let probe_path = state.backups_dir.join(".doctor-write-probe");
    if let Err(e) = std::fs::write(&probe_path, b"ok") {
        return DoctorCheck::new(id, label, DoctorStatus::Fail, format!("The backups directory isn't writable: {e}"));
    }
    let _ = std::fs::remove_file(&probe_path);

    {
        let conn = state.read_conn.lock_recover();
        if let Err(e) = conn.query_row("SELECT 1", [], |_| Ok(())) {
            return DoctorCheck::new(id, label, DoctorStatus::Fail, format!("Couldn't query the local database: {e}"));
        }
    }

    let backup_count = std::fs::read_dir(&state.backups_dir)
        .map(|read_dir| {
            read_dir
                .filter_map(|entry| entry.ok())
                .filter(|entry| entry.file_name().to_string_lossy().starts_with("hosts-"))
                .count()
        })
        .unwrap_or(0);

    DoctorCheck::new(
        id,
        label,
        DoctorStatus::Ok,
        format!("Backups directory and local database are writable ({backup_count} backup(s) stored)."),
    )
}

/// Whether the OS-native file watcher on the hosts file successfully
/// started at launch (`state.watcher` is only ever populated on success —
/// see `lib.rs::run`'s `start_watching` call). If it didn't, external edits
/// won't trigger the "reload?" prompt.
fn check_file_watcher(state: &AppState) -> DoctorCheck {
    let id = "watcher";
    let label = "File watcher";
    if state.watcher.lock_recover().is_some() {
        DoctorCheck::new(id, label, DoctorStatus::Ok, "Watching the hosts file for external edits.".to_string())
    } else {
        DoctorCheck::new(
            id,
            label,
            DoctorStatus::Warn,
            "The file watcher isn't active; edits made outside re:route won't be detected automatically.".to_string(),
        )
    }
}

/// Whether any two *enabled* entries claim the same hostname with
/// different active IPs — a real hosts file silently uses whichever line
/// comes first, so this would otherwise fail silently. Reuses the same
/// `conflicts::find_conflicts` the list-view badges and save/switch/toggle
/// warnings are built on, so this can't drift from what those surfaces see.
fn check_hostname_conflicts(state: &AppState) -> DoctorCheck {
    let id = "conflicts";
    let label = "Hostname conflicts";

    let entries = {
        let conn = state.read_conn.lock_recover();
        store::list_entries(&conn).unwrap_or_default()
    };
    let found = conflicts::find_conflicts(&entries);

    if found.is_empty() {
        return DoctorCheck::new(id, label, DoctorStatus::Ok, "No enabled entries claim the same hostname with different IPs.".to_string());
    }

    let hostnames: Vec<&str> = found.iter().map(|c| c.hostname.as_str()).collect();
    DoctorCheck::new(
        id,
        label,
        DoctorStatus::Warn,
        format!(
            "{} hostname(s) are claimed by more than one enabled entry with different IPs — only one will actually take effect: {}.",
            found.len(),
            hostnames.join(", ")
        ),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::elevate;
    use crate::models::{EntryDraft, IpDraft};
    use rusqlite::Connection;
    use std::sync::atomic::AtomicBool;
    use std::sync::Mutex;

    fn test_state(dir: &std::path::Path, helper_enabled: bool) -> AppState {
        let db_path = dir.join("reroute.sqlite3");
        let conn = Connection::open(&db_path).unwrap();
        store::init_db(&conn).unwrap();
        let read_conn = Connection::open(&db_path).unwrap();
        let backups_dir = dir.join("backups");
        std::fs::create_dir_all(&backups_dir).unwrap();
        AppState {
            app_data_dir: dir.to_path_buf(),
            conn: Mutex::new(conn),
            read_conn: Mutex::new(read_conn),
            hosts_path: dir.join("hosts"),
            backups_dir,
            last_written: Default::default(),
            executor: elevate::default_executor(),
            watcher: Mutex::new(None),
            helper_enabled: AtomicBool::new(helper_enabled),
        }
    }

    fn hosts_content_with_block(inner: &str) -> String {
        format!("127.0.0.1 localhost\n{}\n{inner}\n{}\n", hosts_parser::START_MARKER, hosts_parser::END_MARKER)
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
    fn hosts_file_access_ok_when_block_is_intact() {
        let dir = tempfile::tempdir().unwrap();
        let state = test_state(dir.path(), false);
        std::fs::write(&state.hosts_path, hosts_content_with_block("1.2.3.4 example.test")).unwrap();

        assert_eq!(check_hosts_file_access(&state).status, DoctorStatus::Ok);
    }

    #[test]
    fn hosts_file_access_warns_on_duplicated_markers() {
        let dir = tempfile::tempdir().unwrap();
        let state = test_state(dir.path(), false);
        let content = format!(
            "{s}\n1.2.3.4 a.test\n{s}\n{e}\n5.6.7.8 b.test\n{e}\n",
            s = hosts_parser::START_MARKER,
            e = hosts_parser::END_MARKER
        );
        std::fs::write(&state.hosts_path, content).unwrap();

        assert_eq!(check_hosts_file_access(&state).status, DoctorStatus::Warn);
    }

    #[test]
    fn hosts_file_access_fails_when_hosts_file_is_missing() {
        let dir = tempfile::tempdir().unwrap();
        let state = test_state(dir.path(), false);
        // state.hosts_path deliberately never created.

        assert_eq!(check_hosts_file_access(&state).status, DoctorStatus::Fail);
    }

    #[test]
    fn hosts_file_access_warns_when_block_missing_but_db_has_entries() {
        let dir = tempfile::tempdir().unwrap();
        let state = test_state(dir.path(), false);
        std::fs::write(&state.hosts_path, "127.0.0.1 localhost\n").unwrap();
        {
            let conn = state.conn.lock_recover();
            store::insert_entry(&conn, &valid_draft()).unwrap();
        }

        assert_eq!(check_hosts_file_access(&state).status, DoctorStatus::Warn);
    }

    #[test]
    fn hosts_file_access_ok_when_block_and_db_are_both_empty() {
        let dir = tempfile::tempdir().unwrap();
        let state = test_state(dir.path(), false);
        std::fs::write(&state.hosts_path, "127.0.0.1 localhost\n").unwrap();

        assert_eq!(check_hosts_file_access(&state).status, DoctorStatus::Ok);
    }

    #[test]
    fn helper_daemon_ok_when_disabled() {
        let dir = tempfile::tempdir().unwrap();
        let state = test_state(dir.path(), false);

        assert_eq!(check_helper_daemon(&state).status, DoctorStatus::Ok);
    }

    #[test]
    fn helper_daemon_warns_when_enabled_but_unreachable() {
        let dir = tempfile::tempdir().unwrap();
        let state = test_state(dir.path(), true);
        // No client token file was written to app_data_dir, so this can't be reachable.

        assert_eq!(check_helper_daemon(&state).status, DoctorStatus::Warn);
    }

    #[test]
    fn dns_flush_check_reports_the_expected_id() {
        let check = check_dns_flush();
        assert_eq!(check.id, "dns_flush");
        if let Some(name) = dns_flush::resolver_name() {
            assert!(check.detail.contains(name));
        }
    }

    #[test]
    fn storage_ok_and_counts_backups() {
        let dir = tempfile::tempdir().unwrap();
        let state = test_state(dir.path(), false);
        std::fs::write(state.backups_dir.join("hosts-20260101T000000.000Z.bak"), "x").unwrap();
        std::fs::write(state.backups_dir.join("hosts-20260102T000000.000Z.bak"), "x").unwrap();

        let check = check_storage(&state);
        assert_eq!(check.status, DoctorStatus::Ok);
        assert!(check.detail.contains('2'));
    }

    #[test]
    fn file_watcher_warns_when_not_started() {
        let dir = tempfile::tempdir().unwrap();
        let state = test_state(dir.path(), false);

        assert_eq!(check_file_watcher(&state).status, DoctorStatus::Warn);
    }

    #[test]
    fn file_watcher_ok_when_started() {
        let dir = tempfile::tempdir().unwrap();
        let state = test_state(dir.path(), false);
        let watcher = notify::recommended_watcher(|_res: notify::Result<notify::Event>| {}).unwrap();
        state.set_watcher(watcher);

        assert_eq!(check_file_watcher(&state).status, DoctorStatus::Ok);
    }

    #[test]
    fn hostname_conflicts_ok_when_none() {
        let dir = tempfile::tempdir().unwrap();
        let state = test_state(dir.path(), false);
        {
            let conn = state.conn.lock_recover();
            store::insert_entry(&conn, &valid_draft()).unwrap();
        }

        assert_eq!(check_hostname_conflicts(&state).status, DoctorStatus::Ok);
    }

    #[test]
    fn hostname_conflicts_warns_when_two_enabled_entries_disagree() {
        let dir = tempfile::tempdir().unwrap();
        let state = test_state(dir.path(), false);
        {
            let conn = state.conn.lock_recover();
            store::insert_entry(&conn, &valid_draft()).unwrap();
            let mut other = valid_draft();
            other.ips = vec![IpDraft { uid: "ip-2".to_string(), label: String::new(), ip: "10.0.0.2".to_string() }];
            other.active_uid = "ip-2".to_string();
            store::insert_entry(&conn, &other).unwrap();
        }

        let check = check_hostname_conflicts(&state);
        assert_eq!(check.status, DoctorStatus::Warn);
        assert!(check.detail.contains("api.local"));
    }
}
