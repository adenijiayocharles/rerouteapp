mod commands;
mod dns_flush;
mod elevate;
mod helper_client;
mod helper_install;
mod hosts_parser;
mod models;
mod state;
mod store;
mod validate;
mod watcher;

use rusqlite::Connection;
use tauri::Manager;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(&app_data_dir)?;

            let db_path = app_data_dir.join("hosts-manager.sqlite3");
            let conn = Connection::open(&db_path)?;
            store::init_db(&conn)?;

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

            let app_state = AppState::new(app_data_dir, conn, helper_enabled);
            let last_written = app_state.last_written.clone();
            let hosts_path = app_state.hosts_path.clone();
            app.manage(app_state);

            match watcher::start_watching(app.handle().clone(), hosts_path, last_written) {
                Ok(w) => app.state::<AppState>().set_watcher(w),
                Err(e) => eprintln!("failed to start hosts file watcher: {e}"),
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_entries,
            commands::get_history,
            commands::is_shadow_domain,
            commands::preview_save,
            commands::confirm_save,
            commands::switch_active_ip,
            commands::toggle_enabled,
            commands::history_diff,
            commands::preview_restore,
            commands::confirm_restore,
            commands::flush_dns,
            commands::helper_status,
            commands::uninstall_helper,
            commands::get_helper_enabled,
            commands::set_helper_enabled,
            commands::get_setting,
            commands::set_setting,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
