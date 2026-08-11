//! The macOS menu bar icon: a live-updating dropdown that mirrors the
//! in-app Quick Switch tray (switch an entry's active IP) plus a couple of
//! utility actions, so common switches don't require opening the window.
//!
//! The menu is rebuilt from scratch on every entries-changing write (see
//! `sync`, called from each mutating command once its transaction commits)
//! rather than mutated in place, since a rebuild from the already-known
//! post-write `entries` is simpler than diffing the previous menu and is
//! cheap enough to not matter.

use tauri::{
    image::Image,
    menu::{CheckMenuItem, CheckMenuItemBuilder, IsMenuItem, Menu, MenuItemBuilder, PredefinedMenuItem},
    menu::{Submenu, MenuEvent},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, Wry,
};

use crate::commands;
use crate::models::Entry;
use crate::state::AppState;

const TRAY_ID: &str = "main-tray";
const FLUSH_DNS_ID: &str = "tray-flush-dns";
const OPEN_WINDOW_ID: &str = "tray-open";
const SWITCH_ID_PREFIX: &str = "tray-switch::";

/// Fired whenever a write completes, so an open window can refresh even
/// when the write was triggered from the tray rather than from the UI.
pub const ENTRIES_CHANGED_EVENT: &str = "entries-changed";

const TRAY_ICON_BYTES: &[u8] = include_bytes!("../icons/tray-icon.png");

/// Builds and shows the tray icon. Called once at startup.
pub fn build(app: &AppHandle, entries: &[Entry]) -> tauri::Result<()> {
    let menu = build_menu(app, entries)?;
    let icon = Image::from_bytes(TRAY_ICON_BYTES)?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .icon_as_template(true)
        .tooltip("re:route")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(handle_menu_event)
        .build(app)?;

    Ok(())
}

/// Rebuilds the tray menu from `entries` and notifies any open window.
/// Call after every successful hosts-file write (i.e. after the DB
/// transaction that produced `entries` has committed), regardless of
/// whether the write was triggered from the window or the tray itself.
pub fn sync(app: &AppHandle, entries: &[Entry]) {
    let _ = app.emit(ENTRIES_CHANGED_EVENT, ());

    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    match build_menu(app, entries) {
        Ok(menu) => {
            if let Err(e) = tray.set_menu(Some(menu)) {
                eprintln!("tray: failed to apply rebuilt menu: {e}");
            }
        }
        Err(e) => eprintln!("tray: failed to build menu: {e}"),
    }
}

fn build_menu(app: &AppHandle, entries: &[Entry]) -> tauri::Result<Menu<Wry>> {
    let menu = Menu::new(app)?;

    let enabled_entries: Vec<&Entry> = entries.iter().filter(|e| e.enabled).collect();
    if enabled_entries.is_empty() {
        let placeholder = MenuItemBuilder::new("No enabled entries").enabled(false).build(app)?;
        menu.append(&placeholder)?;
    } else {
        for entry in enabled_entries {
            menu.append(&entry_submenu(app, entry)?)?;
        }
    }

    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItemBuilder::with_id(FLUSH_DNS_ID, "Flush DNS Now").build(app)?)?;
    menu.append(&MenuItemBuilder::with_id(OPEN_WINDOW_ID, "Open re:route").build(app)?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&PredefinedMenuItem::quit(app, Some("Quit"))?)?;

    Ok(menu)
}

fn entry_submenu(app: &AppHandle, entry: &Entry) -> tauri::Result<Submenu<Wry>> {
    let ip_items: Vec<CheckMenuItem<Wry>> = entry
        .ips
        .iter()
        .map(|ip| {
            CheckMenuItemBuilder::with_id(switch_id(&entry.id, &ip.id), &ip.label)
                .checked(ip.id == entry.active_ip_id)
                .build(app)
        })
        .collect::<tauri::Result<_>>()?;
    let refs: Vec<&dyn IsMenuItem<Wry>> = ip_items.iter().map(|i| i as &dyn IsMenuItem<Wry>).collect();
    Submenu::with_items(app, &entry.hostname, true, &refs)
}

fn switch_id(entry_id: &str, ip_id: &str) -> String {
    format!("{SWITCH_ID_PREFIX}{entry_id}::{ip_id}")
}

fn handle_menu_event(app: &AppHandle, event: MenuEvent) {
    let id = event.id().0.as_str();

    if id == FLUSH_DNS_ID {
        if let Err(e) = commands::dns::flush_dns(app.state::<AppState>()) {
            eprintln!("tray: flush DNS failed: {e}");
        }
        return;
    }

    if id == OPEN_WINDOW_ID {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
        }
        return;
    }

    if let Some(rest) = id.strip_prefix(SWITCH_ID_PREFIX) {
        let Some((entry_id, ip_id)) = rest.split_once("::") else {
            return;
        };
        let app_handle = app.clone();
        let state = app.state::<AppState>();
        if let Err(e) = commands::entries::switch_active_ip(app_handle, state, entry_id.to_string(), ip_id.to_string()) {
            eprintln!("tray: switch active IP failed: {e}");
        }
    }
}
