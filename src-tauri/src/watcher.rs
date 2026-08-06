//! Watches the hosts file for out-of-band edits (changes made outside the
//! app) and emits a Tauri event so the frontend can prompt to reload
//! instead of silently overwriting whatever the user just did by hand.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};

pub const HOSTS_FILE_CHANGED_EXTERNALLY_EVENT: &str = "hosts-file-changed-externally";

/// Tracks the content we ourselves last wrote, so our own writes don't
/// trigger a false "changed externally" prompt.
pub type LastWrittenContent = Arc<Mutex<Option<String>>>;

pub fn start_watching(
    app: AppHandle,
    hosts_path: PathBuf,
    last_written: LastWrittenContent,
) -> notify::Result<RecommendedWatcher> {
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(event) = res else { return };
        if !event.kind.is_modify() && !event.kind.is_create() {
            return;
        }
        let Ok(current) = std::fs::read_to_string(&hosts_path) else {
            return;
        };
        let mut guard = last_written.lock().unwrap();
        if guard.as_deref() == Some(current.as_str()) {
            // This is our own write settling; ignore it.
            return;
        }
        *guard = None;
        drop(guard);
        let _ = app.emit(HOSTS_FILE_CHANGED_EXTERNALLY_EVENT, ());
    })?;

    watcher.configure(
        notify::Config::default().with_poll_interval(Duration::from_millis(500)),
    )?;

    let watch_target = hosts_file_watch_target();
    watcher.watch(&watch_target, RecursiveMode::NonRecursive)?;
    Ok(watcher)
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn hosts_file_watch_target() -> PathBuf {
    PathBuf::from("/etc/hosts")
}

#[cfg(target_os = "windows")]
fn hosts_file_watch_target() -> PathBuf {
    crate::hosts_parser::hosts_file_path()
}
