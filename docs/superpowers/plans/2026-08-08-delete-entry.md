# Delete Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `Delete` option to the "Edit entry" panel that removes an entry from the hosts file, using the same preview/confirm-diff write pattern already used for save and restore.

**Architecture:** Two new thin Tauri commands (`preview_delete`, `confirm_delete`) in `commands.rs` mirror the existing `preview_restore`/`confirm_restore` pair and reuse the already-implemented `store::delete_entry`. The frontend reuses the existing `DiffModal` (which already renders removals — no `afterLine`) by adding a `"delete"` diff mode, and adds a `Delete` button to `DraftPanel`'s footer that's wired through `App.tsx`'s existing preview-diff-confirm state machine (`SHOW_DIFF` / `handleConfirmDiff`), following the same shape as the existing `pendingRestoreId` path.

**Tech Stack:** Tauri 2 (Rust backend, `rusqlite` for the local entry store), React 19 + TypeScript frontend, no test framework beyond `cargo test` (Rust) and `tsc` (frontend type-check) — this repo has no frontend unit test runner, so frontend correctness is verified via `tsc`/`vite build` and a manual run of the dev app.

## Global Constraints

- Match existing code style exactly: inline `style={{ ... }}` objects (no CSS modules/styled-components), `ColorTokens` (`c`) passed as a prop for all colors, no new dependencies.
- All new Rust command signatures/error strings follow the exact conventions of their `preview_restore`/`confirm_restore` siblings (e.g. `"Entry not found."` for missing entries, `"Failed to write the hosts file."` on write failure).
- Every new IPC command must be added to the `tauri::generate_handler![...]` list in `src-tauri/src/lib.rs` or the frontend call will fail at runtime with an "unknown command" error — easy to forget, so it's an explicit step below.
- No new Settings toggle; delete always confirms via the diff modal (same as edits to existing entries already do today).

---

### Task 1: Backend — `preview_delete` and `confirm_delete` commands

**Files:**
- Modify: `src-tauri/src/commands.rs` (new commands, placed after `confirm_restore`, i.e. after line 504)
- Modify: `src-tauri/src/lib.rs:73-74` (register the two new commands)
- Modify: `src-tauri/src/models.rs:55` (doc comment for `mode`)

**Interfaces:**
- Consumes: `store::get_entry(&Connection, &str) -> rusqlite::Result<Option<Entry>>`, `store::delete_entry(&Connection, &str) -> rusqlite::Result<()>` (both already exist in `store.rs`), `store::list_entries`, `store::insert_history`, `hosts_parser::build_line(&Entry) -> String`, `backup_and_write(&AppHandle, &AppState, &[Entry], bool) -> Result<(elevate::WriteOutcome, String), String>` (private fn already in `commands.rs`), `prune_history(&Connection) -> Result<(), String>` (private fn already in `commands.rs`), `WriteResult` and `DiffPreview` structs (already in `commands.rs`/`models.rs`).
- Produces: `#[tauri::command] preview_delete(state: State<AppState>, entry_id: String) -> Result<DiffPreview, String>` and `#[tauri::command] confirm_delete(app: AppHandle, state: State<AppState>, entry_id: String) -> Result<WriteResult, String>` — the exact names/signatures the frontend's `api.ts` (Task 2) will invoke by string name `"preview_delete"` / `"confirm_delete"` with a single camelCase arg `entryId`.

- [ ] **Step 1: Update the `mode` doc comment in `models.rs`**

In `src-tauri/src/models.rs`, change line 55:

```rust
    pub mode: String, // "save" | "restore" | "view"
```

to:

```rust
    pub mode: String, // "save" | "restore" | "view" | "delete"
```

- [ ] **Step 2: Add `preview_delete` to `commands.rs`**

Insert immediately after the closing `}` of `confirm_restore` (after line 504, before the `/// Standalone "Flush DNS now" action...` comment on line 506):

```rust
/// Read-only diff for the Edit panel's "Delete" button — shows the line
/// that will be removed, with no replacement line (mirrors
/// `preview_restore`'s removal case).
#[tauri::command]
pub fn preview_delete(state: State<AppState>, entry_id: String) -> Result<DiffPreview, String> {
    let conn = state.conn.lock().unwrap();
    let entry = store::get_entry(&conn, &entry_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Entry not found.".to_string())?;

    Ok(DiffPreview {
        mode: "delete".to_string(),
        is_new: false,
        is_removal: true,
        title: format!("Delete \u{201c}{}\u{201d}", entry.hostname),
        subtitle: "Review the line that will be removed from the hosts file.".to_string(),
        before_line: Some(hosts_parser::build_line(&entry)),
        after_line: None,
        is_shadow_domain: false,
        restore_target_id: None,
        history_before: None,
        history_after: None,
    })
}

#[tauri::command]
pub fn confirm_delete(app: AppHandle, state: State<AppState>, entry_id: String) -> Result<WriteResult, String> {
    let mut conn = state.conn.lock().unwrap();
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let before = store::get_entry(&tx, &entry_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Entry not found.".to_string())?;

    store::delete_entry(&tx, &entry_id).map_err(|e| e.to_string())?;
    let entries = store::list_entries(&tx).map_err(|e| e.to_string())?;

    let (outcome, backup_path) = backup_and_write(&app, &state, &entries, false)?;
    if !outcome.write_ok {
        return Err("Failed to write the hosts file.".to_string());
    }

    store::insert_history(
        &tx,
        &before.hostname,
        "Deleted entry",
        Some(&entry_id),
        Some(&before),
        None,
        Some(&backup_path),
    )
    .map_err(|e| e.to_string())?;
    prune_history(&tx)?;
    tx.commit().map_err(|e| e.to_string())?;

    Ok(WriteResult {
        entry: None,
        flush_ok: None,
        flush_message: None,
    })
}
```

- [ ] **Step 3: Register both commands in `lib.rs`**

In `src-tauri/src/lib.rs`, change lines 73-74 from:

```rust
            commands::preview_restore,
            commands::confirm_restore,
```

to:

```rust
            commands::preview_restore,
            commands::confirm_restore,
            commands::preview_delete,
            commands::confirm_delete,
```

- [ ] **Step 4: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles with no errors or warnings about the new code.

- [ ] **Step 5: Run existing Rust test suite (regression check)**

Run: `cd src-tauri && cargo test`
Expected: all existing tests in `hosts_parser.rs`, `store.rs`, `elevate.rs`, `validate.rs` still pass (this task doesn't change any tested function's behavior — `store::delete_entry` is reused as-is).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs src-tauri/src/models.rs
git commit -m "Add preview_delete and confirm_delete commands"
```

---

### Task 2: Frontend — types and API bindings

**Files:**
- Modify: `src/types.ts:43` (`DiffMode` union)
- Modify: `src/api.ts` (add `previewDelete`/`confirmDelete`, after the existing `previewRestore`/`confirmRestore` lines)

**Interfaces:**
- Consumes: `invoke` from `@tauri-apps/api/core` (already imported in `api.ts`), the `preview_delete`/`confirm_delete` Tauri commands from Task 1 (invoked by string name — no Rust import needed, just matching names/arg casing).
- Produces: `DiffMode` including `"delete"`; `api.previewDelete(entryId: string) => Promise<DiffPreview>`; `api.confirmDelete(entryId: string) => Promise<WriteResult>` — these exact names are what Task 4 (`App.tsx`) calls.

- [ ] **Step 1: Add `"delete"` to `DiffMode`**

In `src/types.ts`, change line 43:

```typescript
export type DiffMode = "save" | "restore" | "view";
```

to:

```typescript
export type DiffMode = "save" | "restore" | "view" | "delete";
```

- [ ] **Step 2: Add API bindings**

In `src/api.ts`, right after the `previewRestore`/`confirmRestore` lines (currently lines 18-19):

```typescript
  previewRestore: (historyId: string) => invoke<DiffPreview>("preview_restore", { historyId }),
  confirmRestore: (historyId: string) => invoke<WriteResult>("confirm_restore", { historyId }),

  previewDelete: (entryId: string) => invoke<DiffPreview>("preview_delete", { entryId }),
  confirmDelete: (entryId: string) => invoke<WriteResult>("confirm_delete", { entryId }),
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors (these two files compile standalone; downstream consumers don't exist yet until later tasks, but nothing here should break existing usage).

- [ ] **Step 4: Commit**

```bash
git add src/types.ts src/api.ts
git commit -m "Add previewDelete/confirmDelete API bindings"
```

---

### Task 3: Frontend — `DiffModal` delete-mode styling

**Files:**
- Modify: `src/components/DiffModal.tsx:16-19`
- Modify: `src/components/DiffModal.tsx:130-149` (confirm button)

**Interfaces:**
- Consumes: `diff.mode` (now may be `"delete"`, per Task 2's `DiffMode`), `c.red` (`ColorTokens.red`, already defined in `src/theme.ts:16` and `:43`/`:70`).
- Produces: no new exports — `DiffModalProps` is unchanged, so `App.tsx` (Task 4) needs no new props to pass in, just a `diff.mode === "delete"` diff object.

- [ ] **Step 1: Add the "delete" confirm label**

In `src/components/DiffModal.tsx`, change line 18 from:

```typescript
  const confirmLabel = diff.mode === "restore" ? "Restore version" : "Write to hosts file";
```

to:

```typescript
  const confirmLabel = diff.mode === "restore" ? "Restore version" : diff.mode === "delete" ? "Delete entry" : "Write to hosts file";
```

- [ ] **Step 2: Give the confirm button a danger style in delete mode**

In `src/components/DiffModal.tsx`, change the confirm `<button>`'s `style` (currently lines 134-144):

```typescript
              style={{
                flex: 1,
                height: 38,
                borderRadius: 8,
                border: "none",
                background: c.accent,
                color: "#fff",
                fontSize: 13,
                fontWeight: 600,
                cursor: confirmDisabled ? "not-allowed" : "pointer",
                opacity: confirmDisabled ? 0.5 : 1,
              }}
```

to:

```typescript
              style={{
                flex: 1,
                height: 38,
                borderRadius: 8,
                border: "none",
                background: diff.mode === "delete" ? c.red : c.accent,
                color: "#fff",
                fontSize: 13,
                fontWeight: 600,
                cursor: confirmDisabled ? "not-allowed" : "pointer",
                opacity: confirmDisabled ? 0.5 : 1,
              }}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/DiffModal.tsx
git commit -m "Style DiffModal for delete confirmations"
```

---

### Task 4: Frontend — `Delete` button in `DraftPanel`

**Files:**
- Modify: `src/components/DraftPanel.tsx:6-17` (`DraftPanelProps`)
- Modify: `src/components/DraftPanel.tsx:19-30` (destructured props)
- Modify: `src/components/DraftPanel.tsx:253-286` (footer)

**Interfaces:**
- Consumes: `c.red` (`ColorTokens.red`), existing `isNew` local (`draft.id === null`, already computed at line 31).
- Produces: `DraftPanelProps.onDelete: () => void` (new, required prop) — `App.tsx` (Task 5) must pass this in every `<DraftPanel>` usage or TypeScript will fail to compile.

- [ ] **Step 1: Add `onDelete` to the props interface**

In `src/components/DraftPanel.tsx`, change lines 15-17 from:

```typescript
  onToggleEnabled: () => void;
  onSave: () => void;
}
```

to:

```typescript
  onToggleEnabled: () => void;
  onSave: () => void;
  onDelete: () => void;
}
```

- [ ] **Step 2: Destructure `onDelete`**

Change lines 28-29 from:

```typescript
  onToggleEnabled,
  onSave,
}: DraftPanelProps) {
```

to:

```typescript
  onToggleEnabled,
  onSave,
  onDelete,
}: DraftPanelProps) {
```

- [ ] **Step 3: Add the `Delete` button to the footer**

Change the footer `<div>` (currently lines 253-286) from:

```typescript
        <div style={{ padding: "16px 24px", borderTop: `1px solid ${c.border}`, display: "flex", gap: 10, flex: "none" }}>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              height: 38,
              borderRadius: 8,
              border: `1px solid ${c.border}`,
              background: "transparent",
              color: c.text,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            style={{
              flex: 1,
              height: 38,
              borderRadius: 8,
              border: "none",
              background: c.accent,
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {isNew ? "Save" : "Review changes"}
          </button>
        </div>
```

to:

```typescript
        <div style={{ padding: "16px 24px", borderTop: `1px solid ${c.border}`, display: "flex", gap: 10, flex: "none" }}>
          {!isNew && (
            <button
              onClick={onDelete}
              style={{
                height: 38,
                padding: "0 16px",
                borderRadius: 8,
                border: `1px solid ${c.red}`,
                background: "transparent",
                color: c.red,
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Delete
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button
            onClick={onClose}
            style={{
              width: 100,
              height: 38,
              borderRadius: 8,
              border: `1px solid ${c.border}`,
              background: "transparent",
              color: c.text,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            style={{
              width: 140,
              height: 38,
              borderRadius: 8,
              border: "none",
              background: c.accent,
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {isNew ? "Save" : "Review changes"}
          </button>
        </div>
```

(The `Cancel`/`Save` buttons switch from `flex: 1` to fixed `width` so they don't stretch to fill the freed-up space when `Delete` isn't rendered for new entries — the `flex: 1` spacer div keeps them right-aligned either way.)

- [ ] **Step 4: Type-check (expect a known, temporary failure)**

Run: `npx tsc --noEmit`
Expected: FAIL — `App.tsx`'s `<DraftPanel ...>` usage is now missing the required `onDelete` prop. This is expected; Task 5 fixes it. Confirm the *only* new error is the missing `onDelete` prop on `DraftPanel` in `App.tsx` (no unrelated errors from this task's edit).

- [ ] **Step 5: Commit**

```bash
git add src/components/DraftPanel.tsx
git commit -m "Add Delete button to DraftPanel footer"
```

---

### Task 5: Frontend — wire delete through `App.tsx`'s diff/confirm flow

**Files:**
- Modify: `src/App.tsx:35-36` (state shape)
- Modify: `src/App.tsx:83` (`SHOW_DIFF` action type)
- Modify: `src/App.tsx:102` (initial state)
- Modify: `src/App.tsx:234-239` (`SHOW_DIFF`/`CLOSE_DIFF`/`CLOSE_DIFF_AND_DRAFT` reducer cases)
- Modify: `src/App.tsx:442-475` (add `handleRequestDelete`, extend `handleConfirmDiff`)
- Modify: `src/App.tsx:612-624` (`<DraftPanel>` usage — add `onDelete`)

**Interfaces:**
- Consumes: `api.previewDelete`/`api.confirmDelete` (Task 2), `DiffModal`'s existing `diff.mode === "delete"` rendering (Task 3), `DraftPanel`'s new `onDelete: () => void` prop (Task 4), existing `REMOVE_ENTRY` action (`App.tsx:170-171`, unchanged), existing `refreshHistory()` (`App.tsx:264-267`, unchanged).
- Produces: nothing consumed by later tasks — this is the last task.

- [ ] **Step 1: Add `pendingDeleteId` to `State`**

In `src/App.tsx`, change lines 35-36 from:

```typescript
  pendingDraft: EntryDraft | null;
  pendingRestoreId: string | null;
```

to:

```typescript
  pendingDraft: EntryDraft | null;
  pendingRestoreId: string | null;
  pendingDeleteId: string | null;
```

- [ ] **Step 2: Extend the `SHOW_DIFF` action type**

Change line 83 from:

```typescript
  | { type: "SHOW_DIFF"; diff: DiffPreview; pendingDraft: EntryDraft | null; pendingRestoreId: string | null }
```

to:

```typescript
  | { type: "SHOW_DIFF"; diff: DiffPreview; pendingDraft: EntryDraft | null; pendingRestoreId: string | null; pendingDeleteId: string | null }
```

- [ ] **Step 3: Add the initial value**

Change line 102 from:

```typescript
  pendingRestoreId: null,
```

to:

```typescript
  pendingRestoreId: null,
  pendingDeleteId: null,
```

- [ ] **Step 4: Thread `pendingDeleteId` through the diff reducer cases**

Change lines 234-239 from:

```typescript
    case "SHOW_DIFF":
      return { ...state, diff: action.diff, pendingDraft: action.pendingDraft, pendingRestoreId: action.pendingRestoreId };
    case "CLOSE_DIFF":
      return { ...state, diff: null, pendingDraft: null, pendingRestoreId: null };
    case "CLOSE_DIFF_AND_DRAFT":
      return { ...state, diff: null, pendingDraft: null, pendingRestoreId: null, editingDraft: null };
```

to:

```typescript
    case "SHOW_DIFF":
      return {
        ...state,
        diff: action.diff,
        pendingDraft: action.pendingDraft,
        pendingRestoreId: action.pendingRestoreId,
        pendingDeleteId: action.pendingDeleteId,
      };
    case "CLOSE_DIFF":
      return { ...state, diff: null, pendingDraft: null, pendingRestoreId: null, pendingDeleteId: null };
    case "CLOSE_DIFF_AND_DRAFT":
      return { ...state, diff: null, pendingDraft: null, pendingRestoreId: null, pendingDeleteId: null, editingDraft: null };
```

- [ ] **Step 5: Update the three existing `dispatch({ type: "SHOW_DIFF", ... })` call sites to pass `pendingDeleteId: null`**

There are three existing call sites — in `handleRequestSave` (around line 414 and 427), and in `handleViewHistoryDiff` (around line 436), and `handleRequestRestore` (around line 445). Each currently looks like one of:

```typescript
          dispatch({ type: "SHOW_DIFF", diff, pendingDraft: draft, pendingRestoreId: null });
```
```typescript
      dispatch({ type: "SHOW_DIFF", diff, pendingDraft: draft, pendingRestoreId: null });
```
```typescript
      dispatch({ type: "SHOW_DIFF", diff, pendingDraft: null, pendingRestoreId: null });
```
```typescript
      dispatch({ type: "SHOW_DIFF", diff, pendingDraft: null, pendingRestoreId: id });
```

Add `pendingDeleteId: null` to each, e.g. the last one becomes:

```typescript
      dispatch({ type: "SHOW_DIFF", diff, pendingDraft: null, pendingRestoreId: id, pendingDeleteId: null });
```

(TypeScript's `--noEmit` will flag each missing field individually if any are skipped — use that as a checklist.)

- [ ] **Step 6: Add `handleRequestDelete`**

Add this new function right after `handleRequestRestore` (after line 449, before `handleConfirmDiff`):

```typescript
  async function handleRequestDelete(entryId: string) {
    try {
      const diff = await api.previewDelete(entryId);
      dispatch({ type: "SHOW_DIFF", diff, pendingDraft: null, pendingRestoreId: null, pendingDeleteId: entryId });
    } catch (err) {
      dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Couldn't preview delete", message: errorMessage(err) } });
    }
  }
```

- [ ] **Step 7: Extend `handleConfirmDiff` to handle `mode === "delete"`**

Change the destructure and branch chain (currently lines 452-475) from:

```typescript
    const { diff, pendingDraft, pendingRestoreId } = state;
    if (!diff) return;
    try {
      if (diff.mode === "save" && pendingDraft) {
        await performConfirmSave(pendingDraft, diff.isNew);
        dispatch({ type: "CLOSE_DIFF_AND_DRAFT" });
      } else if (diff.mode === "restore" && pendingRestoreId) {
        const result = await api.confirmRestore(pendingRestoreId);
        if (diff.isRemoval) {
          if (diff.restoreTargetId) dispatch({ type: "REMOVE_ENTRY", id: diff.restoreTargetId });
        } else if (result.entry) {
          dispatch({ type: "UPSERT_ENTRY", entry: result.entry });
        }
        dispatch({ type: "CLOSE_DIFF" });
        await refreshHistory();
        refreshHelperStatus().catch(() => {});
        dispatch({ type: "SET_TOAST", toast: { type: "success", title: "Restored", message: "Previous version has been written to the hosts file." } });
      } else {
        dispatch({ type: "CLOSE_DIFF" });
      }
    } catch (err) {
      dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Write failed", message: errorMessage(err) } });
    }
```

to:

```typescript
    const { diff, pendingDraft, pendingRestoreId, pendingDeleteId } = state;
    if (!diff) return;
    try {
      if (diff.mode === "save" && pendingDraft) {
        await performConfirmSave(pendingDraft, diff.isNew);
        dispatch({ type: "CLOSE_DIFF_AND_DRAFT" });
      } else if (diff.mode === "restore" && pendingRestoreId) {
        const result = await api.confirmRestore(pendingRestoreId);
        if (diff.isRemoval) {
          if (diff.restoreTargetId) dispatch({ type: "REMOVE_ENTRY", id: diff.restoreTargetId });
        } else if (result.entry) {
          dispatch({ type: "UPSERT_ENTRY", entry: result.entry });
        }
        dispatch({ type: "CLOSE_DIFF" });
        await refreshHistory();
        refreshHelperStatus().catch(() => {});
        dispatch({ type: "SET_TOAST", toast: { type: "success", title: "Restored", message: "Previous version has been written to the hosts file." } });
      } else if (diff.mode === "delete" && pendingDeleteId) {
        const hostname = state.editingDraft?.hostname ?? "Entry";
        await api.confirmDelete(pendingDeleteId);
        dispatch({ type: "REMOVE_ENTRY", id: pendingDeleteId });
        dispatch({ type: "CLOSE_DIFF_AND_DRAFT" });
        await refreshHistory();
        refreshHelperStatus().catch(() => {});
        dispatch({ type: "SET_TOAST", toast: { type: "success", title: "Entry deleted", message: `${hostname} has been removed from the hosts file.` } });
      } else {
        dispatch({ type: "CLOSE_DIFF" });
      }
    } catch (err) {
      dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Write failed", message: errorMessage(err) } });
    }
```

(`hostname` is read from `state.editingDraft` before the delete completes — `CLOSE_DIFF_AND_DRAFT` clears `editingDraft`, so it must be captured up front, same reasoning as why the `result.entry` field on `WriteResult` matters for other branches.)

- [ ] **Step 8: Wire `onDelete` into `<DraftPanel>`**

Change the `<DraftPanel>` usage (currently lines 612-624) from:

```typescript
      {state.editingDraft && (
        <DraftPanel
          c={c}
          draft={state.editingDraft}
          onClose={() => dispatch({ type: "CLOSE_DRAFT" })}
          onFieldChange={(field, value) => dispatch({ type: "UPDATE_DRAFT_FIELD", field, value })}
          onIpFieldChange={(uid, field, value) => dispatch({ type: "UPDATE_DRAFT_IP", uid, field, value })}
          onAddIpRow={() => dispatch({ type: "ADD_DRAFT_IP_ROW" })}
          onRemoveIpRow={(uid) => dispatch({ type: "REMOVE_DRAFT_IP_ROW", uid })}
          onSetActive={(uid) => dispatch({ type: "SET_DRAFT_ACTIVE", uid })}
          onToggleEnabled={() => dispatch({ type: "TOGGLE_DRAFT_ENABLED" })}
          onSave={handleRequestSave}
        />
      )}
```

to:

```typescript
      {state.editingDraft && (
        <DraftPanel
          c={c}
          draft={state.editingDraft}
          onClose={() => dispatch({ type: "CLOSE_DRAFT" })}
          onFieldChange={(field, value) => dispatch({ type: "UPDATE_DRAFT_FIELD", field, value })}
          onIpFieldChange={(uid, field, value) => dispatch({ type: "UPDATE_DRAFT_IP", uid, field, value })}
          onAddIpRow={() => dispatch({ type: "ADD_DRAFT_IP_ROW" })}
          onRemoveIpRow={(uid) => dispatch({ type: "REMOVE_DRAFT_IP_ROW", uid })}
          onSetActive={(uid) => dispatch({ type: "SET_DRAFT_ACTIVE", uid })}
          onToggleEnabled={() => dispatch({ type: "TOGGLE_DRAFT_ENABLED" })}
          onSave={handleRequestSave}
          onDelete={() => {
            if (state.editingDraft?.id) handleRequestDelete(state.editingDraft.id);
          }}
        />
      )}
```

- [ ] **Step 9: Type-check — should now pass cleanly**

Run: `npx tsc --noEmit`
Expected: PASS with no errors (this resolves the expected failure from Task 4, Step 4).

- [ ] **Step 10: Full frontend build**

Run: `npm run build`
Expected: succeeds (runs `tsc && vite build`).

- [ ] **Step 11: Commit**

```bash
git add src/App.tsx
git commit -m "Wire entry deletion through the diff/confirm flow"
```

---

### Task 6: Manual end-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Launch the app**

Run: `npm run tauri dev`
Expected: the app window opens showing the entry list.

- [ ] **Step 2: Open an existing entry for editing**

Click an existing entry row to open the "Edit entry" panel.
Expected: a red-bordered `Delete` button appears in the footer, to the left of `Cancel`/`Save`.

- [ ] **Step 3: Confirm the button is hidden when adding a new entry**

Close the panel, click "Add entry".
Expected: no `Delete` button in the footer (only `Cancel`/`Save`) since `isNew` is true.

- [ ] **Step 4: Trigger a delete and confirm the diff modal**

Reopen an existing entry, click `Delete`.
Expected: a modal titled `Delete "<hostname>"` appears, showing the entry's hosts-file line struck through in red with no green addition below it, and a red `Delete entry` confirm button.

- [ ] **Step 5: Cancel and verify nothing changed**

Click `Cancel` in the diff modal.
Expected: modal closes, the edit panel is still open, the entry is still present in the list, no toast shown.

- [ ] **Step 6: Confirm the delete**

Reopen the same entry, click `Delete`, then click `Delete entry` in the modal.
Expected: both modals close, a success toast reads "Entry deleted — `<hostname>` has been removed from the hosts file.", and the entry no longer appears in the list.

- [ ] **Step 7: Verify the hosts file and history**

Check that the hostname's line is actually gone from `/etc/hosts` (e.g. `grep <hostname> /etc/hosts` should return nothing), and switch to the History view in the app to confirm a "Deleted entry" row appears for that hostname.

- [ ] **Step 8: Verify restore still works on a deleted entry**

In History, find the "Deleted entry" row just created and click "Restore" (if available) or at least "View diff" to confirm it renders sensibly (before = the entry, after = none) — this exercises that `confirm_delete`'s history row shape (`after: None`) is consistent with what `preview_restore`/`confirm_restore`'s existing removal-handling code already expects.

---

## Self-Review Notes

- **Spec coverage:** Footer placement ✓ (Task 4), diff-modal reuse with `"delete"` mode ✓ (Tasks 1, 3), `preview_delete`/`confirm_delete` backend commands ✓ (Task 1), `api.ts`/`App.tsx` wiring ✓ (Tasks 2, 5), out-of-scope items (list-row delete, bulk delete, new settings toggle) correctly not implemented anywhere in this plan.
- **Placeholder scan:** no TBD/TODO; every step has literal before/after code.
- **Type consistency:** `preview_delete`/`confirm_delete` (Rust command names) match `"preview_delete"`/`"confirm_delete"` (invoke strings in `api.ts`) match `previewDelete`/`confirmDelete` (JS method names) match `handleRequestDelete`/`api.confirmDelete` call sites in `App.tsx`. `entryId` (JS, camelCase) matches `entry_id: String` (Rust command param — Tauri auto-converts). `onDelete: () => void` prop name matches its declaration in `DraftPanelProps` and its usage in both `DraftPanel.tsx` and `App.tsx`. `pendingDeleteId` field name is consistent across `State`, the `SHOW_DIFF` action, all reducer cases, and `handleConfirmDiff`.
