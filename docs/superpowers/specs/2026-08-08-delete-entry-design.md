# Delete entry from the Edit panel

## Problem

There is currently no way to delete a hosts-file entry anywhere in the app. `EntryDraft`/`DraftPanel` support add and edit only; the only place `store::delete_entry` is called is internally, when restoring history to a point before an entry existed.

## Goal

Add a `Delete` option to the "Edit entry" panel (`DraftPanel.tsx`) that lets the user remove an existing entry from the hosts file, following the same preview/confirm write pattern already used for save and restore.

## UI

**Footer button placement.** The `DraftPanel` footer currently renders `Cancel` / `Save` as two `flex: 1` buttons. Add a `Delete` button to the left of them, only when editing an existing entry (`!isNew` — new/unsaved drafts have nothing to delete). Unlike `Cancel`/`Save`, it is auto-width (not `flex: 1`) and styled as a danger action (red text/border, transparent background), so it reads as destructive but doesn't compete visually with the primary Cancel/Save pair.

```
[Delete]        [Cancel]  [Save]
```

**Confirmation.** Clicking `Delete` does not show a separate native "are you sure" dialog. Instead it reuses the existing diff-preview-then-write flow: it opens the same `DiffModal` already used for save/restore, showing the entry's current hosts-file line struck through in red with no replacement line added (the modal already renders removals this way — see `preview_restore`'s `isRemoval` case). This matches existing behavior for edits to existing entries, which already always confirm via the diff modal before writing (only brand-new entries can skip straight to a write).

**DiffModal changes.** Add a `"delete"` case:
- `confirmLabel`: "Delete entry" (alongside the existing `"restore"` → "Restore version" special case).
- The confirm button uses a red/danger style specifically when `diff.mode === "delete"` (background `c.red` instead of `c.accent`), signaling destructiveness.

## Backend (`src-tauri/src/commands.rs`)

Two new `#[tauri::command]`s, mirroring the existing `preview_restore`/`confirm_restore` pair:

- `preview_delete(entry_id: String) -> Result<DiffPreview, String>` — read-only. Looks up the entry via `store::get_entry`, errors with `"Entry not found."` if missing (matching existing commands' error style). Returns:
  - `mode: "delete"`
  - `is_new: false`
  - `is_removal: true`
  - `title: "Delete \u{201c}{hostname}\u{201d}"`
  - `subtitle: "Review the line that will be removed from the hosts file."`
  - `before_line: Some(hosts_parser::build_line(&entry))`
  - `after_line: None`
  - `is_shadow_domain: false`
  - `restore_target_id: None`
  - `history_before`/`history_after`: `None`

- `confirm_delete(app, entry_id: String) -> Result<WriteResult, String>` — in a transaction: fetch the entry (404 if missing), `store::delete_entry`, `store::list_entries` for the new full set, `backup_and_write` (no flush, matching save/restore), and on success `store::insert_history` with action `"Deleted entry"`, `before` = the fetched snapshot, `after` = `None` (same shape restore already uses for its removal case), then `prune_history` and commit. Returns `WriteResult { entry: None, flush_ok: None, flush_message: None }`.

`DiffMode` in `src/types.ts` and the Rust comment on `DiffPreview.mode` both gain `"delete"` as a valid value.

## Frontend wiring

- `src/api.ts`: add `previewDelete: (entryId) => invoke<DiffPreview>("preview_delete", { entryId })` and `confirmDelete: (entryId) => invoke<WriteResult>("confirm_delete", { entryId })`.
- `src/App.tsx`:
  - New state field `pendingDeleteId: string | null`, alongside the existing `pendingDraft`/`pendingRestoreId`, reset together wherever those are (`CLOSE_DIFF`, `CLOSE_DIFF_AND_DRAFT`, initial state).
  - `SHOW_DIFF` action gains an optional `pendingDeleteId` field.
  - `handleRequestDelete(entryId: string)`: calls `api.previewDelete`, dispatches `SHOW_DIFF` with `pendingDraft: null`, `pendingRestoreId: null`, `pendingDeleteId: entryId`. Same try/catch + error toast shape as `handleRequestRestore`.
  - `handleConfirmDiff` gains a branch: `else if (diff.mode === "delete" && pendingDeleteId)` → `api.confirmDelete(pendingDeleteId)`, dispatch `REMOVE_ENTRY` with that id, dispatch `CLOSE_DIFF_AND_DRAFT` (closes both the diff modal and the edit panel, since the entry being edited no longer exists), `refreshHistory()`, success toast ("Entry deleted", message naming the hostname pulled from the diff's `beforeLine`/title).
  - Wire `onDelete={() => handleRequestDelete(state.editingDraft!.id!)}` into `<DraftPanel>` (only reachable when `!isNew`, so `id` is non-null).
- `src/components/DraftPanel.tsx`: add `onDelete: () => void` to `DraftPanelProps`, render the `Delete` button in the footer when `!isNew`.

## Out of scope

- No delete affordance on the list row itself (`EntryRow`/`ListView`) — this task is specifically about the edit panel.
- No bulk/multi-select delete.
- No new Settings toggle gating this (it always confirms via the diff modal, same as editing an existing entry always does today).
