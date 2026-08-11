mod commands;
mod diff;
mod dns_flush;
mod elevate;
mod helper_client;
mod helper_install;
mod hosts_parser;
mod lint;
mod models;
mod state;
mod store;
mod tray;
mod validate;
mod watcher;

use rusqlite::Connection;
use tauri::Manager;
use tauri_plugin_notification::NotificationExt;

use state::{AppState, PoisonRecoverExt};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // Requested once at startup rather than lazily on the first
            // tray-triggered switch, so the OS permission prompt (if the
            // user hasn't already granted/denied it) doesn't surprise them
            // in the middle of a quick menu-bar action.
            match app.notification().permission_state() {
                Ok(state) => {
                    eprintln!("notification permission state at startup: {state:?}");
                    if state != tauri_plugin_notification::PermissionState::Granted {
                        match app.notification().request_permission() {
                            Ok(state) => eprintln!("notification permission state after request: {state:?}"),
                            Err(e) => eprintln!("notification permission request failed: {e}"),
                        }
                    }
                }
                Err(e) => eprintln!("failed to read notification permission state: {e}"),
            }

            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(&app_data_dir)?;

            let db_path = app_data_dir.join("reroute.sqlite3");
            let conn = Connection::open(&db_path)?;
            store::init_db(&conn)?;
            let read_conn = Connection::open(&db_path)?;

            // First-run import: if the DB has no entries yet but the
            // hosts file already has an app-managed block (e.g. a prior
            // install), seed the DB from it instead of silently
            // discarding it the first time we regenerate the block.
            if let Ok(content) = std::fs::read_to_string(hosts_parser::hosts_file_path()) {
                let parsed_lines = hosts_parser::parse_managed_block(&content);
                store::seed_from_existing_managed_block(&conn, &parsed_lines)?;
            }

            let helper_enabled = store::get_setting(&conn, "helper_enabled")
                .ok()
                .flatten()
                .map(|v| v != "false")
                .unwrap_or(true);

            let app_state = AppState::new(app_data_dir, conn, read_conn, helper_enabled);
            let last_written = app_state.last_written.clone();
            let hosts_path = app_state.hosts_path.clone();
            app.manage(app_state);

            match watcher::start_watching(app.handle().clone(), hosts_path, last_written) {
                Ok(w) => app.state::<AppState>().set_watcher(w),
                Err(e) => eprintln!("failed to start hosts file watcher: {e}"),
            }

            let initial_entries = {
                let state = app.state::<AppState>();
                let conn = state.read_conn.lock_recover();
                store::list_entries(&conn).unwrap_or_default()
            };
            if let Err(e) = tray::build(app.handle(), &initial_entries) {
                eprintln!("failed to build the menu bar tray icon: {e}");
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window must not exit the process: the tray icon,
            // the hosts-file watcher, and autostart-at-login only make sense
            // if the app keeps running as a menu bar utility after the
            // window is dismissed. Real exit goes through the tray's own
            // "Quit" item (PredefinedMenuItem::quit) instead.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::entries::list_entries,
            commands::entries::get_history,
            commands::entries::is_shadow_domain,
            commands::entries::preview_save,
            commands::entries::confirm_save,
            commands::entries::switch_active_ip,
            commands::entries::toggle_enabled,
            commands::entries::history_diff,
            commands::entries::preview_restore,
            commands::entries::confirm_restore,
            commands::entries::preview_delete,
            commands::entries::confirm_delete,
            commands::entries::rename_group,
            commands::adopt::list_unmanaged_entries,
            commands::adopt::preview_adopt,
            commands::adopt::confirm_adopt,
            commands::adopt::confirm_adopt_many,
            commands::raw_save::read_hosts_file,
            commands::raw_save::preview_raw_save,
            commands::raw_save::lint_hosts_content,
            commands::raw_save::confirm_raw_save,
            commands::dns::flush_dns,
            commands::helper::helper_status,
            commands::helper::uninstall_helper,
            commands::helper::get_helper_enabled,
            commands::helper::set_helper_enabled,
            commands::settings::get_setting,
            commands::settings::set_setting,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
