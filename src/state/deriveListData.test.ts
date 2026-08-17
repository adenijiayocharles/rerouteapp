import { describe, expect, it } from "vitest";
import {
  buildConflictsByEntry,
  entriesInGroup,
  filterAndSortEntries,
  filterUnmanagedEntries,
  summarizeGroups,
} from "./deriveListData";
import type { Conflict, Entry, UnmanagedEntry } from "../types";

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

describe("filterAndSortEntries", () => {
  const entries = [
    makeEntry({ id: "1", hostname: "zeta.local", group: "Work" }),
    makeEntry({ id: "2", hostname: "alpha.local", group: "Work" }),
    makeEntry({ id: "3", hostname: "beta.local", group: "Home" }),
  ];

  it("filters by group when a group filter is set", () => {
    const result = filterAndSortEntries(entries, "", "Work", "none");
    expect(result.map((e) => e.id)).toEqual(["1", "2"]);
  });

  it("filters by hostname/comment search, case-insensitively", () => {
    const result = filterAndSortEntries(entries, "ALPHA", null, "none");
    expect(result.map((e) => e.id)).toEqual(["2"]);
  });

  it("combines group and search filters", () => {
    const result = filterAndSortEntries(entries, "beta", "Work", "none");
    expect(result).toEqual([]);
  });

  it("sorts ascending or descending by hostname without mutating the input", () => {
    const asc = filterAndSortEntries(entries, "", null, "asc");
    expect(asc.map((e) => e.hostname)).toEqual(["alpha.local", "beta.local", "zeta.local"]);
    const desc = filterAndSortEntries(entries, "", null, "desc");
    expect(desc.map((e) => e.hostname)).toEqual(["zeta.local", "beta.local", "alpha.local"]);
    expect(entries.map((e) => e.hostname)).toEqual(["zeta.local", "alpha.local", "beta.local"]);
  });
});

describe("entriesInGroup", () => {
  it("returns an empty array when no group filter is active", () => {
    expect(entriesInGroup([makeEntry()], null)).toEqual([]);
  });

  it("ignores the search box — only filters by group", () => {
    const entries = [makeEntry({ id: "1", group: "Work" }), makeEntry({ id: "2", group: "Work" })];
    expect(entriesInGroup(entries, "Work").map((e) => e.id)).toEqual(["1", "2"]);
  });
});

describe("filterUnmanagedEntries", () => {
  function makeUnmanaged(overrides: Partial<UnmanagedEntry> = {}): UnmanagedEntry {
    return { id: "u1", ip: "10.0.0.1", hostname: "api.local", comment: "", ...overrides };
  }

  it("returns everything when the search is empty", () => {
    const entries = [makeUnmanaged()];
    expect(filterUnmanagedEntries(entries, "")).toBe(entries);
  });

  it("filters by hostname or comment", () => {
    const entries = [makeUnmanaged({ id: "1", hostname: "api.local" }), makeUnmanaged({ id: "2", hostname: "web.local" })];
    expect(filterUnmanagedEntries(entries, "api").map((e) => e.id)).toEqual(["1"]);
  });
});

describe("buildConflictsByEntry", () => {
  it("groups conflict hostnames by every member entry id", () => {
    const conflicts: Conflict[] = [
      {
        hostname: "api.local",
        members: [
          { entryId: "e1", hostname: "api.local", ip: "10.0.0.1" },
          { entryId: "e2", hostname: "api.local", ip: "10.0.0.2" },
        ],
      },
    ];
    const map = buildConflictsByEntry(conflicts);
    expect(map.get("e1")).toEqual(["api.local"]);
    expect(map.get("e2")).toEqual(["api.local"]);
  });
});

describe("summarizeGroups", () => {
  it("returns unique, sorted group names with entry counts, skipping ungrouped entries", () => {
    const entries = [
      makeEntry({ group: "Work" }),
      makeEntry({ group: "Work" }),
      makeEntry({ group: "Home" }),
      makeEntry({ group: "" }),
    ];
    expect(summarizeGroups(entries)).toEqual([
      { name: "Home", count: 1 },
      { name: "Work", count: 2 },
    ]);
  });
});
