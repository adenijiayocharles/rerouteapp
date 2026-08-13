# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.2] - 2026-08-14

### Added

- Sorting alphabetically to the Hostname column in the list view — clicking the header cycles
  unsorted/ascending/descending.

### Fixed

- Elevated hosts-file writes could hang indefinitely waiting on an unanswered admin-password prompt, holding
  the app's database lock the whole time; every elevated call is now bounded to a 180s timeout instead.
- A write triggered from the menu bar tray (e.g. switching an entry's active IP) could freeze the entire app,
  window included, while waiting on that same admin prompt — it now runs off the native main thread.
- The save/confirm dialogs could be double-submitted with a fast double-click, and clicking Cancel while a
  write was already in flight gave the false impression it had stopped — both now show a pending state and
  disable their controls while a write is running.
- The helper daemon's auth-token staging file was left world-readable and never deleted after use; it's now
  written with restricted permissions and removed once the elevated install step finishes.
- "Unlimited" history retention was genuinely unbounded, and the History view renders its full list with no
  virtualization; retention is now capped at 5,000 rows even on "unlimited".
- The Settings page's "Background helper" toggle was shown on Windows/Linux, where the helper daemon can never
  actually run; the whole section is now hidden there instead.
- Added `PRAGMA busy_timeout` to both SQLite connections, avoiding a rare "database is locked" error under
  read/write contention.

### Internal

- Added an isolated, non-blocking `cargo audit`/`npm audit` CI job that can never slow down or block the real
  build pipeline.

## [0.5.1] - 2026-08-13

### Added

- Windows and Linux builds are now published on the Releases page alongside macOS, via the renamed
  `release.yml` (formerly `release-macos.yml`). Both are unsigned for now.

### Changed

- IP address options in an entry's active-IP switch dropdown are now sorted alphabetically.

### Fixed

- The Apple signing secrets (certificate, password, identity, Apple ID) were set unconditionally on the shared
  release build step, exposing them in the process environment of the Windows and Linux build legs even though
  those legs never use them. Now scoped to the macOS legs only.
- The Doctor panel's helper-daemon check told Windows/Linux users the helper would be reinstalled on their next
  write; the helper daemon is macOS-only, so it now reports that plainly instead of promising something that
  can never happen there.
- Doctor's "Hostname conflicts" check (and the list-view conflict badges) displayed a hostname lowercased to
  its internal dedup key instead of the casing the user actually typed.
- The Doctor panel had no error handling — a failed diagnostics call left the spinner running forever — and no
  way to re-run checks without closing and reopening the panel; both are now handled.
- CI: `cargo clippy --workspace` unconditionally built the macOS-only `helper` crate, which doesn't compile on
  Windows and hit a real type mismatch on Linux; excluded outside macOS. The unsigned CI sanity build also
  tried to sign updater artifacts without the release signing key; disabled for that build only.

## [0.5.0] - 2026-08-13

### Added

- CI now builds, tests, and bundles the app on Ubuntu, Windows, and macOS on every push/PR, uploading each OS's
  unsigned installer as a workflow artifact.

### Changed

- Tray menu entries are now sorted alphabetically by hostname within each group, instead of preserving the
  sidebar's drag order.

### Removed

- The Comment column from the onboarding and unmanaged-entry rows.

### Fixed

- `tauri build` would have failed on Windows and Linux: `bundle.resources` unconditionally referenced the
  macOS-only `reroute-helper` binary, which is now scoped to a macOS-only bundle config.

## [0.4.0] - 2026-08-12

### Added

- A Doctor panel (pulse icon in the title bar) with read-only self-diagnostics: hosts file/managed-block
  integrity, helper daemon reachability, DNS flush support, backups/local database writability, file watcher
  status, and hostname conflicts.
- Hostname conflict detection: warns when two enabled entries claim the same hostname with different IPs, via
  the Doctor panel, list-row badges, and non-blocking warnings when saving, switching, or toggling an entry.
- A background reachability check after switching an entry's active IP, warning (toast and a row indicator) if
  the new address doesn't respond to a ping.
- Broader DNS-cache-flush resolver detection on Linux (`dnsmasq`, alongside the existing `resolvectl`/`nscd`
  detection), with the detected resolver named in the Doctor panel.

### Changed

- The macOS menu-bar app name is now lowercase ("reroute") to match the app's branding.

### Fixed

- The Windows elevated-write path, which previously always reported failure even on success because
  `Start-Process -Verb RunAs` can't redirect output the way the code assumed.
- The Linux elevated-write path's exit-code handling, audited against `pkexec`'s documented codes and
  confirmed already correct (only a stale "untested" comment changed).

## [0.3.0] - 2026-08-11

### Added

- MIT `LICENSE`, license metadata in `package.json`/`Cargo.toml`, and this changelog.
- A native File menu (Add Entry, Flush DNS Now, Open Raw File).
- The app version now shows in the header next to the title.

### Changed

- The menu bar tray lists grouped entries before ungrouped ones, with each group nested inside its own
  collapsible submenu instead of a flat, always-expanded list.
- The Hostname, Active IP, and Modified list columns are equal width and center-aligned (Hostname stays
  left-aligned).
- The About panel shows the app's own icon and "re:route" instead of a generic folder icon and the crate name.

### Removed

- The in-app Quick Switch tray and the Comment column from the entries list.
- The Comment field from the edit-entry panel.

### Fixed

- The WKWebView's native right-click context menu (Reload, Inspect Element) no longer appears.
- Scrolling past the content edges no longer bounces to reveal an unstyled white background.

## [0.2.1] - 2026-08-11

### Fixed

- Inline styles are now allowed by the app's CSP so CodeMirror (the raw hosts-file editor) renders correctly.

## [0.2.0] - 2026-08-11

### Added

- Automatic update checking and installation.
- Tray-triggered IP switches now surface a notification.
- Editable group names from the sidebar.
- Adopted hosts entries are split on commas/spaces and grouped by IP during onboarding.

### Changed

- Rebranded display text from "Reroute" to "re:route".
- Replaced the per-row Edit button with a combined Edit/Delete overflow menu.
- The auto-flush-DNS setting is now respected on entry save.
- Widened the Settings modal and dropped redundant toggle-row descriptions.
- Group IP additions/relabels now propagate correctly, and the unmanaged-entries list remembers its
  collapsed/expanded state.

### Fixed

- Security and performance audit findings, plus helper-daemon write bugs.

## [0.1.0] - 2026-08-10

Initial release.

### Added

- Core hosts-file management: multi-IP-per-hostname entries with one-click active-IP switching, automatic DNS
  cache flushing, diff-confirmed writes, and history with rollback.
- Privileged helper daemon (macOS) for passwordless writes to `/etc/hosts` after the first elevation prompt.
- Raw-editor mode: CodeMirror-based editor with a custom hosts-file syntax highlighter, live linting, and a
  line-level diff/diagnostics view.
- Entry deletion flow, wired through the same preview/diff/confirm pattern as other writes.
- First-run onboarding to adopt pre-existing, unmanaged hosts entries into the app.
- Settings: background helper toggle, launch-at-login, auto-flush DNS, "always preview before saving", history
  retention, and light/dark/system theme.
- macOS menu bar (tray) icon for quick IP switching without opening the main window.
- App rebrand from "Hosts Manager" to "Reroute", with a new app/dock/menu-bar icon.
- Signed release pipeline: `reroute-helper` is codesigned with the same Developer ID as the app bundle before
  packaging.

### Fixed

- History and "last modified" timestamps rendering in UTC instead of local time.
- Custom titlebar: close/minimize/maximize/drag were silently broken.
- False "external change" banner appearing after in-app writes.
- Various backend performance, concurrency, and data-safety issues found in review.

[Unreleased]: https://github.com/adenijiayocharles/rerouteapp/compare/v0.5.2...HEAD
[0.5.2]: https://github.com/adenijiayocharles/rerouteapp/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/adenijiayocharles/rerouteapp/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/adenijiayocharles/rerouteapp/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/adenijiayocharles/rerouteapp/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/adenijiayocharles/rerouteapp/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/adenijiayocharles/rerouteapp/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/adenijiayocharles/rerouteapp/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/adenijiayocharles/rerouteapp/releases/tag/v0.1.0
