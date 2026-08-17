import { describe, expect, it } from "vitest";
import { createInitialState, mergeEntries, reducer, type Action, type State } from "./appReducer";
import type { Entry } from "../types";

function baseState(overrides: Partial<State> = {}): State {
  return { ...createInitialState({ themePreference: "system", systemPrefersDark: false }), ...overrides };
}

function makeEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: "e1",
    hostname: "api.local",
    comment: "",
    group: "",
    enabled: true,
    activeIpId: "ip1",
    ips: [{ id: "ip1", label: "primary", ip: "10.0.0.1" }],
    lastModified: "Just now",
    ...overrides,
  };
}

describe("mergeEntries", () => {
  it("keeps the previous object reference for entries whose content is unchanged", () => {
    const prev = [makeEntry()];
    const next = [makeEntry()]; // structurally identical, but a distinct object
    const merged = mergeEntries(prev, next);
    expect(merged[0]).toBe(prev[0]);
  });

  it("adopts the new object when an entry's content changed", () => {
    const prev = [makeEntry({ hostname: "old.local" })];
    const next = [makeEntry({ hostname: "new.local" })];
    const merged = mergeEntries(prev, next);
    expect(merged[0]).toBe(next[0]);
    expect(merged[0].hostname).toBe("new.local");
  });

  it("includes entries with no previous counterpart", () => {
    const merged = mergeEntries([], [makeEntry()]);
    expect(merged).toHaveLength(1);
  });
});

describe("reducer: entries", () => {
  it("SET_ENTRIES merges via mergeEntries rather than replacing wholesale", () => {
    const existing = makeEntry();
    const state = baseState({ entries: [existing] });
    const next = reducer(state, { type: "SET_ENTRIES", entries: [makeEntry()] });
    expect(next.entries[0]).toBe(existing);
  });

  it("UPSERT_ENTRY appends when the entry id is new", () => {
    const state = baseState({ entries: [] });
    const next = reducer(state, { type: "UPSERT_ENTRY", entry: makeEntry() });
    expect(next.entries).toHaveLength(1);
  });

  it("UPSERT_ENTRY replaces the matching entry in place", () => {
    const state = baseState({ entries: [makeEntry({ hostname: "old.local" })] });
    const next = reducer(state, { type: "UPSERT_ENTRY", entry: makeEntry({ hostname: "new.local" }) });
    expect(next.entries).toHaveLength(1);
    expect(next.entries[0].hostname).toBe("new.local");
  });

  it("UPSERT_ENTRIES updates existing entries and appends ones that weren't present", () => {
    const state = baseState({ entries: [makeEntry({ id: "e1", hostname: "old.local" })] });
    const next = reducer(state, {
      type: "UPSERT_ENTRIES",
      entries: [makeEntry({ id: "e1", hostname: "new.local" }), makeEntry({ id: "e2", hostname: "second.local" })],
    });
    expect(next.entries.map((e) => e.id)).toEqual(["e1", "e2"]);
    expect(next.entries[0].hostname).toBe("new.local");
  });

  it("REMOVE_ENTRY drops only the matching entry", () => {
    const state = baseState({ entries: [makeEntry({ id: "e1" }), makeEntry({ id: "e2" })] });
    const next = reducer(state, { type: "REMOVE_ENTRY", id: "e1" });
    expect(next.entries.map((e) => e.id)).toEqual(["e2"]);
  });
});

describe("reducer: group filter", () => {
  it("SELECT_GROUP sets the filter and switches to the list view", () => {
    const state = baseState({ view: "history" });
    const next = reducer(state, { type: "SELECT_GROUP", group: "Work" });
    expect(next).toMatchObject({ view: "list", groupFilter: "Work" });
  });

  it("CLEAR_GROUP_FILTER resets the filter", () => {
    const state = baseState({ groupFilter: "Work" });
    expect(reducer(state, { type: "CLEAR_GROUP_FILTER" }).groupFilter).toBeNull();
  });

  it("RENAME_GROUP_FILTER only updates when it matches the active filter", () => {
    const state = baseState({ groupFilter: "Work" });
    expect(reducer(state, { type: "RENAME_GROUP_FILTER", oldName: "Work", newName: "Office" }).groupFilter).toBe("Office");
    expect(reducer(state, { type: "RENAME_GROUP_FILTER", oldName: "Elsewhere", newName: "Office" }).groupFilter).toBe("Work");
  });

  it("switching views or groups closes the switch-IP modal, so it can't survive on top of the wrong screen", () => {
    const open = baseState({ groupFilter: "Work", switchIpOpen: true });
    expect(reducer(open, { type: "GO_HISTORY" }).switchIpOpen).toBe(false);
    expect(reducer(open, { type: "GO_RAW" }).switchIpOpen).toBe(false);
    expect(reducer(open, { type: "GO_LIST" }).switchIpOpen).toBe(false);
    expect(reducer(open, { type: "SELECT_GROUP", group: "Home" }).switchIpOpen).toBe(false);
    expect(reducer(open, { type: "CLEAR_GROUP_FILTER" }).switchIpOpen).toBe(false);
  });

  it("OPEN_ADD_PANEL seeds the new draft's group from the active group filter", () => {
    const state = baseState({ groupFilter: "Work" });
    const next = reducer(state, { type: "OPEN_ADD_PANEL" });
    expect(next.editingDraft?.group).toBe("Work");
  });
});

describe("reducer: UI toggles", () => {
  it("TOGGLE_HOSTNAME_SORT cycles none -> asc -> desc -> none", () => {
    let state = baseState({ hostnameSort: "none" });
    state = reducer(state, { type: "TOGGLE_HOSTNAME_SORT" });
    expect(state.hostnameSort).toBe("asc");
    state = reducer(state, { type: "TOGGLE_HOSTNAME_SORT" });
    expect(state.hostnameSort).toBe("desc");
    state = reducer(state, { type: "TOGGLE_HOSTNAME_SORT" });
    expect(state.hostnameSort).toBe("none");
  });

  it("TOGGLE_IP_MENU opens a closed menu and closes an already-open one for the same id", () => {
    const closed = baseState({ openIpMenuId: null });
    const opened = reducer(closed, { type: "TOGGLE_IP_MENU", id: "e1" });
    expect(opened.openIpMenuId).toBe("e1");
    const closedAgain = reducer(opened, { type: "TOGGLE_IP_MENU", id: "e1" });
    expect(closedAgain.openIpMenuId).toBeNull();
  });

  it("CLEAR_IP_UNREACHABLE is a no-op (same reference) when the id isn't flagged", () => {
    const state = baseState({ unreachableIps: {} });
    expect(reducer(state, { type: "CLEAR_IP_UNREACHABLE", entryId: "e1" })).toBe(state);
  });

  it("CLEAR_IP_UNREACHABLE removes only the matching id", () => {
    const state = baseState({ unreachableIps: { e1: "ip1", e2: "ip2" } });
    const next = reducer(state, { type: "CLEAR_IP_UNREACHABLE", entryId: "e1" });
    expect(next.unreachableIps).toEqual({ e2: "ip2" });
  });
});

describe("reducer: draft editing", () => {
  it("OPEN_EDIT_PANEL maps an entry's ip candidates into draft rows", () => {
    const state = baseState();
    const entry = makeEntry({ ips: [{ id: "ip1", label: "primary", ip: "10.0.0.1" }] });
    const next = reducer(state, { type: "OPEN_EDIT_PANEL", entry });
    expect(next.editingDraft).toMatchObject({
      id: entry.id,
      activeUid: entry.activeIpId,
      ips: [{ uid: "ip1", label: "primary", ip: "10.0.0.1" }],
    });
  });

  it("REMOVE_DRAFT_IP_ROW reassigns activeUid to the first remaining row when the active row is removed", () => {
    const state = baseState({
      editingDraft: {
        id: null,
        hostname: "api.local",
        comment: "",
        group: "",
        enabled: true,
        activeUid: "a",
        ips: [
          { uid: "a", label: "", ip: "10.0.0.1" },
          { uid: "b", label: "", ip: "10.0.0.2" },
        ],
      },
    });
    const next = reducer(state, { type: "REMOVE_DRAFT_IP_ROW", uid: "a" });
    expect(next.editingDraft?.ips.map((r) => r.uid)).toEqual(["b"]);
    expect(next.editingDraft?.activeUid).toBe("b");
  });
});

describe("reducer: diff modal", () => {
  const diff = { mode: "save" } as State["diff"];

  it("CLOSE_DIFF clears the diff and pending fields but leaves the draft panel open", () => {
    const state = baseState({
      diff,
      confirmingDiff: true,
      pendingDraft: { id: null, hostname: "", comment: "", group: "", enabled: true, activeUid: "", ips: [] },
      editingDraft: { id: null, hostname: "", comment: "", group: "", enabled: true, activeUid: "", ips: [] },
    });
    const next = reducer(state, { type: "CLOSE_DIFF" });
    expect(next.diff).toBeNull();
    expect(next.pendingDraft).toBeNull();
    expect(next.editingDraft).not.toBeNull();
  });

  it("CLOSE_DIFF_AND_DRAFT also closes the draft panel", () => {
    const state = baseState({
      diff,
      editingDraft: { id: null, hostname: "", comment: "", group: "", enabled: true, activeUid: "", ips: [] },
    });
    const next = reducer(state, { type: "CLOSE_DIFF_AND_DRAFT" });
    expect(next.diff).toBeNull();
    expect(next.editingDraft).toBeNull();
  });
});

describe("reducer: update status", () => {
  it("SET_UPDATE_STATUS only overwrites version/progress when explicitly provided", () => {
    const state = baseState({ updateStatus: "available", updateVersion: "1.2.3", updateProgress: null });
    const next = reducer(state, { type: "SET_UPDATE_STATUS", status: "downloading", progress: 42 });
    expect(next.updateVersion).toBe("1.2.3"); // untouched — no `version` key on this action
    expect(next.updateProgress).toBe(42);
  });
});

describe("reducer: unknown actions", () => {
  it("returns the same state reference for an action type it doesn't handle", () => {
    const state = baseState();
    const unknown = { type: "__NOT_A_REAL_ACTION__" } as unknown as Action;
    expect(reducer(state, unknown)).toBe(state);
  });
});
