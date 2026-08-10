# Automatic update checking and installation

## Problem

Reroute has no way to notify users of new releases or install them. The GitHub Actions release
pipeline (`.github/workflows/release-macos.yml`) already builds signed, notarized macOS artifacts
and publishes them as GitHub Releases on `v*` tags, but users must find and reinstall a new
`.dmg` manually.

## Goal

Add background update checking (on startup, then periodically) using Tauri's official updater
plugin, with a manual "Check for Updates" fallback and a toggle to disable automatic checking.
Downloads and installs always require explicit user confirmation — nothing installs unattended,
matching the app's existing diff-confirm-before-write pattern for consequential actions. Scope is
macOS only, matching the existing macOS-only release pipeline; Windows/Linux get nothing here
since there's no build for them to update to yet.

## Release pipeline changes

- Generate a Tauri updater signing keypair once via `npx tauri signer generate -w
  ~/.tauri/reroute-updater.key` (this is a *different* keypair from Apple Developer ID signing —
  it signs the update manifest/artifact so the installed app can verify authenticity before
  applying an update, independent of Gatekeeper). The private key and its password become two new
  GitHub Actions secrets: `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. The
  public key is committed in `tauri.conf.json` (below) — it's not a secret.
- `src-tauri/tauri.conf.json`: set `bundle.createUpdaterArtifacts: true`. With that set,
  `tauri-apps/tauri-action@v1` (already invoked in `release-macos.yml`) automatically produces a
  signed `.app.tar.gz` + `.sig` per architecture and uploads a `latest.json` manifest alongside
  the existing release assets — no separate build step needed.
- `release-macos.yml`: add `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` to
  the `tauri-action` step's `env`, matching how the existing Apple secrets are passed through.
- Add a `plugins.updater` block to `tauri.conf.json`:
  ```json
  "plugins": {
    "updater": {
      "pubkey": "<generated public key>",
      "endpoints": [
        "https://github.com/adenijiayocharles/rerouteapp/releases/latest/download/latest.json"
      ]
    }
  }
  ```
  GitHub's `/releases/latest/download/<asset>` URL always resolves to the newest non-draft,
  non-prerelease release, so no endpoint changes are needed release-to-release. (Existing releases
  are created with `releaseDraft: true` — the workflow already requires a human to publish the
  draft before it's live, which doubles as a safety gate before it becomes visible to the
  updater too.)

## Backend (`src-tauri`)

- Add `tauri-plugin-updater = "2"` and `tauri-plugin-process = "2"` to `src-tauri/Cargo.toml`,
  `@tauri-apps/plugin-updater` and `@tauri-apps/plugin-process` to `package.json`. The process
  plugin isn't currently a dependency; it's needed for `relaunch()` after install (the updater
  plugin only downloads and applies the update — restarting the app is a separate call).
- Register both plugins in `src-tauri/src/lib.rs` alongside the existing `.plugin(...)` calls
  (e.g. `tauri_plugin_autostart::Builder`): `.plugin(tauri_plugin_updater::Builder::new().build())`
  and `.plugin(tauri_plugin_process::init())`.
- Add `updater:default` and `process:allow-restart` permissions to
  `src-tauri/capabilities/default.json`'s permissions array (same file that already grants
  `autostart:default` etc.).
- No new `#[tauri::command]`s. Like the autostart plugin, the updater's JS API is called directly
  from the frontend and wrapped in `api.ts` rather than routed through `invoke()`.
- Reuse the existing generic `settings` table via `get_setting`/`set_setting` (`store.rs`) for a
  new key `auto_check_updates`, default `"true"` when absent — same pattern `auto_flush_dns`
  already uses.

## Frontend: `src/api.ts`

Add, importing from `@tauri-apps/plugin-updater` and `@tauri-apps/plugin-process`:

```ts
import { check as checkForUpdate } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

checkForUpdate: () => checkForUpdate(),   // returns Update | null
getAutoCheckUpdates: () =>
  invoke<string | null>("get_setting", { key: "auto_check_updates" }).then((v) => v !== "false"),
setAutoCheckUpdates: (enabled: boolean) =>
  invoke<void>("set_setting", { key: "auto_check_updates", value: enabled ? "true" : "false" }),
relaunchApp: () => relaunch(),
```

The `Update` object returned by `check()` carries `version`, `download(onProgress)`, and
`install()` methods directly (per the plugin's API) — no further wrapping needed; `App.tsx` holds
the `Update` instance itself in a ref (not in reducer state, since it's not serializable/comparable
state) alongside a small reducer-tracked status enum.

## Frontend: `src/App.tsx`

- New state fields on `State`: `updateStatus: "idle" | "checking" | "available" | "downloading" |
  "ready" | "error"`, `updateVersion: string | null`, `updateProgress: number | null`,
  `autoCheckUpdates: boolean` (default `true`, loaded like the other settings booleans).
- New action types: `SET_UPDATE_STATUS { status, version?, progress? }`,
  `SET_AUTO_CHECK_UPDATES { enabled }`.
- A module-level `let pendingUpdate: Update | null` (or a `useRef` inside the component) holds the
  live `Update` instance between "available" and "ready", since it can't live in reducer state.
- `handleCheckForUpdates(manual: boolean)`:
  - `dispatch(SET_UPDATE_STATUS, { status: "checking" })` only when `manual` (silent otherwise, so
    a background check never flickers UI).
  - `const update = await api.checkForUpdate()`.
  - If `update` is null: manual → toast `{ type: "success", title: "You're up to date", message:
    "Reroute vX.Y.Z is the latest version." }` (current version read from `@tauri-apps/api/app`'s
    `getVersion()`, called once at startup and cached in state); silent → just reset status to
    `"idle"`.
  - If `update` is non-null: store it in `pendingUpdate`, dispatch `SET_UPDATE_STATUS { status:
    "available", version: update.version }`, and show an `info`-type toast (persists until
    dismissed/acted on, same as other `info` toasts today) titled `"Update available"` with a new
    action button (see Toast changes below).
  - On error: manual → error toast (`errorMessage(err)`); silent → swallow, matching how
    `refreshUnmanagedEntries().catch(() => {})` etc. already fail silently for background work.
- `handleDownloadUpdate()`: dispatch `status: "downloading", progress: 0`; call
  `pendingUpdate.download((event) => { if (event.event === "Progress") dispatch(SET_UPDATE_STATUS,
  { status: "downloading", progress: computed-percent }) })`; on completion dispatch `status:
  "ready"` and update the toast to "Restart to install"; on error, dispatch `status: "error"` and
  an error toast.
- `handleInstallUpdate()`: `await pendingUpdate.install()`, then `await api.relaunchApp()`.
- Startup `useEffect` (the existing one at `App.tsx:377` that fires the other `api.get*` settings
  loads) gains: `api.getAutoCheckUpdates().then((enabled) => { dispatch(SET_AUTO_CHECK_UPDATES,
  {enabled}); if (enabled) handleCheckForUpdates(false); })`.
- New `useEffect` for periodic checks: `setInterval(() => { if (state.autoCheckUpdates)
  handleCheckForUpdates(false); }, 4 * 60 * 60 * 1000)` (4 hours), cleared on unmount. Guarded so
  it's a no-op if a check is already in flight (`updateStatus !== "idle"`).
- Wire `autoCheckUpdates`, `onSetAutoCheckUpdates={handleSetAutoCheckUpdates}`, and
  `onCheckForUpdatesNow={() => handleCheckForUpdates(true)}` into `<SettingsModal>`.

## Frontend: Toast

`ToastState` (`src/types.ts`) gains an optional action, generalizing the existing single-purpose
`retryFlush?: boolean` field into a small discriminated action so the same toast component covers
both cases without one-off boolean flags accumulating:

```ts
export interface ToastState {
  type: ToastType;
  title: string;
  message: string;
  retryFlush?: boolean;
  updateAction?: { label: string; onClick: () => void };
}
```

(`retryFlush` stays as-is — not worth a churn-only rename of an existing working field — the new
update flow just uses the more general `updateAction` shape instead of adding a second boolean.)

`Toast.tsx` renders `toast.updateAction` the same way it renders the existing `retryFlush` button
(same styling, `onClick={toast.updateAction.onClick}`, label from `toast.updateAction.label}`).
The three states each set a differently-labeled action on the same toast object rather than
opening three different toasts:
- `"available"`: message `"Reroute vX.Y.Z is ready to download."`, action label `"Download"` →
  `handleDownloadUpdate`.
- `"downloading"`: message `"Downloading update… NN%"`, no action (button hidden while
  `updateAction` is absent) until it reaches `"ready"`.
- `"ready"`: message `"Restart Reroute to finish installing vX.Y.Z."`, action label `"Restart"` →
  `handleInstallUpdate`.

## Frontend: Settings

`SettingsModal.tsx` gets a new `"Updates"` section (new `SectionLabel`, placed after `General`):
- `ToggleRow` — title `"Automatically check for updates"`, description `"Check for new versions on
  startup and periodically while Reroute is running."`, wired to `autoCheckUpdates` /
  `onSetAutoCheckUpdates`, same shape as the existing `autoFlushDns` row.
- A `"Check for Updates"` button (styled like existing secondary buttons elsewhere in the modal)
  calling `onCheckForUpdatesNow`, disabled while `updateStatus === "checking"` showing "Checking…".

## Error handling

- Background (silent) checks never surface errors to the user — network hiccups on a periodic
  timer shouldn't nag them. Manual checks always surface success or failure via toast.
- A failed download or install shows an error toast and resets `updateStatus` to `"idle"`,
  leaving `pendingUpdate` in place so the user can retry via the same toast action without
  re-checking.
- Signature/integrity verification is handled entirely by `tauri-plugin-updater` against the
  `pubkey` in `tauri.conf.json` — the app never applies an update that fails verification, and
  there's no app-level code path that could bypass it.

## Testing

No automated test can exercise the real check→download→install flow (it needs a live signed
release endpoint). Coverage here is:
- Manual verification: cut a throwaway pre-release tag once the pipeline changes land, confirm a
  build one version behind picks it up, downloads, and installs cleanly.
- No new Rust tests (no new backend logic — the plugin owns verification, `get_setting`/
  `set_setting` are already covered by `store.rs`'s existing settings tests).

## Out of scope

- Windows/Linux updater configuration — no release pipeline exists for either yet.
- Delta/differential updates — full artifact download only, matching plugin defaults.
- Release notes/changelog display in the update toast — just the version number.
- Any change to the existing manual-download path (README/GitHub Releases page) — this is purely
  additive.
