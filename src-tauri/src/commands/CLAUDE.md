# src-tauri/src/commands/

Split by concern; `commands.rs` (one level up) itself holds only what's shared across more than one submodule
(the write pipeline, draft validation/conversion, history pruning):
- `entries.rs` — CRUD for managed entries: add/edit, switch active IP, enable/disable, restore, delete.
- `adopt.rs` — list/adopt hosts-file lines outside the managed block.
- `raw_save.rs` — the raw-editor view's read/preview/lint/save + reconciliation back into structured entries.
- `dns.rs` — standalone "Flush DNS now".
- `helper.rs` — helper daemon lifecycle (status/install/uninstall/enabled toggle).
- `settings.rs` — generic key/value settings-table accessors.

Mutating flows follow a **preview → confirm** pattern end to end: `preview_*` commands compute a `DiffPreview`
(before/after line, shadow-domain warning, lint diagnostics) against `read_conn` with no side effects; the
frontend shows it in `DiffModal`; only `confirm_*` (against `conn`, inside a transaction) actually writes and
records history. Never collapse these into a single command — the confirmation UI depends on the split.
