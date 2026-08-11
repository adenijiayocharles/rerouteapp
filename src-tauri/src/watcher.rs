//! Watches the hosts file for out-of-band edits (changes made outside the
//! app) and emits a Tauri event so the frontend can prompt to reload
//! instead of silently overwriting whatever the user just did by hand.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};

use crate::state::PoisonRecoverExt;

pub const HOSTS_FILE_CHANGED_EXTERNALLY_EVENT: &str = "hosts-file-changed-externally";

/// Tracks the content we ourselves last wrote, so our own writes don't
/// trigger a false "changed externally" prompt.
pub type LastWrittenContent = Arc<Mutex<Option<String>>>;

pub fn start_watching(
    app: AppHandle,
    hosts_path: PathBuf,
    last_written: LastWrittenContent,
) -> notify::Result<RecommendedWatcher> {
    // What the watcher itself last observed on disk, seeded with the
    // current content so a notification that doesn't represent an actual
    // change (a spurious/coalesced FSEvents notification, or one that
    // fires while a pending write is still in flight — see
    // `write_content_to_hosts_file`'s comment on priming `last_written`
    // before a possibly slow/elevation-prompt-blocked write) is recognized
    // as a no-op rather than compared against the *pending* write's
    // content, which is what it landing would look like, not what "no
    // change yet" looks like.
    let last_observed: Arc<Mutex<Option<String>>> =
        Arc::new(Mutex::new(std::fs::read_to_string(&hosts_path).ok()));

    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(event) = res else { return };
        if !event.kind.is_modify() && !event.kind.is_create() {
            return;
        }
        let Ok(current) = std::fs::read_to_string(&hosts_path) else {
            return;
        };

        {
            let mut seen = last_observed.lock_recover();
            if seen.as_deref() == Some(current.as_str()) {
                // Nothing actually changed since we last looked; don't
                // treat this as either our own write landing or an
                // external edit.
                return;
            }
            *seen = Some(current.clone());
        }

        let mut guard = last_written.lock_recover();
        if guard.as_deref() == Some(current.as_str()) {
            // This is our own write settling; ignore it, and clear the
            // guard so a later external write that happens to reproduce
            // these exact bytes isn't also mistaken for us.
            *guard = None;
            return;
        }
        *guard = None;
        drop(guard);
        let _ = app.emit(HOSTS_FILE_CHANGED_EXTERNALLY_EVENT, ());
    })?;

    // No `.configure(...)` call here: `RecommendedWatcher` resolves to a
    // native OS event backend on every platform this app targets (FSEvents
    // on macOS, inotify on Linux, ReadDirectoryChangesW on Windows), none
    // of which read `with_poll_interval` — that option only affects the
    // separate, unused `PollWatcher` fallback backend, so setting it here
    // would be a no-op that misleadingly implies a polling cadence.

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
