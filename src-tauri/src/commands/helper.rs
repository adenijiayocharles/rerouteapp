//! Privileged helper daemon lifecycle: status, uninstall, and the Settings
//! page toggle controlling whether the app is allowed to auto-install it.

use tauri::State;

use crate::elevate;
use crate::helper_client;
use crate::state::{AppState, PoisonRecoverExt};
use crate::store;

/// Whether the privileged helper daemon is currently installed and
/// reachable (drives the sidebar's helper-status indicator).
#[tauri::command]
pub fn helper_status(state: State<AppState>) -> bool {
    helper_client::load_token(&state.app_data_dir).is_some_and(|token| helper_client::ping(&token))
}

/// Whether the privileged helper daemon is supported on this OS at all
/// (macOS-only — see the crate's top-level privilege-model docs). Lets the
/// Settings page hide the "Background helper" toggle entirely on
/// Windows/Linux instead of offering a control that can never take effect
/// there — mirrors the same `cfg!(target_os = "macos")` gate the Doctor
/// panel's equivalent check already uses.
#[tauri::command]
pub fn helper_supported_on_this_platform() -> bool {
    cfg!(target_os = "macos")
}

/// Removes the helper daemon (one elevated prompt): stops it via launchd
/// and deletes its binary, LaunchDaemon plist, and auth token. Also drops
/// the client's own token copy so a stale one can't linger. Subsequent
/// writes fall back to per-write elevation until it's reinstalled.
#[tauri::command]
pub fn uninstall_helper(state: State<AppState>) -> Result<(), String> {
    let cmd = elevate::build_uninstall_command();
    state.executor.run_privileged_shell(&cmd).map(|_| ())?;
    let _ = std::fs::remove_file(state.app_data_dir.join(helper_client::CLIENT_TOKEN_FILENAME));
    Ok(())
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
    let conn = state.conn.lock_recover();
    store::set_setting(&conn, "helper_enabled", if enabled { "true" } else { "false" }).map_err(|e| e.to_string())?;
    state.helper_enabled.store(enabled, std::sync::atomic::Ordering::Relaxed);
    Ok(())
}
