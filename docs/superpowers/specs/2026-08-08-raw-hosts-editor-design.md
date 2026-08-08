# Raw hosts file editor

## Problem

The app only lets you manage hosts entries through structured forms (`DraftPanel`), which regenerate the file from a SQLite-backed entry list on every save. There's no way to freely edit `/etc/hosts` as text — touching lines outside the app's managed block (e.g. the default `127.0.0.1 localhost`), reformatting, or making several changes at once without going through the form UI one entry at a time.

## Goal

Add a "Raw File" view: a real text editor over the entire `/etc/hosts` file, with syntax highlighting and inline linting, that writes back verbatim on save while keeping the structured entry list (used by the Hosts list and History) in sync with whatever ends up inside the app's managed block.

## Backend — new commands (`commands.rs`)

- `read_hosts_file() -> String` — reads `/etc/hosts` fresh off disk. Used to open the editor and to refresh it after an external-change reload.
- `preview_raw_save(content: String) -> DiffPreview` — read-only. Diffs the current on-disk content against `content` and returns `DiffPreview` with `mode: "raw"`. Also runs the lint pass (see below) over `content` and includes its diagnostics, so the confirm modal can show a non-blocking summary even if the user never looked at the inline squiggles.
- `confirm_raw_save(content: String) -> WriteResult` — writes `content` **verbatim** to `/etc/hosts` (not regenerated from entries — formatting, comments, and ordering inside the managed block survive exactly as typed). Reuses the same backup-then-write path as every other command: `backup_and_write` is refactored to extract a lower-level `write_content_to_hosts_file(app, state, content, do_flush)` that both it and `confirm_raw_save` call into.
- `lint_hosts_content(content: String) -> Vec<LintDiagnostic>` — used for live linting while typing (see below). Shares the exact same logic `preview_raw_save` uses to populate its diagnostics, factored into one function so the two commands can't drift.

```rust
struct LintDiagnostic {
    line: usize,        // 1-based line number in the full file content
    severity: "error" | "warning",
    message: String,
}
```

## Diffing

`DiffPreview` gains, for `mode: "raw"`:
- `diff_lines: Vec<DiffLine>` where `DiffLine = { kind: "added" | "removed" | "same", text: String }` — a line-level diff (small LCS-based algorithm, hosts files are realistically well under a few thousand lines) computed server-side. Replaces `before_line`/`after_line` for this mode.
- `diagnostics: Vec<LintDiagnostic>` — from the lint pass below.

## Linting

Scoped to lines **inside the app's managed block only** — outside it is arbitrary user/system content the app has never validated and shouldn't start second-guessing (e.g. `broadcasthost`, IPv6 zone-id syntax elsewhere in the file). `hosts_parser` gets a small `find_managed_block_bounds(content) -> Option<(usize, usize)>` helper (start/end marker line indices) factored out for reuse by both `parse()` and the lint pass, so line numbers map back to the original file correctly.

For each non-blank managed-block line, reusing the exact same `validate.rs` functions the structured form already uses:
- Line doesn't parse as `<ip> <hostname...>` → **error**, "Line isn't valid hosts-file syntax (expected: IP  hostname)".
- IP portion fails `validate::is_valid_ip` → **error**, "'<ip>' is not a valid IP address".
- Any hostname token fails `validate::is_valid_hostname` → **error**, "'<hostname>' is not a valid hostname".
- Any hostname token is `validate::is_shadow_domain` → **warning**, "'<hostname>' is a reserved system hostname — overriding it can affect the OS itself".
- A hostname already seen earlier in the managed block → **warning**, "'<hostname>' is already defined on another line".

**Validation is advisory only and never blocks Save** — diagnostics are visual (inline squiggles + diff-modal summary), consistent with this being a real text editor rather than a form. This matches the shadow-domain warning's existing treatment on the structured Add/Edit path, just extended to format errors too.

## Reconciliation with the structured store

Run inside `confirm_raw_save`'s transaction, after the verbatim write succeeds:
- Parse the new content's managed block with the existing `hosts_parser::parse_managed_block`.
- Match each parsed line against existing entries by exact `hostname` string (the same canonical, space-joined key `build_line` already round-trips through).
  - Matched → update in place: comment/enabled/active-IP value change, but the entry keeps its `id` and any extra (non-active) IP candidates untouched.
  - No match → new entry (fresh id, single IP candidate).
  - Existing entry's hostname no longer present → deleted.
- Renaming a hostname is therefore indistinguishable from delete-old + add-new — no rename detection.
- One `insert_history` row per entry that actually changed (added/edited/deleted), reusing the exact same History mechanism and restore machinery as every other action. Skipped for lines that parsed identically to what was already stored, so a save that only reformats or touches unmanaged lines doesn't spam History with no-op rows.
- **Caveat:** edits confined to unmanaged lines (e.g. the default `localhost` line, or comments) produce no History entry — only the timestamped `.bak` file captures them.

## Frontend

- **New dependency:** CodeMirror 6 (`@codemirror/state`, `@codemirror/view`, `@codemirror/commands`, `@codemirror/language`, `@codemirror/lint`), replacing a plain `<textarea>`.
- **Syntax highlighting** — a small custom `StreamLanguage` (from `@codemirror/language`) tokenizing: managed-block marker lines (bold/accent), comment/disabled lines (dimmed, matching `c.textFaint`), the IP token, the hostname token(s), and any inline `# comment`. Colors are drawn from `ColorTokens` so highlighting matches the active theme automatically (including the true-dark palette).
- **Linting UI** — `@codemirror/lint`'s `linter()` extension with `lintGutter()`, calling `api.lintHostsContent(content)` (debounced via the extension's built-in `delay` option) and mapping each `LintDiagnostic.line` to a CodeMirror `{from, to}` span via `state.doc.line(n)` (whole-line squiggle, no sub-line column math).
- **`Sidebar.tsx`** — third nav item "Raw File" (new `FileIcon`), alongside Hosts/History.
- **`App.tsx`** — `view` gains `"raw"`. New state: `rawFileContent: string | null` (last-loaded-or-saved baseline) and `rawDraftContent: string | null` (live edit buffer), both in the reducer so switching to List/History and back preserves unsaved edits without a discard-changes prompt. First entry into the Raw view triggers `read_hosts_file`. The existing `ReloadBanner`/external-change flow also refreshes raw content when applicable, discarding any unsaved raw draft — same "Reload" button, extended.
- **`RawEditorView.tsx`** (new) — the CodeMirror instance, a Save button disabled when the draft matches the baseline, Cmd/Ctrl+S shortcut, unsaved-changes indicator dot matching the sidebar's existing style language.
- **`DiffModal.tsx`** — new branch for `mode === "raw"`: renders `diffLines` as a scrollable monospace block (added lines green-tinted, removed red-tinted, unchanged dimmed) instead of the single before/after row layout, plus a compact diagnostics summary strip above it (reusing the existing warning-banner style, e.g. from the helper-disable confirmation) when `diagnostics` is non-empty — "2 errors, 1 warning", non-blocking. Confirm button label "Save file".
- **`api.ts` / `types.ts`** — add the four new bindings, `DiffLine`/`LintDiagnostic` types, extend `DiffMode` with `"raw"`.

## Out of scope

- No guard against removing the `# reroute:start/end` markers themselves — doing so turns previously-managed lines into permanent unmanaged content and their entries disappear from the app's list; the diff view makes this visible before confirming, which is the safety net.
- No sub-line column precision in lint squiggles (whole line only).
- No linting or highlighting rules for content outside the managed block.
- No autocomplete, multi-cursor, search/replace, or other full-IDE editor features beyond what CodeMirror gives for free.
