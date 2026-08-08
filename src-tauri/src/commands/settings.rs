//! Generic settings-table accessors for Settings page preferences that
//! don't need a bespoke command pair each (unlike `helper_enabled`, which
//! is read from inside write commands while `conn` is already locked —
//! see its comment on `AppState`).

use tauri::State;

use crate::state::AppState;
use crate::store;

#[tauri::command]
pub fn get_setting(state: State<AppState>, key: String) -> Result<Option<String>, String> {
    let conn = state.read_conn.lock().unwrap();
    store::get_setting(&conn, &key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_setting(state: State<AppState>, key: String, value: String) -> Result<(), String> {
    let conn = state.conn.lock().unwrap();
    store::set_setting(&conn, &key, &value).map_err(|e| e.to_string())
}
