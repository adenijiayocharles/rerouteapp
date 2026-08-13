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
use tauri_plugin_notification::NotificationExt;

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
        for (group_name, members) in group_sections(&enabled_entries) {
            match group_name {
                // Grouped entries nest inside their own submenu, so the top
                // level only ever shows the group name — the entries reveal
                // themselves on click/hover, same as any other submenu.
                Some(name) => menu.append(&group_submenu(app, name, &members)?)?,
                None => {
                    for entry in members {
                        menu.append(&entry_submenu(app, entry)?)?;
                    }
                }
            }
        }
    }

    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItemBuilder::with_id(FLUSH_DNS_ID, "Flush DNS Now").build(app)?)?;
    menu.append(&MenuItemBuilder::with_id(OPEN_WINDOW_ID, "Open re:route").build(app)?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&PredefinedMenuItem::quit(app, Some("Quit"))?)?;

    Ok(menu)
}

/// Buckets enabled entries into per-group sections — sorted alphabetically
/// by group name, each with its members sorted alphabetically by hostname
/// — followed by one final `None` section for ungrouped entries (also
/// hostname-sorted), so the tray always lists groups before anything
/// ungrouped (mirrors the alphabetical group ordering the sidebar's group
/// filter list already uses in `App.tsx`). This intentionally diverges from
/// the sidebar's own entry list, which preserves user drag order
/// (`order_index`) instead — the tray is a quick-scan dropdown rather than a
/// reorderable list, so alphabetical beats mirroring drag order there.
fn group_sections<'a>(entries: &[&'a Entry]) -> Vec<(Option<&'a str>, Vec<&'a Entry>)> {
    let mut group_names: Vec<&str> = entries.iter().map(|e| e.group.as_str()).filter(|g| !g.is_empty()).collect();
    group_names.sort_unstable();
    group_names.dedup();

    let mut sections: Vec<(Option<&str>, Vec<&Entry>)> = group_names
        .into_iter()
        .map(|name| {
            let mut members: Vec<&Entry> = entries.iter().copied().filter(|e| e.group == name).collect();
            members.sort_by(|a, b| a.hostname.cmp(&b.hostname));
            (Some(name), members)
        })
        .collect();

    let mut ungrouped: Vec<&Entry> = entries.iter().copied().filter(|e| e.group.is_empty()).collect();
    ungrouped.sort_by(|a, b| a.hostname.cmp(&b.hostname));
    if !ungrouped.is_empty() {
        sections.push((None, ungrouped));
    }

    sections
}

fn group_submenu(app: &AppHandle, name: &str, entries: &[&Entry]) -> tauri::Result<Submenu<Wry>> {
    let items: Vec<Submenu<Wry>> = entries.iter().map(|entry| entry_submenu(app, entry)).collect::<tauri::Result<_>>()?;
    let refs: Vec<&dyn IsMenuItem<Wry>> = items.iter().map(|i| i as &dyn IsMenuItem<Wry>).collect();
    Submenu::with_items(app, name, true, &refs)
}

fn entry_submenu(app: &AppHandle, entry: &Entry) -> tauri::Result<Submenu<Wry>> {
    let mut ips: Vec<_> = entry.ips.iter().collect();
    ips.sort_by(|a, b| a.label.cmp(&b.label));
    let ip_items: Vec<CheckMenuItem<Wry>> = ips
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
        match commands::entries::switch_active_ip(app_handle, state, entry_id.to_string(), ip_id.to_string()) {
            Ok(result) => notify_switch(app, &result),
            Err(e) => eprintln!("tray: switch active IP failed: {e}"),
        }
    }
}

/// Confirms a tray-triggered IP switch (and its DNS flush) with a system
/// notification. The tray menu is meant to work without the main window
/// open, so without this a background switch would otherwise have no
/// visible confirmation at all — unlike a window-triggered switch, which
/// already shows an in-app toast.
fn notify_switch(app: &AppHandle, result: &commands::WriteResult) {
    let Some(entry) = &result.entry else { return };
    let Some(active_ip) = entry.ips.iter().find(|ip| ip.id == entry.active_ip_id) else {
        return;
    };

    // Reuses the same wording `flush_message_for` already produces for the
    // in-app toast on a window-triggered switch, so a flush failure (or "no
    // supported resolver") reads identically in both places. When there's
    // no message (flush succeeded, or auto-flush is off), fall back to a
    // plain confirmation of the switch itself.
    let body = match &result.flush_message {
        Some(msg) => msg.clone(),
        None if result.flush_ok == Some(true) => {
            format!("{} now resolves to {}. DNS cache flushed.", entry.hostname, active_ip.ip)
        }
        None => format!("{} now resolves to {}.", entry.hostname, active_ip.ip),
    };

    match app.notification().builder().title("re:route").body(body).show() {
        Ok(()) => eprintln!("tray: notification shown (permission state: {:?})", app.notification().permission_state()),
        Err(e) => eprintln!("tray: failed to show notification: {e}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: &str, group: &str) -> Entry {
        Entry {
            id: id.to_string(),
            hostname: format!("{id}.test"),
            comment: String::new(),
            group: group.to_string(),
            enabled: true,
            active_ip_id: String::new(),
            ips: Vec::new(),
            last_modified: String::new(),
        }
    }

    #[test]
    fn groups_sort_alphabetically_before_ungrouped() {
        let entries = [
            entry("z-grouped", "zebra"),
            entry("ungrouped-1", ""),
            entry("a-grouped", "alpha"),
            entry("ungrouped-2", ""),
        ];
        let refs: Vec<&Entry> = entries.iter().collect();

        let sections = group_sections(&refs);

        let section_ids: Vec<(Option<&str>, Vec<&str>)> = sections
            .iter()
            .map(|(name, members)| (*name, members.iter().map(|e| e.id.as_str()).collect()))
            .collect();
        assert_eq!(
            section_ids,
            vec![
                (Some("alpha"), vec!["a-grouped"]),
                (Some("zebra"), vec!["z-grouped"]),
                (None, vec!["ungrouped-1", "ungrouped-2"]),
            ]
        );
    }

    #[test]
    fn sorts_entries_alphabetically_within_a_group() {
        let entries = [entry("second", "g"), entry("first", "g")];
        let refs: Vec<&Entry> = entries.iter().collect();

        let sections = group_sections(&refs);

        assert_eq!(sections.len(), 1);
        let (name, members) = &sections[0];
        assert_eq!(*name, Some("g"));
        assert_eq!(members.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(), vec!["first", "second"]);
    }

    #[test]
    fn sorts_ungrouped_entries_alphabetically() {
        let entries = [entry("second", ""), entry("first", "")];
        let refs: Vec<&Entry> = entries.iter().collect();

        let sections = group_sections(&refs);

        assert_eq!(sections.len(), 1);
        let (name, members) = &sections[0];
        assert_eq!(*name, None);
        assert_eq!(members.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(), vec!["first", "second"]);
    }

    #[test]
    fn all_ungrouped_yields_single_section() {
        let entries = [entry("a", ""), entry("b", "")];
        let refs: Vec<&Entry> = entries.iter().collect();

        let sections = group_sections(&refs);

        assert_eq!(sections.len(), 1);
        assert_eq!(sections[0].0, None);
    }

    #[test]
    fn no_entries_yields_no_sections() {
        let sections = group_sections(&[]);
        assert!(sections.is_empty());
    }
}
