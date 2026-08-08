# First-run onboarding to adopt existing hosts entries

## Problem

The app already lets a user adopt one unmanaged hosts-file entry at a time via a per-row "Adopt" button in the "Found in hosts file, not managed here" section of the Hosts list (see `2026-08-08-*` adopt work in `hosts_parser.rs`/`commands.rs`). But a brand-new user whose hosts file already has real entries (added manually, or by Docker Desktop, Valet, etc.) lands on an empty Hosts list with no prompt to notice that section, and has to adopt entries one at a time even if they want all of them.

## Goal

On a qualifying first launch, show a welcome modal that lists the hosts file's existing unmanaged entries as a checklist and lets the user adopt any number of them in a single write, before they ever see the (otherwise empty) main Hosts list.

## Trigger

Shown when, at launch, **both**:
- the managed block has zero entries (`list_entries` returns empty), and
- the settings flag `onboarding_seen` is not `"true"`

If the managed block is empty but there are also zero unmanaged entries to offer, the modal is skipped — there's nothing to onboard with, so the app opens straight to the normal empty Hosts list, same as today.

Either way — modal shown, or skipped because there was nothing to show — the frontend writes `onboarding_seen = "true"` via the existing generic `set_setting` command as soon as that decision is made, so the prompt never reappears on a later launch (even if the user skips without adopting anything, or the managed block later becomes non-empty and then gets emptied again). This reuses `get_setting`/`set_setting`, already exposed via `api.getSetting`/`api.setSetting` — no new backend command for the flag itself.

## UI — `OnboardingModal`

A full-screen-centered modal, styled consistently with `DiffModal`/`SettingsModal` (same overlay, `cardBg`, `popShadow` treatment), shown in place of the Hosts list until dismissed:

- **Header:** "Welcome to Reroute" / "We found {N} entries already in your hosts file. Choose which ones to bring under management here."
- **Select all / none:** a small toggle above the list, mirroring the checklist's current all-checked state.
- **Checklist:** one row per unmanaged entry (same `UnmanagedEntry` shape and exclusion rules as the existing per-row Adopt flow — no `localhost`/`broadcasthost`, no Docker Desktop section). Each row: checkbox (checked by default) + hostname + IP + comment, in a compact list — no per-row Adopt button here, selection state only.
- **Footer:** `Skip` (secondary, closes the modal without adopting anything) and `Adopt {N} entries` (primary; label updates live with the selection count; disabled when 0 selected).
- Clicking `Adopt {N} entries` writes immediately — the checklist rows already show hostname/IP/comment, so they serve as the review step, matching the existing precedent that brand-new single entries skip the diff modal when "confirm before save" is off. On success: normal success toast ("N entries adopted"), modal closes into the Hosts list showing the newly-adopted rows. On failure (e.g. an elevation prompt was cancelled): the modal stays open with an inline error message above the footer buttons, selection state preserved, so the user can retry or fall back to `Skip`.

## Backend — batch adopt

One new command, alongside the existing `confirm_adopt` (which stays as-is for the per-row Adopt button on the main list):

`confirm_adopt_many(app, state, ids: Vec<String>) -> Result<Vec<Entry>, String>`

- Re-reads `/etc/hosts` once, calls `hosts_parser::list_unmanaged_entries` once, and resolves every id in `ids` against that single snapshot — if any id isn't found (stale, file changed since the checklist was built), the whole call errors with the existing staleness message ("The hosts file changed since this was listed — reload and try again.") rather than adopting a partial set.
- In one DB transaction: `store::insert_entry` for each resolved unmanaged entry (in the order given), building each `EntryDraft` the same way `confirm_adopt` does today (single IP candidate labeled `"Imported"`).
- Removes all of their raw lines from the parsed prefix/suffix in one pass (highest line index first, so removing one doesn't shift the indices of the others still to be removed — see Testing below), then a single `hosts_parser::render` and a single `write_content_to_hosts_file` call, so the whole batch is one file write and one backup file.
- On success, one `store::insert_history` row per adopted entry (action `"Adopted entry"`, same as the single-entry path) so History reads the same either way, then `prune_history` once and commit.
- On write failure, the transaction is dropped uncommitted (same pattern as every other write command) — nothing is partially adopted.

No changes to `hosts_parser.rs` are needed. `confirm_adopt_many` sorts the resolved unmanaged entries by line index descending, then folds over them: starting from the on-disk content and the *pre-adopt* list of managed entries (i.e. not yet including the ones being adopted in this batch), repeatedly call the existing `remove_unmanaged_line(content, line_index, ip, hostname, comment)` to get back a `ParsedHostsFile`, immediately `render` that with the same pre-adopt entries list to get plain text again, and feed that text into the next iteration's `remove_unmanaged_line` call. Processing highest-index-first means removing one line never shifts the line index of another entry still waiting to be removed. After the fold, do one final `render` using the fully updated entries list (pre-adopt entries plus all newly-inserted ones) against the last `ParsedHostsFile`, and write that once.

## Frontend wiring

- `src/api.ts`: add `confirmAdoptMany: (ids: string[]) => invoke<Entry[]>("confirm_adopt_many", { ids })`.
- `src/App.tsx`:
  - On mount, after `refreshEntries()`/`refreshUnmanagedEntries()` resolve: if `entries.length === 0` and `await api.getSetting("onboarding_seen") !== "true"`, set a new `showOnboarding: boolean` state field to `unmanagedEntries.length > 0`, then immediately `api.setSetting("onboarding_seen", "true")` regardless of that value.
  - `showOnboarding` renders `<OnboardingModal>` instead of the normal view router when `true`.
  - `handleAdoptSelected(ids: string[])`: calls `api.confirmAdoptMany(ids)`, on success dispatches entries into state (append/`SET_ENTRIES` via a fresh `refreshEntries()` + `refreshUnmanagedEntries()`), closes onboarding, success toast. On error, keeps the modal open and surfaces the error inline (new local component state in `OnboardingModal`, not global `state.toast`, so it renders inside the modal).
  - `handleSkipOnboarding()`: just closes the modal (`showOnboarding: false`) — the flag was already persisted when the modal was decided on.
- New component `src/components/OnboardingModal.tsx`: owns local checklist selection state (`Set<string>` of selected unmanaged-entry ids), renders the header/list/footer described above, calls back to `App.tsx` via `onAdopt(ids)` / `onSkip()` props. Reuses `UnmanagedEntry` type and the same row-level text styling as `UnmanagedRow` where practical, but doesn't reuse `UnmanagedRow` itself (that component is tied to the list's grid layout and per-row Adopt button, which doesn't apply here).

## Testing

- Rust: a `hosts_parser` test constructing a hosts file with 3+ unmanaged lines, adopting a subset out of order (e.g. lines 1 and 3 of 4), asserting the remaining unmanaged line and the untouched prefix/suffix survive correctly — covering the "remove highest index first" ordering concern.
- Rust: a `commands`-level (or store-level) test that a failed write during `confirm_adopt_many` leaves the DB with zero new entries (transaction rollback), matching the all-or-nothing guarantee.
- Frontend: no new automated tests exist for `App.tsx` today (none of the existing adopt/delete/restore work added any); this follows that precedent and relies on manual verification, consistent with how the single-entry adopt flow was verified.

## Out of scope

- No way to re-open onboarding later from Settings (per the "never show again once dismissed" decision) — if a user wants to adopt entries after skipping, the existing per-row Adopt button in the main Hosts list still works, unchanged.
- No editing of hostname/IP/comment from within the checklist — adopted entries come in exactly as they appear in the hosts file, same as single adopt; editing after the fact uses the normal Edit panel.
- No progress/streaming UI for the batch write — it's one write, expected to be fast even for a large hosts file (the existing 10k-line parse/render benchmark already covers that cost).
