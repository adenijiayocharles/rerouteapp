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
    if helper_client::ping() {
        return match helper_client::flush_dns() {
            Ok(()) => Ok(WriteResult {
                entry: None,
                flush_ok: Some(true),
                flush_message: None,
            }),
            Err(e) => Ok(WriteResult {
                entry: None,
                flush_ok: Some(false),
                flush_message: Some(format!("DNS flush failed: {e}")),
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
    })
}
