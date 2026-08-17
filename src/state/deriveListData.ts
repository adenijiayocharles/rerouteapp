import type { Conflict, Entry, UnmanagedEntry } from "../types";

export interface GroupSummary {
  name: string;
  count: number;
}

function matchesSearch(haystack: { hostname: string; comment: string }, search: string): boolean {
  if (!search) return true;
  return haystack.hostname.toLowerCase().includes(search) || (haystack.comment || "").toLowerCase().includes(search);
}

/** The list view's visible entries: group-filtered, search-filtered, then
 * optionally sorted by hostname. */
export function filterAndSortEntries(
  entries: Entry[],
  search: string,
  groupFilter: string | null,
  hostnameSort: "none" | "asc" | "desc",
): Entry[] {
  const normalizedSearch = search.trim().toLowerCase();
  const filtered = entries.filter((e) => {
    if (groupFilter && e.group !== groupFilter) return false;
    return matchesSearch(e, normalizedSearch);
  });
  if (hostnameSort === "none") return filtered;
  const direction = hostnameSort === "asc" ? 1 : -1;
  return [...filtered].sort((a, b) => direction * a.hostname.localeCompare(b.hostname));
}

/** Every entry in the active group filter, unaffected by the search box —
 * distinct from `filterAndSortEntries` because SwitchIpModal must show the
 * same set switch_group_active_ip is about to switch (which matches by
 * group alone), not the search-narrowed list view. */
export function entriesInGroup(entries: Entry[], groupFilter: string | null): Entry[] {
  return groupFilter ? entries.filter((e) => e.group === groupFilter) : [];
}

export function filterUnmanagedEntries(entries: UnmanagedEntry[], search: string): UnmanagedEntry[] {
  const normalizedSearch = search.trim().toLowerCase();
  if (!normalizedSearch) return entries;
  return entries.filter((e) => matchesSearch(e, normalizedSearch));
}

/** Which hostname(s) each entry is in conflict over, keyed by entry id. */
export function buildConflictsByEntry(conflicts: Conflict[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const conflict of conflicts) {
    for (const member of conflict.members) {
      const hostnames = map.get(member.entryId) ?? [];
      hostnames.push(conflict.hostname);
      map.set(member.entryId, hostnames);
    }
  }
  return map;
}

export function summarizeGroups(entries: Entry[]): GroupSummary[] {
  const names = Array.from(new Set(entries.filter((e) => e.group).map((e) => e.group))).sort();
  return names.map((name) => ({ name, count: entries.filter((e) => e.group === name).length }));
}
