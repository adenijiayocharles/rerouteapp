use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Mutex, MutexGuard};

use rusqlite::Connection;

use crate::elevate::{self, ElevatedExecutor};
use crate::watcher::LastWrittenContent;

/// Recovers from a poisoned lock instead of panicking every subsequent
/// caller for the rest of the process's life. The data behind every
/// `Mutex` in this app (a SQLite `Connection`, the watcher handle, the
/// watcher's own snapshot strings) stays structurally valid even if some
/// *other* operation panicked while holding the lock — a panic mid-write
/// doesn't corrupt the `Connection` object itself, it just means that
/// particular operation didn't finish — so recovering and carrying on is
/// safer than bricking every future command that touches this state.
pub trait PoisonRecoverExt<T> {
    fn lock_recover(&self) -> MutexGuard<'_, T>;
}

impl<T> PoisonRecoverExt<T> for Mutex<T> {
    fn lock_recover(&self) -> MutexGuard<'_, T> {
        self.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

pub struct AppState {
    pub app_data_dir: PathBuf,
    pub conn: Mutex<Connection>,
    /// A second connection used by read-only commands (list/history/get_setting/
    /// preview_*). Write commands hold `conn`'s lock for their whole duration,
    /// including a potentially long-blocking elevation prompt (see
    /// `write_content_to_hosts_file`) — without a separate connection, every
    /// read-only command would hang for as long as that prompt is open.
    /// SQLite permits concurrent readers while a writer's transaction is open
    /// but not yet committed, so this is safe under the default journal mode.
    pub read_conn: Mutex<Connection>,
    pub hosts_path: PathBuf,
    pub backups_dir: PathBuf,
    pub last_written: LastWrittenContent,
    pub executor: Box<dyn ElevatedExecutor>,
    /// Holds the running file watcher so it isn't dropped (and stopped)
    /// once `setup()` returns; set once via `set_watcher` during startup.
    pub watcher: Mutex<Option<notify::RecommendedWatcher>>,
    /// Whether the app is allowed to auto-install the privileged helper
    /// daemon on the next write. Cached outside `conn` (rather than read
    /// from the `settings` table on every write) because write commands
    /// hold `conn`'s lock for their whole duration, and `Mutex` isn't
    /// reentrant. Defaults to `true`; persisted in the `settings` table.
    pub helper_enabled: AtomicBool,
}

impl AppState {
    pub fn new(app_data_dir: PathBuf, conn: Connection, read_conn: Connection, helper_enabled: bool) -> Self {
        let backups_dir = app_data_dir.join("backups");
        std::fs::create_dir_all(&backups_dir).ok();
        Self {
            app_data_dir,
            conn: Mutex::new(conn),
            read_conn: Mutex::new(read_conn),
            hosts_path: crate::hosts_parser::hosts_file_path(),
            backups_dir,
            last_written: Default::default(),
            executor: elevate::default_executor(),
            watcher: Mutex::new(None),
            helper_enabled: AtomicBool::new(helper_enabled),
        }
    }

    pub fn set_watcher(&self, watcher: notify::RecommendedWatcher) {
        *self.watcher.lock_recover() = Some(watcher);
    }
}
