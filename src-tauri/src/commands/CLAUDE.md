# src-tauri/src/commands/

Split by concern; `commands.rs` (one level up) itself holds only what's shared across more than one submodule
(the write pipeline, draft validation/conversion, history pruning):
- `entries.rs` — CRUD for managed entries: add/edit, switch active IP, enable/disable, restore, delete;
  also `list_conflicts` (hostnames claimed by more than one enabled entry with different IPs).
- `adopt.rs` — list/adopt hosts-file lines outside the managed block.
- `raw_save.rs` — the raw-editor view's read/preview/lint/save + reconciliation back into structured entries.
- `dns.rs` — standalone "Flush DNS now".
- `helper.rs` — helper daemon lifecycle (status/install/uninstall/enabled toggle).
- `settings.rs` — generic key/value settings-table accessors.
- `doctor.rs` — read-only self-diagnostics (`run_diagnostics`): a handful of independent health checks
  (hosts file/managed-block integrity, helper reachability, DNS flush support, backups/DB writability, file
  watcher status, hostname conflicts via `crate::conflicts`) a user can run themselves before filing a bug.
  Each check swallows its own I/O errors into a `Fail`/`Warn` status rather than propagating a `Result` error,
  so one broken check never blocks the rest.

Mutating flows follow a **preview → confirm** pattern end to end: `preview_*` commands compute a `DiffPreview`
(before/after line, shadow-domain warning, lint diagnostics) against `read_conn` with no side effects; the
frontend shows it in `DiffModal`; only `confirm_*` (against `conn`, inside a transaction) actually writes and
records history. Never collapse these into a single command — the confirmation UI depends on the split.
