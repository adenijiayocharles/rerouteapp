<div align="center">
  <img src="public/reroute-icon-1024.png" alt="re:route icon" width="120" />

  # re:route

  A cross-platform desktop app for managing your `/etc/hosts` file (or the Windows equivalent) through a GUI.

  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
  [![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)](#platform-support)
</div>

## What it does

re:route lets you manage host entries the way you'd want to, instead of hand-editing a system file:

- **Multi-IP-per-hostname entries** with one-click switching of which IP is active
- **Automatic DNS cache flushing** after a write
- **Diff-confirmed writes** — every change is previewed before it touches disk
- **History with rollback**, so a bad edit is never permanent
- **Raw-editor mode** with syntax highlighting and live linting, for when you want direct control
- **Passwordless writes after the first prompt**, via a small privileged helper daemon (macOS) instead of an
  elevation prompt on every save
- **Byte-for-byte round-tripping** of everything outside the app-managed block — manual edits, other tools'
  entries, comments, and blank lines are left untouched

## Platform support

macOS-first. Windows and Linux are supported by the hosts-file engine and fall back to a per-write elevation
prompt (UAC / `pkexec`) instead of the background helper daemon, but are less battle-tested — issues and PRs
for those platforms are welcome.

## Installing

Builds for all three platforms are published on the [Releases](https://github.com/adenijiayocharles/rerouteapp/releases)
page:

- **macOS** — signed and notarized. Download the `.dmg` for your Mac's architecture (Apple Silicon or Intel)
  and drag re:route into Applications.
- **Windows** — unsigned (no code-signing certificate yet), so Windows SmartScreen will warn on first launch;
  choose "More info" → "Run anyway". Download the `.msi` or the NSIS `.exe` installer.
- **Linux** — unsigned, which is normal for Linux packages. Download the `.deb`, `.rpm`, or the AppImage for
  your distro.

## Building from source

**Prerequisites:** [Node.js](https://nodejs.org/) 18+, [Rust](https://www.rust-lang.org/tools/install), and the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS.

```bash
git clone https://github.com/adenijiayocharles/rerouteapp.git
cd rerouteapp/app
npm install
npm run tauri dev     # builds the helper daemon, then launches Tauri (Rust) + Vite
```

Other useful commands (run from the `app/` directory):

```bash
npm run build          # tsc typecheck + vite production build
npx tsc --noEmit        # typecheck only
npm run tauri build     # production app bundle

cargo build -p reroute              # main app crate
cargo test                          # all workspace crates
cargo test -p reroute hosts_parser:: # one module, e.g. hosts_parser tests
cargo clippy --workspace --all-targets
```

There is no separate JS test runner; Rust tests are the primary automated coverage (hosts-file parsing/
rendering, validation, diffing, history pruning, wire protocol, admin detection).

## Architecture

re:route is a [Tauri 2](https://v2.tauri.app/) app: a Rust backend plus a React/TypeScript frontend, with a
separate privileged helper daemon for passwordless writes. It's a Cargo workspace of three crates:

- **`helper-protocol`** — the tiny length-prefixed JSON wire protocol shared between the app and the helper.
- **`helper`** (binary `reroute-helper`) — the privileged daemon (macOS-only) that performs writes to the
  hosts file after authorizing the caller via `getpeereid` and admin-group membership.
- **`src-tauri`** (crate `reroute`) — the Tauri app itself: SQLite-backed entry store, hosts-file parser/
  renderer, file watcher, elevation handling, and the `#[tauri::command]` handlers the frontend calls.

The frontend (`src/`) is a single-reducer React app — one `useReducer` drives view routing, draft editing,
diff-confirmation modals, toasts, and settings.

For the full design — the privilege model, the hosts-file parsing model, and the frontend's preview/confirm
pattern — see [`CLAUDE.md`](CLAUDE.md) and [`src-tauri/src/commands/CLAUDE.md`](src-tauri/src/commands/CLAUDE.md).

## Releasing

`.github/workflows/release.yml` builds and publishes all four release targets on a `v*` tag push, or via manual
dispatch: macOS `aarch64-apple-darwin` and `x86_64-apple-darwin` (signed + notarized), Windows (unsigned), and
Linux (unsigned). The macOS legs also build and bundle `reroute-helper`, signed with the same Developer ID as
the app, since it runs standalone (outside the app bundle) as root — Windows and Linux don't build the helper
daemon at all (see [Platform support](#platform-support)).

Required repo secrets (Settings → Secrets and variables → Actions). The `APPLE_*` secrets are only used by the
macOS legs (from an [Apple Developer Program](https://developer.apple.com/programs/) membership); the
`TAURI_SIGNING_*` secrets sign updater artifacts on all four legs:

| Secret | Where to get it |
| --- | --- |
| `APPLE_CERTIFICATE` | Export your **Developer ID Application** certificate from Keychain Access as a `.p12`, then `base64 -i cert.p12 \| pbcopy` |
| `APPLE_CERTIFICATE_PASSWORD` | The password you set when exporting the `.p12` |
| `APPLE_SIGNING_IDENTITY` | The cert's full name, e.g. `Developer ID Application: Your Name (TEAMID)` — find it with `security find-identity -v -p codesigning` |
| `APPLE_ID` | Your Apple ID email |
| `APPLE_PASSWORD` | An [app-specific password](https://support.apple.com/en-us/102654) for that Apple ID (not your normal password) |
| `APPLE_TEAM_ID` | Your 10-character Team ID, in [developer.apple.com/account](https://developer.apple.com/account) → Membership |
| `TAURI_SIGNING_PRIVATE_KEY` | The updater's minisign private key (generate with `npx tauri signer generate`); its public half is `plugins.updater.pubkey` in `tauri.conf.json` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | The password set when generating that key |

Notes specific to this app:

- Because it isn't sandboxed (it writes `/etc/hosts` and installs a LaunchDaemon), it can only ship via
  Developer ID direct distribution, not the Mac App Store.
- `scripts/build-helper.sh` builds `reroute-helper` for whichever target the Tauri CLI is building
  (`TAURI_ENV_TARGET_TRIPLE`) and drops it where `bundle.resources` in `tauri.conf.json` expects it, so both
  the app and helper end up signed for the same architecture in each matrix leg.
- After the first signed + notarized build, verify on a clean Mac (no dev certs installed) that installing the
  helper actually works: `launchctl print system/com.reroute.app.helper` should show it running after granting
  the admin prompt.

## Contributing

Issues and pull requests are welcome. Before sending a PR:

- Run `npx tsc --noEmit`, `cargo test`, and `cargo clippy --workspace --all-targets` and make sure they're clean.
- Keep writes funneled through the existing privilege model (`commands.rs::write_content_to_hosts_file`) — see
  [`CLAUDE.md`](CLAUDE.md) for why, before touching any write path.
- For UI changes, check the app actually runs (`npm run tauri dev`) and exercise the golden path in-app.

## Changelog

See [`CHANGELOG.md`](CHANGELOG.md) for release notes.

## License

MIT — see [`LICENSE`](LICENSE).
