//! The standalone "Flush DNS now" action, independent of any edit.

use tauri::State;

use super::WriteResult;
use crate::dns_flush;
use crate::elevate;
use crate::helper_client;
use crate::state::AppState;

/// Prefers the helper daemon (no prompt); falls back to a one-off elevated
/// call if the daemon isn't installed/running (this action alone never
/// triggers a daemon install — that only happens on an actual write).
#[tauri::command]
pub fn flush_dns(state: State<AppState>) -> Result<WriteResult, String> {
    let client_token = helper_client::load_token(&state.app_data_dir);
    if let Some(token) = client_token.as_deref().filter(|t| helper_client::ping(t)) {
        return match helper_client::flush_dns(token) {
            Ok(()) => Ok(WriteResult {
                entry: None,
                flush_ok: Some(true),
                flush_message: None,
                conflict_warning: None,
            }),
            Err(e) => Ok(WriteResult {
                entry: None,
                flush_ok: Some(false),
                flush_message: Some(format!("DNS flush failed: {e}")),
                conflict_warning: None,
            }),
        };
    }

    let Some(cmd) = dns_flush::flush_command() else {
        return Ok(WriteResult {
            entry: None,
            flush_ok: None,
            flush_message: Some(
                "No supported DNS resolver cache was found on this system.".to_string(),
            ),
            conflict_warning: None,
        });
    };
    let ok = elevate::run_flush_only(state.executor.as_ref(), &cmd)?;
    Ok(WriteResult {
        entry: None,
        flush_ok: Some(ok),
        flush_message: if ok {
            None
        } else {
            Some("DNS flush failed. You can retry from here.".to_string())
        },
        conflict_warning: None,
    })
}
