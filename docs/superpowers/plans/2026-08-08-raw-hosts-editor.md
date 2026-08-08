# Raw Hosts File Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Raw File" view that lets you edit the entire `/etc/hosts` file as text, with syntax highlighting and inline linting, writing back verbatim on save while keeping the structured entry list in sync.

**Architecture:** Backend gains four new Tauri commands (`read_hosts_file`, `preview_raw_save`, `confirm_raw_save`, `lint_hosts_content`) built on two new pure modules (`diff.rs` for line-level diffing, `lint.rs` for managed-block validation) plus a refactor that extracts the write-to-disk logic out of the existing `backup_and_write` so raw saves can reuse it without going through entry rendering. Frontend adds a CodeMirror 6-based editor view wired into the existing reducer/diff-modal pattern every other write already uses.

**Tech Stack:** Rust/Tauri backend (rusqlite, existing `validate.rs`/`hosts_parser.rs`), React/TypeScript frontend, CodeMirror 6 (`@codemirror/state`, `@codemirror/view`, `@codemirror/commands`, `@codemirror/language`, `@codemirror/lint`, `@lezer/highlight`).

## Global Constraints

- Raw save writes the given text **verbatim** to `/etc/hosts` — never regenerated via `hosts_parser::render`.
- Reconciliation with the structured entry store matches parsed managed-block lines to existing entries by **exact hostname string**; unmatched existing entries are deleted, unmatched parsed lines become new entries. Renaming is delete-old + add-new (no rename detection).
- Linting is scoped to lines **inside the managed block only** and is **advisory — it never blocks Save**.
- One `insert_history` row per entry that actually changed (added/edited/deleted); no-op lines produce no history row; edits confined to unmanaged lines produce no history row (only the `.bak` file).
- No new Rust crate dependencies. Five new frontend packages: `@codemirror/state`, `@codemirror/view`, `@codemirror/commands`, `@codemirror/language`, `@codemirror/lint`, `@lezer/highlight`.

---

## Task 1: Backend — line-level diff module (`diff.rs`)

**Files:**
- Create: `src-tauri/src/diff.rs`
- Modify: `src-tauri/src/lib.rs` (register module)

**Interfaces:**
- Produces: `pub struct DiffLine { pub kind: String, pub text: String }` (`kind` is `"same" | "added" | "removed"`), `pub fn diff_lines(old: &str, new: &str) -> Vec<DiffLine>`.

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/src/diff.rs`:

```rust
use serde::Serialize;

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct DiffLine {
    pub kind: String,
    pub text: String,
}

pub fn diff_lines(old: &str, new: &str) -> Vec<DiffLine> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identical_content_is_all_same() {
        let content = "a\nb\nc";
        let result = diff_lines(content, content);
        assert_eq!(result.len(), 3);
        assert!(result.iter().all(|l| l.kind == "same"));
    }

    #[test]
    fn pure_addition_is_all_added_lines() {
        let result = diff_lines("a\nb", "a\nb\nc");
        assert_eq!(
            result,
            vec![
                DiffLine { kind: "same".to_string(), text: "a".to_string() },
                DiffLine { kind: "same".to_string(), text: "b".to_string() },
                DiffLine { kind: "added".to_string(), text: "c".to_string() },
            ]
        );
    }

    #[test]
    fn pure_removal_is_all_removed_lines() {
        let result = diff_lines("a\nb\nc", "a\nb");
        assert_eq!(
            result,
            vec![
                DiffLine { kind: "same".to_string(), text: "a".to_string() },
                DiffLine { kind: "same".to_string(), text: "b".to_string() },
                DiffLine { kind: "removed".to_string(), text: "c".to_string() },
            ]
        );
    }

    #[test]
    fn changed_line_is_removed_then_added() {
        let result = diff_lines("127.0.0.1\told.local", "127.0.0.1\tnew.local");
        assert_eq!(
            result,
            vec![
                DiffLine { kind: "removed".to_string(), text: "127.0.0.1\told.local".to_string() },
                DiffLine { kind: "added".to_string(), text: "127.0.0.1\tnew.local".to_string() },
            ]
        );
    }

    #[test]
    fn empty_old_is_all_added() {
        let result = diff_lines("", "a\nb");
        assert_eq!(
            result,
            vec![
                DiffLine { kind: "added".to_string(), text: "a".to_string() },
                DiffLine { kind: "added".to_string(), text: "b".to_string() },
            ]
        );
    }

    #[test]
    fn empty_new_is_all_removed() {
        let result = diff_lines("a\nb", "");
        assert_eq!(
            result,
            vec![
                DiffLine { kind: "removed".to_string(), text: "a".to_string() },
                DiffLine { kind: "removed".to_string(), text: "b".to_string() },
            ]
        );
    }
}
```

Add `mod diff;` to `src-tauri/src/lib.rs` (insert alphabetically, right after `mod commands;`):

```rust
mod commands;
mod diff;
mod dns_flush;
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test diff::tests`
Expected: compile error or panic from the `todo!()`.

- [ ] **Step 3: Implement `diff_lines` (classic LCS line diff)**

Replace the `todo!()` body in `src-tauri/src/diff.rs`:

```rust
pub fn diff_lines(old: &str, new: &str) -> Vec<DiffLine> {
    let old_lines: Vec<&str> = old.lines().collect();
    let new_lines: Vec<&str> = new.lines().collect();
    let n = old_lines.len();
    let m = new_lines.len();

    let mut dp = vec![vec![0usize; m + 1]; n + 1];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            dp[i][j] = if old_lines[i] == new_lines[j] {
                dp[i + 1][j + 1] + 1
            } else {
                dp[i + 1][j].max(dp[i][j + 1])
            };
        }
    }

    let mut result = Vec::new();
    let (mut i, mut j) = (0, 0);
    while i < n && j < m {
        if old_lines[i] == new_lines[j] {
            result.push(DiffLine { kind: "same".to_string(), text: old_lines[i].to_string() });
            i += 1;
            j += 1;
        } else if dp[i + 1][j] >= dp[i][j + 1] {
            result.push(DiffLine { kind: "removed".to_string(), text: old_lines[i].to_string() });
            i += 1;
        } else {
            result.push(DiffLine { kind: "added".to_string(), text: new_lines[j].to_string() });
            j += 1;
        }
    }
    while i < n {
        result.push(DiffLine { kind: "removed".to_string(), text: old_lines[i].to_string() });
        i += 1;
    }
    while j < m {
        result.push(DiffLine { kind: "added".to_string(), text: new_lines[j].to_string() });
        j += 1;
    }
    result
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test diff::tests`
Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/diff.rs src-tauri/src/lib.rs
git commit -m "Add line-level diff module for the raw hosts file editor"
```

---

## Task 2: Backend — expose managed-block bounds from `hosts_parser.rs`

**Files:**
- Modify: `src-tauri/src/hosts_parser.rs:47-90`

**Interfaces:**
- Produces: `pub fn find_managed_block_bounds(content: &str) -> Option<(usize, usize)>` (0-based `(start_line_idx, end_line_idx)` of the marker lines) — used by Task 3's linter and Task 6's raw-save flow.
- Consumes: nothing new; `parse()` and `parse_managed_block()` keep their existing signatures and behavior exactly.

- [ ] **Step 1: Refactor `parse()` and `parse_managed_block()` to share the new helper**

In `src-tauri/src/hosts_parser.rs`, replace the `parse` function (lines 47–71) and the start of `parse_managed_block` (lines 76–85) with:

```rust
/// Finds the 0-based line indices of the start/end managed-block markers,
/// if both are present and in order. Shared by `parse()` (which needs to
/// split prefix/suffix around them) and the raw-editor lint pass (which
/// needs to map diagnostics back to original file line numbers).
pub fn find_managed_block_bounds(content: &str) -> Option<(usize, usize)> {
    let lines: Vec<&str> = content.lines().collect();
    let start_idx = lines.iter().position(|l| l.trim_end() == START_MARKER)?;
    let end_idx = lines.iter().position(|l| l.trim_end() == END_MARKER)?;
    if end_idx > start_idx {
        Some((start_idx, end_idx))
    } else {
        None
    }
}

pub fn parse(content: &str) -> ParsedHostsFile {
    let lines: Vec<String> = content.lines().map(|s| s.to_string()).collect();
    let trailing_newline = !content.is_empty() && content.ends_with('\n');

    if let Some((start, end)) = find_managed_block_bounds(content) {
        return ParsedHostsFile {
            prefix: lines[..start].to_vec(),
            suffix: lines[end + 1..].to_vec(),
            had_managed_block: true,
            trailing_newline,
        };
    }

    ParsedHostsFile {
        prefix: lines,
        suffix: Vec::new(),
        had_managed_block: false,
        trailing_newline,
    }
}

/// Parses the raw lines that were captured between the markers into
/// structured entries. Used to seed the database on first run against a
/// hosts file that already has an app-managed block (e.g. a prior install).
pub fn parse_managed_block(content: &str) -> Vec<ParsedManagedLine> {
    let Some((start, end)) = find_managed_block_bounds(content) else {
        return Vec::new();
    };
    let lines: Vec<&str> = content.lines().collect();
    lines[start + 1..end]
        .iter()
        .filter_map(|l| parse_managed_line(l))
        .collect()
}
```

Note `parse_managed_line` takes `&str`; the old code called it on `&String` values from a `Vec<String>` — `lines[start + 1..end]` is now `&[&str]` (from `content.lines().collect()`), so `parse_managed_line(l)` where `l: &&str` still works via auto-deref, matching the existing call.

- [ ] **Step 2: Run the existing test suite to confirm no regression**

Run: `cd src-tauri && cargo test hosts_parser::tests`
Expected: all existing tests (`round_trip_preserves_unmanaged_content_with_no_entries`, `adds_managed_block_around_existing_content`, `managed_block_round_trips_with_unmanaged_lines_untouched`, `parses_existing_managed_block_for_first_run_import`, etc.) still PASS unchanged.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/hosts_parser.rs
git commit -m "Extract find_managed_block_bounds from hosts_parser for reuse by the raw editor's linter"
```

---

## Task 3: Backend — lint module (`lint.rs`)

**Files:**
- Create: `src-tauri/src/lint.rs`
- Modify: `src-tauri/src/lib.rs` (register module)

**Interfaces:**
- Consumes: `hosts_parser::find_managed_block_bounds` (Task 2), `validate::is_valid_ip`, `validate::is_valid_hostname`, `validate::is_shadow_domain` (existing).
- Produces: `pub struct LintDiagnostic { pub line: usize, pub severity: String, pub message: String }` (`severity` is `"error" | "warning"`, `line` is 1-based), `pub fn lint_managed_block(content: &str) -> Vec<LintDiagnostic>`.

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/src/lint.rs`:

```rust
use std::collections::HashSet;

use serde::Serialize;

use crate::hosts_parser;
use crate::validate;

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct LintDiagnostic {
    pub line: usize,
    pub severity: String,
    pub message: String,
}

pub fn lint_managed_block(content: &str) -> Vec<LintDiagnostic> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wrap(body: &str) -> String {
        format!("{}\n{}\n{}\n", hosts_parser::START_MARKER, body, hosts_parser::END_MARKER)
    }

    #[test]
    fn valid_line_produces_no_diagnostics() {
        let content = wrap("127.0.0.1\tapi.local");
        assert!(lint_managed_block(&content).is_empty());
    }

    #[test]
    fn invalid_ip_is_an_error() {
        let content = wrap("999.1.1.1\tapi.local");
        let diags = lint_managed_block(&content);
        assert_eq!(diags.len(), 1);
        assert_eq!(diags[0].severity, "error");
        assert!(diags[0].message.contains("999.1.1.1"));
    }

    #[test]
    fn invalid_hostname_is_an_error() {
        let content = wrap("127.0.0.1\thas space.com");
        let diags = lint_managed_block(&content);
        assert!(diags.iter().any(|d| d.severity == "error" && d.message.contains("has")));
    }

    #[test]
    fn shadow_domain_is_a_warning() {
        let content = wrap("127.0.0.1\tlocalhost");
        let diags = lint_managed_block(&content);
        assert_eq!(diags.len(), 1);
        assert_eq!(diags[0].severity, "warning");
        assert!(diags[0].message.contains("localhost"));
    }

    #[test]
    fn duplicate_hostname_is_a_warning() {
        let content = wrap("127.0.0.1\tapi.local\n10.0.0.2\tapi.local");
        let diags = lint_managed_block(&content);
        assert!(diags.iter().any(|d| d.severity == "warning" && d.message.contains("already defined")));
    }

    #[test]
    fn malformed_line_is_a_single_error() {
        let content = wrap("not-a-valid-line-at-all-just-one-token");
        let diags = lint_managed_block(&content);
        assert_eq!(diags.len(), 1);
        assert_eq!(diags[0].severity, "error");
    }

    #[test]
    fn line_numbers_account_for_content_before_the_managed_block() {
        let content = format!(
            "# a leading comment\n\n{}\n999.1.1.1\tbad.local\n{}\n",
            hosts_parser::START_MARKER,
            hosts_parser::END_MARKER
        );
        let diags = lint_managed_block(&content);
        assert_eq!(diags.len(), 1);
        assert_eq!(diags[0].line, 4);
    }

    #[test]
    fn content_with_no_managed_block_produces_no_diagnostics() {
        let content = "127.0.0.1\tlocalhost\n999.1.1.1\tbad-but-unmanaged.local\n";
        assert!(lint_managed_block(content).is_empty());
    }
}
```

Add `mod lint;` to `src-tauri/src/lib.rs` (insert alphabetically, after `mod hosts_parser;`):

```rust
mod hosts_parser;
mod lint;
mod models;
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test lint::tests`
Expected: compile error or panic from the `todo!()`.

- [ ] **Step 3: Implement `lint_managed_block`**

Replace the `todo!()` body in `src-tauri/src/lint.rs`:

```rust
pub fn lint_managed_block(content: &str) -> Vec<LintDiagnostic> {
    let mut diagnostics = Vec::new();
    let Some((start, end)) = hosts_parser::find_managed_block_bounds(content) else {
        return diagnostics;
    };
    let lines: Vec<&str> = content.lines().collect();
    let mut seen_hostnames: HashSet<String> = HashSet::new();

    for (offset, raw) in lines[start + 1..end].iter().enumerate() {
        let line_no = start + 2 + offset;
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        let body = trimmed.trim_start_matches('#').trim_start();
        if body.is_empty() {
            continue;
        }
        let main = match body.find('#') {
            Some(idx) => body[..idx].trim(),
            None => body,
        };
        let mut parts = main.split_whitespace();
        let Some(ip) = parts.next() else {
            diagnostics.push(LintDiagnostic {
                line: line_no,
                severity: "error".to_string(),
                message: "Line isn't valid hosts-file syntax (expected: IP  hostname)".to_string(),
            });
            continue;
        };
        let hostname_tokens: Vec<&str> = parts.collect();
        if hostname_tokens.is_empty() {
            diagnostics.push(LintDiagnostic {
                line: line_no,
                severity: "error".to_string(),
                message: "Line isn't valid hosts-file syntax (expected: IP  hostname)".to_string(),
            });
            continue;
        }

        if !validate::is_valid_ip(ip) {
            diagnostics.push(LintDiagnostic {
                line: line_no,
                severity: "error".to_string(),
                message: format!("'{ip}' is not a valid IP address"),
            });
        }

        for h in &hostname_tokens {
            if !validate::is_valid_hostname(h) {
                diagnostics.push(LintDiagnostic {
                    line: line_no,
                    severity: "error".to_string(),
                    message: format!("'{h}' is not a valid hostname"),
                });
                continue;
            }
            if validate::is_shadow_domain(h) {
                diagnostics.push(LintDiagnostic {
                    line: line_no,
                    severity: "warning".to_string(),
                    message: format!("'{h}' is a reserved system hostname \u{2014} overriding it can affect the OS itself"),
                });
            }
            if !seen_hostnames.insert(h.to_string()) {
                diagnostics.push(LintDiagnostic {
                    line: line_no,
                    severity: "warning".to_string(),
                    message: format!("'{h}' is already defined on another line"),
                });
            }
        }
    }

    diagnostics
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test lint::tests`
Expected: all 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lint.rs src-tauri/src/lib.rs
git commit -m "Add managed-block lint module for the raw hosts file editor"
```

---

## Task 4: Backend — extend `DiffPreview` with raw-mode fields

**Files:**
- Modify: `src-tauri/src/models.rs:1-74`
- Modify: `src-tauri/src/commands.rs` (4 existing `DiffPreview` construction sites)

**Interfaces:**
- Consumes: `diff::DiffLine` (Task 1), `lint::LintDiagnostic` (Task 3).
- Produces: `DiffPreview.diff_lines: Option<Vec<DiffLine>>`, `DiffPreview.diagnostics: Option<Vec<LintDiagnostic>>` — both `None` for every mode except `"raw"`.

- [ ] **Step 1: Add the two fields to the model**

In `src-tauri/src/models.rs`, add imports at the top and extend `DiffPreview`:

```rust
use crate::diff::DiffLine;
use crate::lint::LintDiagnostic;
```

```rust
#[derive(Serialize, Clone, Debug)]
pub struct DiffPreview {
    pub mode: String, // "save" | "restore" | "view" | "delete" | "raw"
    #[serde(rename = "isNew")]
    pub is_new: bool,
    #[serde(rename = "isRemoval")]
    pub is_removal: bool,
    pub title: String,
    pub subtitle: String,
    #[serde(rename = "beforeLine")]
    pub before_line: Option<String>,
    #[serde(rename = "afterLine")]
    pub after_line: Option<String>,
    #[serde(rename = "isShadowDomain")]
    pub is_shadow_domain: bool,
    #[serde(rename = "restoreTargetId")]
    pub restore_target_id: Option<String>,
    #[serde(rename = "historyBefore")]
    pub history_before: Option<Entry>,
    #[serde(rename = "historyAfter")]
    pub history_after: Option<Entry>,
    #[serde(rename = "diffLines")]
    pub diff_lines: Option<Vec<DiffLine>>,
    pub diagnostics: Option<Vec<LintDiagnostic>>,
}
```

- [ ] **Step 2: Update the four existing `DiffPreview { ... }` literals in `commands.rs` to add the two new fields as `None`**

In `preview_save` (ends around line 219–231), `history_diff` (ends around line 401–413), `preview_restore` (ends around line 433–449), and `preview_delete` (ends around line 516–528), add these two lines right before each literal's closing `})`:

```rust
        diff_lines: None,
        diagnostics: None,
```

For example, `preview_save`'s literal becomes:

```rust
    Ok(DiffPreview {
        mode: "save".to_string(),
        is_new,
        is_removal: false,
        title,
        subtitle: "Review the line that will change in the hosts file before writing.".to_string(),
        before_line: before.as_ref().map(hosts_parser::build_line),
        after_line: Some(hosts_parser::build_line(&after)),
        is_shadow_domain: is_shadow,
        restore_target_id: None,
        history_before: None,
        history_after: None,
        diff_lines: None,
        diagnostics: None,
    })
```

Apply the same two-field addition to the `history_diff`, `preview_restore`, and `preview_delete` literals.

- [ ] **Step 3: Verify it compiles**

Run: `cd src-tauri && cargo build`
Expected: builds cleanly (this is a pure data-shape change — no new tests needed since `DiffPreview` has no behavior of its own; the existing `cargo test` suite exercises the surrounding commands' logic, not JSON shape).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/models.rs src-tauri/src/commands.rs
git commit -m "Add diffLines/diagnostics fields to DiffPreview for the raw editor's diff mode"
```

---

## Task 5: Backend — `read_hosts_file`, `preview_raw_save`, `lint_hosts_content` commands

**Files:**
- Modify: `src-tauri/src/commands.rs` (add three commands; add `use crate::diff;` and `use crate::lint;`)
- Modify: `src-tauri/src/lib.rs` (register the three commands)

**Interfaces:**
- Consumes: `diff::diff_lines` (Task 1), `lint::lint_managed_block` (Task 3), `DiffPreview` with the new fields (Task 4), `state.hosts_path` (existing `AppState` field).
- Produces: three `#[tauri::command]` functions callable from the frontend as `read_hosts_file`, `preview_raw_save`, `lint_hosts_content`.

- [ ] **Step 1: Add the imports and the three commands**

In `src-tauri/src/commands.rs`, add near the top (with the other `use crate::...` lines):

```rust
use crate::diff;
use crate::lint;
```

Add these three commands, placed after `preview_delete`/`confirm_delete` (around what is currently line 566) and before `flush_dns`:

```rust
/// Reads `/etc/hosts` fresh off disk, for opening the raw editor and for
/// refreshing it after an external-change reload.
#[tauri::command]
pub fn read_hosts_file(state: State<AppState>) -> Result<String, String> {
    std::fs::read_to_string(&state.hosts_path).map_err(|e| format!("Failed to read the hosts file: {e}"))
}

/// Read-only diff + lint pass for the raw editor's Save confirmation.
/// Diffs the given `content` against what's currently on disk and lints
/// its managed block, without writing anything.
#[tauri::command]
pub fn preview_raw_save(state: State<AppState>, content: String) -> Result<DiffPreview, String> {
    let current = std::fs::read_to_string(&state.hosts_path).map_err(|e| format!("Failed to read the hosts file: {e}"))?;
    let diff_lines = diff::diff_lines(&current, &content);
    let diagnostics = lint::lint_managed_block(&content);

    Ok(DiffPreview {
        mode: "raw".to_string(),
        is_new: false,
        is_removal: false,
        title: "Save changes to the hosts file".to_string(),
        subtitle: "Review what will change before writing.".to_string(),
        before_line: None,
        after_line: None,
        is_shadow_domain: false,
        restore_target_id: None,
        history_before: None,
        history_after: None,
        diff_lines: Some(diff_lines),
        diagnostics: Some(diagnostics),
    })
}

/// Live linting while typing in the raw editor. Shares `lint::lint_managed_block`
/// with `preview_raw_save` so the two can never disagree about what's invalid.
#[tauri::command]
pub fn lint_hosts_content(content: String) -> Vec<lint::LintDiagnostic> {
    lint::lint_managed_block(&content)
}
```

- [ ] **Step 2: Register the three commands in `lib.rs`**

In `src-tauri/src/lib.rs`, add to the `invoke_handler(tauri::generate_handler![...])` list, after `commands::preview_delete, commands::confirm_delete,`:

```rust
            commands::read_hosts_file,
            commands::preview_raw_save,
            commands::lint_hosts_content,
```

- [ ] **Step 3: Verify it compiles and existing tests still pass**

Run: `cd src-tauri && cargo build && cargo test`
Expected: builds cleanly; all existing tests still PASS (these three commands have no unit tests of their own — they're thin wrappers around already-tested `diff::diff_lines` and `lint::lint_managed_block` plus a plain file read, consistent with how the rest of `commands.rs` isn't unit-tested directly).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "Add read_hosts_file, preview_raw_save, and lint_hosts_content commands"
```

---

## Task 6: Backend — `confirm_raw_save` with entry reconciliation

**Files:**
- Modify: `src-tauri/src/commands.rs` (refactor `backup_and_write`; add `confirm_raw_save` + reconciliation helpers)
- Modify: `src-tauri/src/lib.rs` (register the command)

**Interfaces:**
- Consumes: `hosts_parser::parse_managed_block` (existing), `store::list_entries`/`insert_entry`/`update_entry`/`delete_entry`/`insert_history` (existing), `models::{Entry, EntryDraft, IpDraft}` (existing).
- Produces: `write_content_to_hosts_file(app: &AppHandle, state: &AppState, new_content: &str, do_flush: bool) -> Result<(elevate::WriteOutcome, String), String>` (used by both `backup_and_write` and `confirm_raw_save`), and the `confirm_raw_save` command.

- [ ] **Step 1: Extract `write_content_to_hosts_file` out of `backup_and_write`**

In `src-tauri/src/commands.rs`, replace the existing `backup_and_write` function (currently lines 91–160) with:

```rust
/// Backs up the current hosts file, regenerates it from `entries`, and
/// writes it. See `write_content_to_hosts_file` for the actual write.
fn backup_and_write(
    app: &AppHandle,
    state: &AppState,
    entries: &[Entry],
    do_flush: bool,
) -> Result<(elevate::WriteOutcome, String), String> {
    let current = std::fs::read_to_string(&state.hosts_path)
        .map_err(|e| format!("Failed to read the hosts file: {e}"))?;
    let parsed = hosts_parser::parse(&current);
    let new_content = hosts_parser::render(&parsed, entries);
    write_content_to_hosts_file(app, state, &new_content, do_flush)
}

/// Backs up the current hosts file and writes `new_content` to it verbatim.
/// Prefers the privileged helper daemon (no prompt) when it's reachable;
/// otherwise installs it and performs this write in the same elevated
/// prompt, so only the very first write (or a write after the daemon has
/// somehow stopped) ever prompts. Primes `last_written` before issuing the
/// write so the file watcher doesn't mistake this write for an out-of-band
/// edit.
fn write_content_to_hosts_file(
    app: &AppHandle,
    state: &AppState,
    new_content: &str,
    do_flush: bool,
) -> Result<(elevate::WriteOutcome, String), String> {
    let current = std::fs::read_to_string(&state.hosts_path)
        .map_err(|e| format!("Failed to read the hosts file: {e}"))?;

    let timestamp = chrono::Utc::now().format("%Y%m%dT%H%M%S%.3fZ");
    let backup_path = state.backups_dir.join(format!("hosts-{timestamp}.bak"));
    std::fs::write(&backup_path, &current).map_err(|e| format!("Failed to write backup: {e}"))?;

    *state.last_written.lock().unwrap() = Some(new_content.to_string());

    let flush_cmd = if do_flush { dns_flush::flush_command() } else { None };

    let plain_elevated_write = |content: &str| -> Result<elevate::WriteOutcome, String> {
        let staging_path = state.backups_dir.join(".staging-hosts");
        hosts_parser::atomic_write(&staging_path, content)
            .map_err(|e| format!("Failed to stage the hosts file: {e}"))?;
        elevate::write_hosts_file(state.executor.as_ref(), &staging_path, &state.hosts_path, flush_cmd.as_deref())
    };

    let outcome = if helper_client::ping() {
        let write_ok = helper_client::write_hosts(new_content).is_ok();
        let flush_ok = if write_ok && do_flush {
            Some(helper_client::flush_dns().is_ok())
        } else {
            None
        };
        elevate::WriteOutcome { write_ok, flush_ok }
    } else if state.helper_enabled.load(std::sync::atomic::Ordering::Relaxed) {
        match helper_install::install_and_write(
            app,
            state.executor.as_ref(),
            &state.backups_dir,
            new_content,
            &state.hosts_path,
            flush_cmd.as_deref(),
        ) {
            Ok(outcome) => outcome,
            Err(_) => plain_elevated_write(new_content)?,
        }
    } else {
        plain_elevated_write(new_content)?
    };

    if !outcome.write_ok {
        *state.last_written.lock().unwrap() = None;
    }

    Ok((outcome, backup_path.to_string_lossy().to_string()))
}
```

- [ ] **Step 2: Add the reconciliation helpers and `confirm_raw_save`**

Add to `src-tauri/src/commands.rs`, right after `lint_hosts_content` (from Task 5):

```rust
/// One structured-entry change produced by reconciling a raw save's
/// managed block against the existing entry table.
enum ReconcileChange {
    Added { after: Entry },
    Edited { before: Entry, after: Entry },
    Deleted { before: Entry },
}

/// Mutates the entries table to match `parsed_lines` (the newly-saved
/// managed block), matching by exact hostname string:
/// - A line whose hostname matches an existing entry updates that entry in
///   place (keeping its id and any extra, non-active IP candidates) — but
///   only if something actually differs, so untouched lines produce no
///   history noise.
/// - An unmatched line becomes a new entry.
/// - An existing entry whose hostname no longer appears is deleted.
/// Returns the list of changes so the caller can record history for them
/// once the on-disk write (which needs to happen first, for rollback
/// safety) has succeeded.
fn plan_reconciliation(
    tx: &rusqlite::Transaction,
    parsed_lines: &[hosts_parser::ParsedManagedLine],
) -> Result<Vec<ReconcileChange>, String> {
    let existing = store::list_entries(tx).map_err(|e| e.to_string())?;
    let mut existing_by_hostname: std::collections::HashMap<String, Entry> =
        existing.into_iter().map(|e| (e.hostname.clone(), e)).collect();
    let mut changes = Vec::new();

    for line in parsed_lines {
        if let Some(existing_entry) = existing_by_hostname.remove(&line.hostname) {
            let active_ip = existing_entry
                .ips
                .iter()
                .find(|ip| ip.id == existing_entry.active_ip_id)
                .map(|ip| ip.ip.as_str());
            let changed = existing_entry.comment != line.comment
                || existing_entry.enabled != line.enabled
                || active_ip != Some(line.ip.as_str());
            if !changed {
                continue;
            }
            let draft = EntryDraft {
                id: Some(existing_entry.id.clone()),
                hostname: line.hostname.clone(),
                comment: line.comment.clone(),
                group: existing_entry.group.clone(),
                enabled: line.enabled,
                active_uid: existing_entry.active_ip_id.clone(),
                ips: existing_entry
                    .ips
                    .iter()
                    .map(|ip| crate::models::IpDraft {
                        uid: ip.id.clone(),
                        label: ip.label.clone(),
                        ip: if ip.id == existing_entry.active_ip_id { line.ip.clone() } else { ip.ip.clone() },
                    })
                    .collect(),
            };
            let after = store::update_entry(tx, &existing_entry.id, &draft).map_err(|e| e.to_string())?;
            changes.push(ReconcileChange::Edited { before: existing_entry, after });
        } else {
            let ip_uid = uuid::Uuid::new_v4().to_string();
            let draft = EntryDraft {
                id: None,
                hostname: line.hostname.clone(),
                comment: line.comment.clone(),
                group: String::new(),
                enabled: line.enabled,
                active_uid: ip_uid.clone(),
                ips: vec![crate::models::IpDraft { uid: ip_uid, label: line.ip.clone(), ip: line.ip.clone() }],
            };
            let after = store::insert_entry(tx, &draft).map_err(|e| e.to_string())?;
            changes.push(ReconcileChange::Added { after });
        }
    }

    for (_, orphaned) in existing_by_hostname {
        store::delete_entry(tx, &orphaned.id).map_err(|e| e.to_string())?;
        changes.push(ReconcileChange::Deleted { before: orphaned });
    }

    Ok(changes)
}

/// Records one History row per change, using the shared backup path from
/// the write that just succeeded. Called only after the write succeeds.
fn record_reconciliation_history(
    tx: &rusqlite::Transaction,
    changes: &[ReconcileChange],
    backup_path: &str,
) -> Result<(), String> {
    for change in changes {
        match change {
            ReconcileChange::Added { after } => {
                store::insert_history(tx, &after.hostname, "Added entry", Some(&after.id), None, Some(after), Some(backup_path))
                    .map_err(|e| e.to_string())?;
            }
            ReconcileChange::Edited { before, after } => {
                store::insert_history(tx, &after.hostname, "Edited entry", Some(&after.id), Some(before), Some(after), Some(backup_path))
                    .map_err(|e| e.to_string())?;
            }
            ReconcileChange::Deleted { before } => {
                store::insert_history(tx, &before.hostname, "Deleted entry", Some(&before.id), Some(before), None, Some(backup_path))
                    .map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

/// Writes `content` verbatim to the hosts file, then reconciles the
/// structured entry table to match its managed block. DB mutation happens
/// before the disk write (so a write failure rolls the transaction back
/// and nothing diverges); history rows are recorded after, once the
/// backup path from the successful write is known.
#[tauri::command]
pub fn confirm_raw_save(app: AppHandle, state: State<AppState>, content: String) -> Result<WriteResult, String> {
    let mut conn = state.conn.lock().unwrap();
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let parsed_lines = hosts_parser::parse_managed_block(&content);
    let changes = plan_reconciliation(&tx, &parsed_lines)?;

    let (outcome, backup_path) = write_content_to_hosts_file(&app, &state, &content, false)?;
    if !outcome.write_ok {
        return Err("Failed to write the hosts file.".to_string());
    }

    record_reconciliation_history(&tx, &changes, &backup_path)?;
    prune_history(&tx)?;
    tx.commit().map_err(|e| e.to_string())?;

    Ok(WriteResult { entry: None, flush_ok: None, flush_message: None })
}
```

- [ ] **Step 3: Register the command in `lib.rs`**

In `src-tauri/src/lib.rs`, add after `commands::lint_hosts_content,`:

```rust
            commands::confirm_raw_save,
```

- [ ] **Step 4: Verify it compiles and existing tests still pass**

Run: `cd src-tauri && cargo build && cargo test`
Expected: builds cleanly; all existing tests still PASS. `backup_and_write`'s behavior is unchanged (same steps, same order), so `confirm_save`/`switch_active_ip`/`toggle_enabled`/`confirm_restore`/`confirm_delete` (which all call it) are unaffected.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "Add confirm_raw_save with hostname-matched entry reconciliation"
```

---

## Task 7: Frontend — types and API bindings

**Files:**
- Modify: `src/types.ts`
- Modify: `src/api.ts`

**Interfaces:**
- Consumes: nothing new (mirrors the Rust `DiffPreview`/`LintDiagnostic`/`DiffLine` shapes from Tasks 1, 3, 4).
- Produces: `DiffLine`, `LintDiagnostic` types; `DiffMode` gains `"raw"`; `DiffPreview` gains `diffLines`/`diagnostics`; `api.readHostsFile()`, `api.previewRawSave(content)`, `api.confirmRawSave(content)`, `api.lintHostsContent(content)`.

- [ ] **Step 1: Extend `src/types.ts`**

Add these two new interfaces anywhere above `DiffPreview`:

```typescript
export interface DiffLine {
  kind: "same" | "added" | "removed";
  text: string;
}

export interface LintDiagnostic {
  line: number;
  severity: "error" | "warning";
  message: string;
}
```

Update `DiffMode` and `DiffPreview`:

```typescript
export type DiffMode = "save" | "restore" | "view" | "delete" | "raw";

export interface DiffPreview {
  mode: DiffMode;
  isNew: boolean;
  isRemoval: boolean;
  title: string;
  subtitle: string;
  beforeLine: string | null;
  afterLine: string | null;
  isShadowDomain: boolean;
  restoreTargetId: string | null;
  historyBefore: Entry | null;
  historyAfter: Entry | null;
  diffLines: DiffLine[] | null;
  diagnostics: LintDiagnostic[] | null;
}
```

- [ ] **Step 2: Extend `src/api.ts`**

Update the import line to include the new types:

```typescript
import type { DiffPreview, Entry, EntryDraft, HistoryEntry, HistoryRetention, LintDiagnostic, WriteResult } from "./types";
```

Add these bindings to the `api` object, after `confirmDelete`:

```typescript
  readHostsFile: () => invoke<string>("read_hosts_file"),
  previewRawSave: (content: string) => invoke<DiffPreview>("preview_raw_save", { content }),
  confirmRawSave: (content: string) => invoke<WriteResult>("confirm_raw_save", { content }),
  lintHostsContent: (content: string) => invoke<LintDiagnostic[]>("lint_hosts_content", { content }),
```

- [ ] **Step 3: Verify it type-checks**

Run: `npm run build`
Expected: builds cleanly (no consumers of the new fields/bindings exist yet, so this is purely additive).

- [ ] **Step 4: Commit**

```bash
git add src/types.ts src/api.ts
git commit -m "Add types and API bindings for the raw hosts file editor"
```

---

## Task 8: Frontend — CodeMirror syntax highlighting module

**Files:**
- Create: `src/components/hostsLanguage.ts`
- Modify: `package.json` (new dependencies)

**Interfaces:**
- Consumes: `ColorTokens` (existing, `src/theme.ts`).
- Produces: `export const hostsLanguage: StreamLanguage<HostsLineState>`, `export function hostsHighlightStyle(c: ColorTokens): HighlightStyle` — both consumed by Task 9's `RawEditorView`.

- [ ] **Step 1: Install the CodeMirror packages**

Run: `npm install @codemirror/state @codemirror/view @codemirror/commands @codemirror/language @codemirror/lint @lezer/highlight`
Expected: `package.json` gains six new entries under `dependencies`.

- [ ] **Step 2: Write the custom hosts-file language**

Create `src/components/hostsLanguage.ts`:

```typescript
import { StreamLanguage } from "@codemirror/language";
import { HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import type { StreamParser } from "@codemirror/language";
import type { ColorTokens } from "../theme";

interface HostsLineState {
  seenIpOnLine: boolean;
}

const hostsStreamParser: StreamParser<HostsLineState> = {
  startState: () => ({ seenIpOnLine: false }),
  token(stream, state) {
    if (stream.sol()) {
      state.seenIpOnLine = false;
      const trimmed = stream.string.trim();
      if (trimmed === "# reroute:start" || trimmed === "# reroute:end") {
        stream.skipToEnd();
        return "keyword";
      }
    }
    if (stream.eatSpace()) return null;
    if (stream.peek() === "#") {
      stream.skipToEnd();
      return "comment";
    }
    if (!state.seenIpOnLine) {
      stream.eatWhile(/\S/);
      state.seenIpOnLine = true;
      return "number";
    }
    stream.eatWhile(/\S/);
    return "string";
  },
};

export const hostsLanguage = StreamLanguage.define(hostsStreamParser);

/// Maps the language's legacy token names (keyword/comment/number/string)
/// to colors pulled from the active theme's ColorTokens, so highlighting
/// matches the app's light/dark/true-dark palette automatically.
export function hostsHighlightStyle(c: ColorTokens): HighlightStyle {
  return HighlightStyle.define([
    { tag: tags.keyword, color: c.accent, fontWeight: "700" },
    { tag: tags.comment, color: c.textFaint, fontStyle: "italic" },
    { tag: tags.number, color: c.accent },
    { tag: tags.string, color: c.text },
  ]);
}
```

- [ ] **Step 3: Verify it type-checks**

Run: `npm run build`
Expected: builds cleanly (not imported anywhere yet, so this only needs to type-check on its own).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/components/hostsLanguage.ts
git commit -m "Add CodeMirror dependencies and a custom hosts-file syntax highlighter"
```

---

## Task 9: Frontend — `RawEditorView` component

**Files:**
- Create: `src/components/RawEditorView.tsx`

**Interfaces:**
- Consumes: `hostsLanguage`/`hostsHighlightStyle` (Task 8), `api.lintHostsContent` (Task 7), `LintDiagnostic` (Task 7), `ColorTokens` (existing).
- Produces: `<RawEditorView c baseline content disabled onChange onRequestSave />` — a controlled editor: `content` is the live draft (owned by the parent), `baseline` is what's currently saved to disk, `onChange(text)` fires on every doc edit, `onRequestSave(text)` fires on the Save button or Cmd/Ctrl+S. Consumed by Task 12's `App.tsx`.

- [ ] **Step 1: Write the component**

Create `src/components/RawEditorView.tsx`:

```tsx
import { useEffect, useRef } from "react";
import { Compartment } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { linter, lintGutter, type Diagnostic } from "@codemirror/lint";
import { syntaxHighlighting } from "@codemirror/language";
import type { ColorTokens } from "../theme";
import type { LintDiagnostic } from "../types";
import { api } from "../api";
import { hostsLanguage, hostsHighlightStyle } from "./hostsLanguage";

interface RawEditorViewProps {
  c: ColorTokens;
  content: string;
  baseline: string;
  disabled: boolean;
  onChange: (content: string) => void;
  onRequestSave: (content: string) => void;
}

function buildEditorTheme(c: ColorTokens) {
  return EditorView.theme({
    "&": { color: c.text, backgroundColor: c.bg, height: "100%", fontSize: "12.5px" },
    ".cm-content": { fontFamily: "'JetBrains Mono',monospace", caretColor: c.text },
    ".cm-gutters": { backgroundColor: c.bg, color: c.textFaint, border: "none" },
    ".cm-activeLine": { backgroundColor: c.rowHover },
    ".cm-activeLineGutter": { backgroundColor: c.rowHover },
  });
}

export function RawEditorView({ c, content, baseline, disabled, onChange, onRequestSave }: RawEditorViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const lastEmitted = useRef(content);
  const onChangeRef = useRef(onChange);
  const onRequestSaveRef = useRef(onRequestSave);
  const themeCompartment = useRef(new Compartment());
  const highlightCompartment = useRef(new Compartment());

  onChangeRef.current = onChange;
  onRequestSaveRef.current = onRequestSave;

  useEffect(() => {
    const view = new EditorView({
      doc: content,
      parent: containerRef.current!,
      extensions: [
        lineNumbers(),
        history(),
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: (v) => {
              onRequestSaveRef.current(v.state.doc.toString());
              return true;
            },
          },
          ...historyKeymap,
          ...defaultKeymap,
        ]),
        hostsLanguage,
        themeCompartment.current.of(buildEditorTheme(c)),
        highlightCompartment.current.of(syntaxHighlighting(hostsHighlightStyle(c))),
        lintGutter(),
        linter(
          async (v) => {
            const diagnostics: LintDiagnostic[] = await api.lintHostsContent(v.state.doc.toString());
            return diagnostics.map((d): Diagnostic => {
              const clampedLine = Math.min(Math.max(d.line, 1), v.state.doc.lines);
              const line = v.state.doc.line(clampedLine);
              return { from: line.from, to: line.to, severity: d.severity, message: d.message };
            });
          },
          { delay: 500 },
        ),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const text = update.state.doc.toString();
            lastEmitted.current = text;
            onChangeRef.current(text);
          }
        }),
      ],
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Intentionally runs once: theme/highlight updates go through the
    // compartments below rather than tearing down and recreating the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: [
        themeCompartment.current.reconfigure(buildEditorTheme(c)),
        highlightCompartment.current.reconfigure(syntaxHighlighting(hostsHighlightStyle(c))),
      ],
    });
  }, [c]);

  useEffect(() => {
    const view = viewRef.current;
    if (view && content !== lastEmitted.current && content !== view.state.doc.toString()) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } });
      lastEmitted.current = content;
    }
  }, [content]);

  const dirty = content !== baseline;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: c.bg }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 16px",
          borderBottom: `1px solid ${c.border}`,
          flex: "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: c.textMuted }}>
          {dirty && <span style={{ width: 6, height: 6, borderRadius: "50%", background: c.accent, flex: "none" }} />}
          {dirty ? "Unsaved changes" : "/etc/hosts"}
        </div>
        <button
          onClick={() => onRequestSave(content)}
          disabled={!dirty || disabled}
          style={{
            height: 30,
            padding: "0 14px",
            borderRadius: 7,
            border: "none",
            background: c.accent,
            color: "#fff",
            fontSize: 12.5,
            fontWeight: 600,
            cursor: !dirty || disabled ? "not-allowed" : "pointer",
            opacity: !dirty || disabled ? 0.5 : 1,
          }}
        >
          Save
        </button>
      </div>
      <div ref={containerRef} className="hm-scroll" style={{ flex: 1, overflow: "auto" }} />
    </div>
  );
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npm run build`
Expected: builds cleanly (not rendered anywhere yet).

- [ ] **Step 3: Commit**

```bash
git add src/components/RawEditorView.tsx
git commit -m "Add RawEditorView: CodeMirror-based editor with live linting"
```

---

## Task 10: Frontend — Sidebar nav item and icon

**Files:**
- Modify: `src/components/icons.tsx` (add `FileIcon`)
- Modify: `src/components/Sidebar.tsx`

**Interfaces:**
- Consumes: existing `NavButton` pattern in `Sidebar.tsx`.
- Produces: `Sidebar`'s `view` prop type gains `"raw"`; new `onGoRaw: () => void` prop. Consumed by Task 12's `App.tsx`.

- [ ] **Step 1: Add `FileIcon` to `src/components/icons.tsx`**

Add after `MonitorIcon`:

```tsx
export function FileIcon({ size = 15, color = "currentColor" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2h9l5 5v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" />
      <path d="M15 2v5h5" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="13" y2="17" />
    </svg>
  );
}
```

- [ ] **Step 2: Add the third nav item to `Sidebar.tsx`**

Update the import and prop types:

```typescript
import { FileIcon, HistoryIcon, ListIcon } from "./icons";
```

```typescript
interface SidebarProps {
  c: ColorTokens;
  view: "list" | "history" | "raw";
  onGoList: () => void;
  onGoHistory: () => void;
  onGoRaw: () => void;
  entryCount: number;
  groups: GroupSummary[];
  groupFilter: string | null;
  onSelectGroup: (group: string) => void;
}

export function Sidebar({
  c,
  view,
  onGoList,
  onGoHistory,
  onGoRaw,
  entryCount,
  groups,
  groupFilter,
  onSelectGroup,
}: SidebarProps) {
```

Add the nav button right after the existing "History" `NavButton` (which currently ends the visible nav list before the groups section):

```tsx
      <NavButton
        c={c}
        active={view === "raw"}
        onClick={onGoRaw}
        icon={<FileIcon color={view === "raw" ? c.accent : c.textMuted} />}
        label="Raw File"
      />
```

- [ ] **Step 3: Verify it type-checks**

Run: `npm run build`
Expected: fails — `App.tsx` renders `<Sidebar>` without `onGoRaw`. This is expected; Task 12 wires it up. Confirm the *only* error is the missing `onGoRaw` prop on the `<Sidebar>` call site in `App.tsx` (not an unrelated regression).

- [ ] **Step 4: Commit**

```bash
git add src/components/icons.tsx src/components/Sidebar.tsx
git commit -m "Add Raw File nav item to the Sidebar"
```

---

## Task 11: Frontend — `DiffModal` raw-mode branch

**Files:**
- Modify: `src/components/DiffModal.tsx`

**Interfaces:**
- Consumes: `DiffPreview.diffLines`/`diagnostics` (Task 7).
- Produces: `DiffModal` renders a scrollable line diff + diagnostics summary when `diff.mode === "raw"`, instead of the single before/after row layout. No prop signature changes.

- [ ] **Step 1: Add the raw-mode confirm label and modal width**

In `src/components/DiffModal.tsx`, update the label/width logic:

```tsx
  const cancelLabel = diff.mode === "view" ? "Close" : "Cancel";
  const showConfirm = diff.mode !== "view";
  const confirmLabel =
    diff.mode === "restore" ? "Restore version" : diff.mode === "delete" ? "Delete entry" : diff.mode === "raw" ? "Save file" : "Write to hosts file";
  const confirmDisabled = diff.isShadowDomain && diff.mode === "save" && !shadowAck;
  const modalWidth = diff.mode === "raw" ? 640 : 560;
```

Update the modal's `width` style to use `modalWidth` instead of the hardcoded `560`.

- [ ] **Step 2: Add the diagnostics summary and branch the diff body**

Insert a diagnostics summary block right after the shadow-domain warning block (which stays as-is, gated on `diff.mode === "save"`):

```tsx
        {diff.mode === "raw" && diff.diagnostics && diff.diagnostics.length > 0 && (
          <div style={{ padding: "12px 24px 0" }}>
            <div
              style={{
                display: "flex",
                gap: 10,
                padding: "12px 14px",
                borderRadius: 10,
                background: diff.diagnostics.some((d) => d.severity === "error") ? c.redSoft : c.accentSoft,
                border: `1px solid ${diff.diagnostics.some((d) => d.severity === "error") ? c.red : c.accent}`,
              }}
            >
              <WarningIcon size={16} color={diff.diagnostics.some((d) => d.severity === "error") ? c.red : c.accent} />
              <div style={{ fontSize: 12.5, color: c.text, lineHeight: 1.5 }}>
                <strong>
                  {diff.diagnostics.filter((d) => d.severity === "error").length} error(s),{" "}
                  {diff.diagnostics.filter((d) => d.severity === "warning").length} warning(s)
                </strong>{" "}
                in the managed block. You can still save — review the lines below.
              </div>
            </div>
          </div>
        )}
```

Replace the "hosts file" diff block (the `<div style={{ padding: "16px 24px 8px", ...` block containing the `…`/`beforeLine`/`afterLine` rows) with a mode branch — wrap the existing single-line block in `diff.mode !== "raw" && (...)` and add a new sibling block for raw mode:

```tsx
        {diff.mode !== "raw" && (
          <div style={{ padding: "16px 24px 8px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: c.textFaint, textTransform: "uppercase", letterSpacing: ".04em" }}>
              hosts file
            </div>
            <div style={{ borderRadius: 10, overflow: "hidden", border: `1px solid ${c.border}`, fontFamily: "'JetBrains Mono',monospace", fontSize: 12.5 }}>
              <div style={{ padding: "9px 6px 9px 8px", color: c.textFaint }}>…</div>
              {diff.beforeLine && (
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    padding: "9px 6px 9px 8px",
                    background: c.redSoft,
                    color: c.red,
                    textDecoration: "line-through",
                    textDecorationColor: c.red,
                  }}
                >
                  <span style={{ flex: "none", fontWeight: 700 }}>−</span>
                  <span style={{ whiteSpace: "pre" }}>{diff.beforeLine}</span>
                </div>
              )}
              {diff.afterLine && (
                <div style={{ display: "flex", gap: 8, padding: "9px 6px 9px 8px", background: c.greenSoft, color: c.green }}>
                  <span style={{ flex: "none", fontWeight: 700 }}>+</span>
                  <span style={{ whiteSpace: "pre" }}>{diff.afterLine}</span>
                </div>
              )}
              <div style={{ padding: "9px 6px 9px 8px", color: c.textFaint }}>…</div>
            </div>
          </div>
        )}

        {diff.mode === "raw" && diff.diffLines && (
          <div style={{ padding: "16px 24px 8px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: c.textFaint, textTransform: "uppercase", letterSpacing: ".04em" }}>
              hosts file
            </div>
            <div
              style={{
                borderRadius: 10,
                overflow: "auto",
                maxHeight: 320,
                border: `1px solid ${c.border}`,
                fontFamily: "'JetBrains Mono',monospace",
                fontSize: 12.5,
              }}
            >
              {diff.diffLines.length === 0 ? (
                <div style={{ padding: "9px 6px 9px 8px", color: c.textFaint }}>No changes.</div>
              ) : (
                diff.diffLines.map((line, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: "flex",
                      gap: 8,
                      padding: "5px 6px 5px 8px",
                      background: line.kind === "added" ? c.greenSoft : line.kind === "removed" ? c.redSoft : "transparent",
                      color: line.kind === "added" ? c.green : line.kind === "removed" ? c.red : c.textFaint,
                      textDecoration: line.kind === "removed" ? "line-through" : "none",
                      textDecorationColor: c.red,
                    }}
                  >
                    <span style={{ flex: "none", fontWeight: 700, width: 10 }}>
                      {line.kind === "added" ? "+" : line.kind === "removed" ? "−" : ""}
                    </span>
                    <span style={{ whiteSpace: "pre" }}>{line.text}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
```

- [ ] **Step 3: Verify it type-checks**

Run: `npm run build`
Expected: builds cleanly.

- [ ] **Step 4: Commit**

```bash
git add src/components/DiffModal.tsx
git commit -m "Add raw-mode multi-line diff and diagnostics summary to DiffModal"
```

---

## Task 12: Frontend — wire the Raw File view into `App.tsx`

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `RawEditorView` (Task 9), `Sidebar`'s new `onGoRaw` prop (Task 10), `DiffModal`'s raw-mode rendering (Task 11), `api.readHostsFile`/`previewRawSave`/`confirmRawSave` (Task 7).
- Produces: fully working "Raw File" view.

- [ ] **Step 1: Extend `State`, `Action`, and the reducer**

Update the `view` field's type (currently `"list" | "history"`) and add three fields, in the `State` interface:

```typescript
  view: "list" | "history" | "raw";
```

```typescript
  pendingRawSave: string | null;
  rawFileContent: string | null;
  rawDraftContent: string | null;
```

Add to the `Action` union (near `SHOW_DIFF`/`CLOSE_DIFF`):

```typescript
  | { type: "GO_RAW" }
  | { type: "SET_RAW_FILE_CONTENT"; content: string }
  | { type: "SET_RAW_DRAFT_CONTENT"; content: string }
```

Extend the existing `SHOW_DIFF` action's payload:

```typescript
  | {
      type: "SHOW_DIFF";
      diff: DiffPreview;
      pendingDraft: EntryDraft | null;
      pendingRestoreId: string | null;
      pendingDeleteId: string | null;
      pendingRawSave: string | null;
    }
```

Add to `initialState`:

```typescript
  pendingRawSave: null,
  rawFileContent: null,
  rawDraftContent: null,
```

In the reducer, update `SHOW_DIFF`/`CLOSE_DIFF`/`CLOSE_DIFF_AND_DRAFT` to carry `pendingRawSave`:

```typescript
    case "SHOW_DIFF":
      return {
        ...state,
        diff: action.diff,
        pendingDraft: action.pendingDraft,
        pendingRestoreId: action.pendingRestoreId,
        pendingDeleteId: action.pendingDeleteId,
        pendingRawSave: action.pendingRawSave,
      };
    case "CLOSE_DIFF":
      return { ...state, diff: null, pendingDraft: null, pendingRestoreId: null, pendingDeleteId: null, pendingRawSave: null };
    case "CLOSE_DIFF_AND_DRAFT":
      return { ...state, diff: null, pendingDraft: null, pendingRestoreId: null, pendingDeleteId: null, pendingRawSave: null, editingDraft: null };
```

Add three new reducer cases, near `GO_LIST`/`GO_HISTORY`:

```typescript
    case "GO_RAW":
      return { ...state, view: "raw", trayOpen: false };
    case "SET_RAW_FILE_CONTENT":
      return { ...state, rawFileContent: action.content, rawDraftContent: action.content };
    case "SET_RAW_DRAFT_CONTENT":
      return { ...state, rawDraftContent: action.content };
```

- [ ] **Step 2: Update every other existing `SHOW_DIFF` dispatch to include `pendingRawSave: null`**

There are four existing call sites (in `handleRequestSave`'s two branches, `handleViewHistoryDiff`, `handleRequestRestore`, `handleRequestDelete`) — add `, pendingRawSave: null` to each:

```typescript
          dispatch({ type: "SHOW_DIFF", diff, pendingDraft: draft, pendingRestoreId: null, pendingDeleteId: null, pendingRawSave: null });
```

```typescript
      dispatch({ type: "SHOW_DIFF", diff, pendingDraft: draft, pendingRestoreId: null, pendingDeleteId: null, pendingRawSave: null });
```

```typescript
      dispatch({ type: "SHOW_DIFF", diff, pendingDraft: null, pendingRestoreId: null, pendingDeleteId: null, pendingRawSave: null });
```

```typescript
      dispatch({ type: "SHOW_DIFF", diff, pendingDraft: null, pendingRestoreId: id, pendingDeleteId: null, pendingRawSave: null });
```

```typescript
      dispatch({ type: "SHOW_DIFF", diff, pendingDraft: null, pendingRestoreId: null, pendingDeleteId: entryId, pendingRawSave: null });
```

- [ ] **Step 3: Load the raw file at mount, alongside entries/history**

Add a `refreshRawFile` function next to `refreshEntries`/`refreshHistory`:

```typescript
  async function refreshRawFile() {
    const content = await api.readHostsFile();
    dispatch({ type: "SET_RAW_FILE_CONTENT", content });
  }
```

In the mount `useEffect` (the one calling `refreshEntries()`/`refreshHistory()`/`refreshHelperStatus()`), add:

```typescript
    refreshRawFile().catch(() => {});
```

- [ ] **Step 4: Add `handleRequestRawSave` and extend `handleConfirmDiff`**

Add a new handler near `handleRequestDelete`:

```typescript
  async function handleRequestRawSave(content: string) {
    try {
      const diff = await api.previewRawSave(content);
      dispatch({ type: "SHOW_DIFF", diff, pendingDraft: null, pendingRestoreId: null, pendingDeleteId: null, pendingRawSave: content });
    } catch (err) {
      dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Couldn't preview changes", message: errorMessage(err) } });
    }
  }
```

In `handleConfirmDiff`, destructure `pendingRawSave` from `state` and add a branch before the final `else`:

```typescript
  async function handleConfirmDiff() {
    const { diff, pendingDraft, pendingRestoreId, pendingDeleteId, pendingRawSave } = state;
    if (!diff) return;
    try {
      if (diff.mode === "save" && pendingDraft) {
        await performConfirmSave(pendingDraft, diff.isNew);
        dispatch({ type: "CLOSE_DIFF_AND_DRAFT" });
      } else if (diff.mode === "restore" && pendingRestoreId) {
        // ...unchanged...
      } else if (diff.mode === "delete" && pendingDeleteId) {
        // ...unchanged...
      } else if (diff.mode === "raw" && pendingRawSave !== null) {
        await api.confirmRawSave(pendingRawSave);
        dispatch({ type: "SET_RAW_FILE_CONTENT", content: pendingRawSave });
        dispatch({ type: "CLOSE_DIFF" });
        await refreshEntries();
        await refreshHistory();
        refreshHelperStatus().catch(() => {});
        dispatch({ type: "SET_TOAST", toast: { type: "success", title: "Hosts file saved", message: "Your changes have been written to the hosts file." } });
      } else {
        dispatch({ type: "CLOSE_DIFF" });
      }
    } catch (err) {
      dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Write failed", message: errorMessage(err) } });
    }
  }
```

- [ ] **Step 5: Extend `handleReload` to also refresh raw content**

In `handleReload`, add a raw-file refresh alongside the existing two:

```typescript
  async function handleReload() {
    dispatch({ type: "DISMISS_EXTERNAL_CHANGE" });
    try {
      await refreshEntries();
      await refreshHistory();
      await refreshRawFile();
      dispatch({ type: "SET_TOAST", toast: { type: "success", title: "Reloaded", message: "Loaded the latest hosts file." } });
    } catch (err) {
      dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Reload failed", message: errorMessage(err) } });
    }
  }
```

- [ ] **Step 6: Wire the Sidebar, the view switch, and the RawEditorView**

Update the import line to add `RawEditorView`:

```typescript
import { RawEditorView } from "./components/RawEditorView";
```

Update the `<Sidebar>` call site to add `onGoRaw`:

```tsx
        <Sidebar
          c={c}
          view={state.view}
          onGoList={() => dispatch({ type: "GO_LIST" })}
          onGoHistory={() => dispatch({ type: "GO_HISTORY" })}
          onGoRaw={() => dispatch({ type: "GO_RAW" })}
          entryCount={state.entries.length}
          groups={groups}
          groupFilter={state.groupFilter}
          onSelectGroup={(g) => dispatch({ type: "SELECT_GROUP", group: g })}
        />
```

Replace the two-way `state.view === "list" ? <ListView .../> : <HistoryView .../>` ternary with a three-way branch:

```tsx
        {state.view === "list" ? (
          <ListView
            c={c}
            entries={filteredEntries}
            totalEntryCount={state.entries.length}
            search={state.search}
            onSearchChange={(v) => dispatch({ type: "SET_SEARCH", value: v })}
            onAddClick={() => dispatch({ type: "OPEN_ADD_PANEL" })}
            groupFilter={state.groupFilter}
            onClearGroupFilter={() => dispatch({ type: "CLEAR_GROUP_FILTER" })}
            openIpMenuId={state.openIpMenuId}
            flushingId={state.flushingId}
            disabled={state.externalChangeDetected}
            onToggleDropdown={(id) => dispatch({ type: "TOGGLE_IP_MENU", id })}
            onToggleEnabled={handleToggleEnabled}
            onEdit={(entry) => dispatch({ type: "OPEN_EDIT_PANEL", entry })}
            onSwitchIp={handleSwitchIp}
          />
        ) : state.view === "history" ? (
          <HistoryView c={c} history={state.history} onViewDiff={handleViewHistoryDiff} onRestore={handleRequestRestore} />
        ) : (
          <RawEditorView
            c={c}
            content={state.rawDraftContent ?? ""}
            baseline={state.rawFileContent ?? ""}
            disabled={state.externalChangeDetected}
            onChange={(content) => dispatch({ type: "SET_RAW_DRAFT_CONTENT", content })}
            onRequestSave={handleRequestRawSave}
          />
        )}
```

- [ ] **Step 7: Verify it builds**

Run: `npm run build`
Expected: builds cleanly with no type errors.

- [ ] **Step 8: Manual smoke test (requires the real Tauri app — run this yourself)**

This can't be run safely in this environment (it installs a privileged helper and prompts for your password). Once built, run `npm run tauri dev` and check:
1. Click "Raw File" in the sidebar — the editor loads with the current `/etc/hosts` content, syntax-highlighted (marker lines bold/accent, IPs colored, hostnames default text, `#` comments dimmed/italic).
2. Type an invalid IP or a shadow-domain hostname (e.g. `localhost`) inside the managed block — inline squiggles and gutter markers should appear within ~500ms.
3. Click Save (or Cmd+S) — the diff modal shows a scrollable added/removed line list and, if you introduced any lint issues, a non-blocking diagnostics summary banner.
4. Confirm — the file is written, the Hosts list and History both reflect the change, and a success toast appears.
5. Switch to Hosts/History and back to Raw File — any unsaved edits should still be there (not discarded by navigation).
6. Toggle Settings → Theme between Light/Dark/System while Raw File is open — the editor's colors should update live.

- [ ] **Step 9: Commit**

```bash
git add src/App.tsx
git commit -m "Wire the Raw File view into App.tsx"
```

---

## Self-Review Notes

- **Spec coverage:** `read_hosts_file`/`preview_raw_save`/`confirm_raw_save`/`lint_hosts_content` (Tasks 5–6), line diff (Task 1), lint scoped to managed block (Tasks 2–3), reconciliation by hostname with History rows only for actual changes (Task 6), verbatim write via `write_content_to_hosts_file` (Task 6), CodeMirror + custom language + lint gutter (Tasks 8–9), Sidebar entry (Task 10), diff-modal multi-line + diagnostics UI (Task 11), full `App.tsx` wiring including unsaved-draft persistence across view switches and the Reload interaction (Task 12) — all covered.
- **Type consistency checked:** `DiffLine.kind`/`LintDiagnostic.severity` are plain strings end-to-end (Rust `String` ⇄ TS string-literal unions), matching the codebase's existing convention for `DiffPreview.mode`. `ReconcileChange`/`plan_reconciliation`/`record_reconciliation_history` names and shapes are consistent between their definition and use in `confirm_raw_save`. `RawEditorView`'s prop names (`content`, `baseline`, `onChange`, `onRequestSave`) match exactly between Task 9's definition and Task 12's call site.
- **No placeholders remaining** — every step has complete, concrete code.
