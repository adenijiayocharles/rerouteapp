import { useMemo } from "react";
import type { State } from "../state/appReducer";
import {
  buildConflictsByEntry,
  entriesInGroup,
  filterAndSortEntries,
  filterUnmanagedEntries,
  summarizeGroups,
} from "../state/deriveListData";

/** Thin useMemo wrapper around the pure filter/sort/group functions in
 * `state/deriveListData.ts` — kept separate from them so that logic stays
 * unit-testable without React. */
export function useDerivedListData(state: State) {
  const filteredEntries = useMemo(
    () => filterAndSortEntries(state.entries, state.search, state.groupFilter, state.hostnameSort),
    [state.entries, state.search, state.groupFilter, state.hostnameSort],
  );

  const groupEntries = useMemo(
    () => entriesInGroup(state.entries, state.groupFilter),
    [state.entries, state.groupFilter],
  );

  const filteredUnmanagedEntries = useMemo(
    () => filterUnmanagedEntries(state.unmanagedEntries, state.search),
    [state.unmanagedEntries, state.search],
  );

  const conflictsByEntry = useMemo(() => buildConflictsByEntry(state.conflicts), [state.conflicts]);

  const groups = useMemo(() => summarizeGroups(state.entries), [state.entries]);

  return { filteredEntries, groupEntries, filteredUnmanagedEntries, conflictsByEntry, groups };
}
