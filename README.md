# Tauri + React + Typescript

This template should help get you started developing with Tauri, React and Typescript in Vite.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Releasing on macOS (signed + notarized)

`.github/workflows/release-macos.yml` builds, signs, and notarizes the app for both
`aarch64-apple-darwin` and `x86_64-apple-darwin` on a `v*` tag push, or via manual dispatch.
It also builds and bundles `hosts-manager-helper`, the privileged LaunchDaemon this app
installs to `/Library/PrivilegedHelperTools` — that binary needs the same Developer ID
signature as the app itself, since it runs standalone (outside the app bundle) as root.

Required repo secrets (Settings → Secrets and variables → Actions), all from an
[Apple Developer Program](https://developer.apple.com/programs/) membership:

| Secret | Where to get it |
| --- | --- |
| `APPLE_CERTIFICATE` | Export your **Developer ID Application** certificate from Keychain Access as a `.p12`, then `base64 -i cert.p12 \| pbcopy` |
| `APPLE_CERTIFICATE_PASSWORD` | The password you set when exporting the `.p12` |
| `APPLE_SIGNING_IDENTITY` | The cert's full name, e.g. `Developer ID Application: Your Name (TEAMID)` — find it with `security find-identity -v -p codesigning` |
| `APPLE_ID` | Your Apple ID email |
| `APPLE_PASSWORD` | An [app-specific password](https://support.apple.com/en-us/102654) for that Apple ID (not your normal password) |
| `APPLE_TEAM_ID` | Your 10-character Team ID, in [developer.apple.com/account](https://developer.apple.com/account) → Membership |

Notes specific to this app:

- Because it isn't sandboxed (it writes `/etc/hosts` and installs a LaunchDaemon), it can
  only ship via Developer ID direct distribution, not the Mac App Store.
- `scripts/build-helper.sh` builds `hosts-manager-helper` for whichever target the Tauri
  CLI is building (`TAURI_ENV_TARGET_TRIPLE`) and drops it where `bundle.resources` in
  `tauri.conf.json` expects it, so both the app and helper end up signed for the same
  architecture in each matrix leg.
- After the first signed + notarized build, verify on a clean Mac (no dev certs installed)
  that installing the helper actually works: `launchctl print system/com.hostsmanager.app.helper`
  should show it running after granting the admin prompt.
