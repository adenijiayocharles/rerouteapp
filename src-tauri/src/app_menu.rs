//! The native macOS app menu bar (the app name / File / Edit / View / Window
//! / Help row at the top of the screen, as opposed to `tray.rs`'s menu-bar
//! *icon* dropdown). Tauri builds a default menu with this same shape
//! automatically when no menu is set, but its File submenu only has "Close
//! Window" and has no stable id to look up and extend later, so this
//! reproduces that default structure (see `Menu::default` in the tauri
//! crate) with three extra File items wired to frontend actions.

use tauri::{
    menu::{AboutMetadata, Menu, MenuEvent, MenuItemBuilder, PredefinedMenuItem, Submenu, HELP_SUBMENU_ID, WINDOW_SUBMENU_ID},
    AppHandle, Emitter, Manager, Wry,
};

const ADD_ENTRY_ID: &str = "menu-add-entry";
const FLUSH_DNS_ID: &str = "menu-flush-dns";
const OPEN_RAW_FILE_ID: &str = "menu-open-raw-file";

/// Emitted with one of `"add-entry" | "flush-dns" | "open-raw-file"` so the
/// frontend can dispatch into its own reducer the same way a click on the
/// equivalent button would.
pub const MENU_ACTION_EVENT: &str = "menu-action";

pub fn build(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let pkg_info = app.package_info();
    let config = app.config();
    let about_metadata = AboutMetadata {
        name: Some(pkg_info.name.clone()),
        version: Some(pkg_info.version.to_string()),
        copyright: config.bundle.copyright.clone(),
        authors: config.bundle.publisher.clone().map(|p| vec![p]),
        ..Default::default()
    };

    let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &MenuItemBuilder::with_id(ADD_ENTRY_ID, "Add Entry").accelerator("CmdOrCtrl+N").build(app)?,
            &MenuItemBuilder::with_id(FLUSH_DNS_ID, "Flush DNS Now").build(app)?,
            &MenuItemBuilder::with_id(OPEN_RAW_FILE_ID, "Open Raw File").build(app)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    let window_menu = Submenu::with_id_and_items(
        app,
        WINDOW_SUBMENU_ID,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    let help_menu = Submenu::with_id_and_items(app, HELP_SUBMENU_ID, "Help", true, &[])?;

    Menu::with_items(
        app,
        &[
            &Submenu::with_items(
                app,
                pkg_info.name.clone(),
                true,
                &[
                    &PredefinedMenuItem::about(app, None, Some(about_metadata))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::services(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::hide(app, None)?,
                    &PredefinedMenuItem::hide_others(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::quit(app, None)?,
                ],
            )?,
            &file_menu,
            &edit_menu,
            &Submenu::with_items(app, "View", true, &[&PredefinedMenuItem::fullscreen(app, None)?])?,
            &window_menu,
            &help_menu,
        ],
    )
}

pub fn handle_menu_event(app: &AppHandle, event: MenuEvent) {
    let action = match event.id().0.as_str() {
        ADD_ENTRY_ID => "add-entry",
        FLUSH_DNS_ID => "flush-dns",
        OPEN_RAW_FILE_ID => "open-raw-file",
        _ => return,
    };

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
    let _ = app.emit(MENU_ACTION_EVENT, action);
}
