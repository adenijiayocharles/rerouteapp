# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

re:route is a cross-platform (macOS/Windows/Linux, macOS-first) desktop app for managing `/etc/hosts` (or the
Windows equivalent) through a GUI: multi-IP-per-hostname entries with one-click active-IP switching, automatic
DNS cache flushing, diff-confirmed writes, history/rollback, and a raw-editor mode. Built with Tauri 2
(Rust backend + React/TypeScript frontend) plus a separate privileged helper daemon for passwordless writes
after the first elevation prompt.

The original design brief and Codemirror-based mockup spec live in `claude-code-prompt-hosts-manager.md`
(gitignored, local-only) — useful background on intended UX if a feature seems underspecified.

## Commands

Frontend (run from repo root):
```
npm run dev       # vite dev server only (rarely useful alone — prefer `npm run tauri dev`)
npm run build     # tsc typecheck + vite production build
npx tsc --noEmit  # typecheck only
npm run tauri dev # full app: builds the helper daemon, then launches Tauri (Rust) + Vite
npm run tauri build
```

Rust (run from repo root — this is a Cargo workspace with members `src-tauri`, `helper`, `helper-protocol`):
```
cargo build -p reroute        # main app crate (crate name "reroute"; package dir is src-tauri)
cargo test                    # all workspace crates
cargo test -p reroute hosts_parser::   # one module, e.g. hosts_parser tests
cargo test -p helper-protocol # wire-protocol round-trip tests
cargo test -p helper          # admin-group detection tests — must run as an actual admin user to pass
cargo clippy --workspace --all-targets
```

There is no separate JS test runner configured; Rust tests are the primary automated test coverage
(hosts-file parsing/rendering, validation, diffing, history pruning, wire protocol, admin detection).

**Known environment gotcha:** if `cargo build`/`test`/`clippy` on `reroute` fails with `failed to read plugin
permissions: ... No such file or directory`, it's a stale build-script-output cache pointing at a build
directory that no longer exists (e.g. after the repo was moved on disk) — cargo replays old cached build-script
stdout rather than rerunning it. Fix with `cargo clean -p tauri` (not a full clean).

## Architecture

### Three Rust crates, one workspace

- **`helper-protocol`** — the wire protocol shared by the app and the privileged helper: a tiny
  length-prefixed JSON framing (`read_message`/`write_message`) over just two request variants
  (`WriteHosts { content }`, `FlushDns`). Deliberately narrow — the daemon never executes client-supplied
  shell/paths, so there's no injection surface even though any local process can dial the socket.
- **`helper`** (binary `reroute-helper`) — the privileged daemon, installed once as a macOS LaunchDaemon at
  `/Library/PrivilegedHelperTools`, listening on `/var/run/com.reroute.app.helper.sock`. Authorizes callers via
  `getpeereid` + admin-group membership (Open Directory-aware `getgrouplist`, not just flat `/etc/group`).
  macOS-only; other platforms fall back to a per-write elevation prompt instead of this daemon.
- **`src-tauri`** (crate `reroute`, lib name `reroute_lib`) — the Tauri app: SQLite-backed entry store, hosts
  file parser/renderer, file watcher, elevation, and all `#[tauri::command]` handlers the frontend calls via
  `invoke()`.

### Privilege model — read this before touching any write path

The app never writes `/etc/hosts` directly. `commands.rs::write_content_to_hosts_file` is the single funnel all
writes go through, in this priority order:
1. **Helper daemon reachable** (`helper_client::ping()`) → write via the Unix socket, no prompt.
2. **Helper not reachable, but enabled in settings** → `helper_install::install_and_write` installs the
   LaunchDaemon *and* performs this write in the same elevated shell invocation, so only the first write (or a
   write after the daemon has stopped) ever prompts.
3. **Helper disabled, or install failed** → `elevate::write_hosts_file`, a plain one-off elevated write
   (macOS: `osascript ... with administrator privileges`; Windows: elevated PowerShell/UAC — untested; Linux:
   `pkexec` — untested). `ElevatedExecutor` is the trait seam for this.

Every write: takes a timestamped backup first (`backups_dir`), primes `state.last_written` *before* issuing the
write so the file watcher doesn't mistake it for an external edit, and clears that guard if the write failed.
A failed DNS flush never rolls back a successful file write (see `flush_message_for`) — flush and write are
reported independently.

### Hosts file parsing model

`hosts_parser.rs` wraps app-managed entries in marker comments `# reroute:start` / `# reroute:end`
(`START_MARKER`/`END_MARKER`). Only lines inside that block are ever regenerated from the SQLite `entries`
table; everything outside it (manual edits, other tools' entries, comments, blank lines) round-trips
byte-for-byte untouched. On first run, if the hosts file already has a managed block (e.g. reinstall), it's
imported into the DB instead of being silently discarded (`store::seed_from_existing_managed_block`, called
from `lib.rs::run`). Lines outside the managed block are separately surfaced as "unmanaged entries"
(`commands/adopt.rs`) that the user can adopt into the managed set via the onboarding flow.

See `src-tauri/src/commands/CLAUDE.md` for the command-surface split and the preview → confirm pattern.

### State (`state.rs`)

`AppState` holds **two** SQLite connections deliberately: `conn` for writes (held for the whole duration of a
write, including a potentially slow/blocking elevation prompt) and `read_conn` for read-only commands, so list
views don't hang behind an open admin prompt. `helper_enabled` is cached as an `AtomicBool` outside `conn`
for the same reason (`Mutex` isn't reentrant).

### Frontend (`src/`)

Single-reducer architecture: `App.tsx` holds one `useReducer` with one `State`/`Action` union for the entire
app (view routing between list/history/raw, draft editing, diff-modal/pending-action plumbing, toasts, settings,
theme). `api.ts` is the only place that calls `invoke()` — components never call Tauri directly. Backend events
(`hosts-file-changed-externally`, `entries-changed`) are subscribed to in `App.tsx` via `@tauri-apps/api/event`
and dispatched into the same reducer.

The "pending action" fields (`pendingDraft`, `pendingRestoreId`, `pendingDeleteId`, `pendingAdoptId`,
`pendingRawSave`) mirror the backend's preview/confirm split: a `preview_*` call populates `diff` +
exactly one `pending*` field, `DiffModal`'s confirm button calls the matching `confirm_*`, and the corresponding
handler is picked from `pending*` when the modal confirms.

### Signing/notarization and release

See the `release` skill for the signing/notarization/CI workflow.
