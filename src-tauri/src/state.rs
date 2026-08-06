use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::Connection;

use crate::elevate::{self, ElevatedExecutor};
use crate::watcher::LastWrittenContent;

pub struct AppState {
    pub conn: Mutex<Connection>,
    pub hosts_path: PathBuf,
    pub backups_dir: PathBuf,
    pub last_written: LastWrittenContent,
    pub executor: Box<dyn ElevatedExecutor>,
    /// Holds the running file watcher so it isn't dropped (and stopped)
    /// once `setup()` returns; set once via `set_watcher` during startup.
    pub watcher: Mutex<Option<notify::RecommendedWatcher>>,
}

impl AppState {
    pub fn new(app_data_dir: PathBuf, conn: Connection) -> Self {
        let backups_dir = app_data_dir.join("backups");
        std::fs::create_dir_all(&backups_dir).ok();
        Self {
            conn: Mutex::new(conn),
            hosts_path: crate::hosts_parser::hosts_file_path(),
            backups_dir,
            last_written: Default::default(),
            executor: elevate::default_executor(),
            watcher: Mutex::new(None),
        }
    }

    pub fn set_watcher(&self, watcher: notify::RecommendedWatcher) {
        *self.watcher.lock().unwrap() = Some(watcher);
    }
}
