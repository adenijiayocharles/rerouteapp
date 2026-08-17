import { useCallback, useEffect, useRef, type Dispatch } from "react";
import { api } from "../api";
import type { Action } from "../state/appReducer";
import type { Entry } from "../types";

/** Re-fetches for each backend-backed slice of state, plus a ref mirror of
 * the current entries array for effects that need the latest value without
 * re-subscribing (e.g. the ip-health-checked listener). Centralized here
 * since nearly every write flow needs to refresh one or more of these after
 * a successful `invoke()`. */
export function useDataRefresh(dispatch: Dispatch<Action>, entries: Entry[]) {
  const entriesRef = useRef<Entry[]>(entries);
  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  const refreshEntries = useCallback(async () => {
    const [entries, conflicts] = await Promise.all([api.listEntries(), api.listConflicts()]);
    dispatch({ type: "SET_ENTRIES", entries });
    dispatch({ type: "SET_CONFLICTS", conflicts });
  }, [dispatch]);

  const refreshConflicts = useCallback(async () => {
    const conflicts = await api.listConflicts();
    dispatch({ type: "SET_CONFLICTS", conflicts });
  }, [dispatch]);

  const refreshUnmanagedEntries = useCallback(async () => {
    const entries = await api.listUnmanagedEntries();
    dispatch({ type: "SET_UNMANAGED_ENTRIES", entries });
  }, [dispatch]);

  const refreshHistory = useCallback(async () => {
    const history = await api.getHistory();
    dispatch({ type: "SET_HISTORY", history });
  }, [dispatch]);

  const refreshHelperStatus = useCallback(async () => {
    const active = await api.helperStatus();
    dispatch({ type: "SET_HELPER_ACTIVE", active });
  }, [dispatch]);

  const refreshRawFile = useCallback(async () => {
    const content = await api.readHostsFile();
    dispatch({ type: "SET_RAW_FILE_CONTENT", content });
  }, [dispatch]);

  return {
    refreshEntries,
    refreshConflicts,
    refreshUnmanagedEntries,
    refreshHistory,
    refreshHelperStatus,
    refreshRawFile,
    entriesRef,
  };
}

export type DataRefresh = ReturnType<typeof useDataRefresh>;
