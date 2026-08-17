import { useCallback, type Dispatch } from "react";
import { api } from "../api";
import { errorMessage } from "../errorMessage";
import type { Action, State } from "../state/appReducer";
import type { EntryDraft } from "../types";
import type { DataRefresh } from "./useDataRefresh";

/** The hosts-file write pipeline: every handler that eventually calls a
 * `confirm_*`/`switch_*`/`flush_dns` backend command and then reconciles
 * entries/history/toast in response. Kept as one hook rather than split
 * further — `performConfirmSave` and the diff modal's pending-action
 * branches share enough state and sequencing (preview → `SHOW_DIFF` →
 * confirm) that separating them would mean threading the same pending*
 * fields through multiple hooks instead of one.
 *
 * Takes the whole `State` (like `useDerivedListData` does) rather than a
 * long positional-parameter list — several of these fields are same-typed
 * (`string | null`), so individual params would let a future call-site
 * argument reorder compile silently instead of failing a property lookup. */
export function useEntryWriteFlow(dispatch: Dispatch<Action>, state: State, refresh: DataRefresh) {
  const { editingDraft, savingDraft, confirmBeforeSave, diff, confirmingDiff, pendingDraft, pendingRestoreId, pendingDeleteId, pendingAdoptId, pendingRawSave } = state;

  const handleReload = useCallback(async () => {
    dispatch({ type: "DISMISS_EXTERNAL_CHANGE" });
    try {
      await refresh.refreshEntries();
      await refresh.refreshUnmanagedEntries();
      await refresh.refreshHistory();
      await refresh.refreshRawFile();
      dispatch({ type: "SET_TOAST", toast: { type: "success", title: "Reloaded", message: "Loaded the latest hosts file." } });
    } catch (err) {
      dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Reload failed", message: errorMessage(err) } });
    }
  }, [dispatch, refresh.refreshEntries, refresh.refreshUnmanagedEntries, refresh.refreshHistory, refresh.refreshRawFile]);

  const performConfirmSave = useCallback(
    async (draft: EntryDraft, isNew: boolean) => {
      const result = await api.confirmSave(draft);
      if (result.entry) dispatch({ type: "UPSERT_ENTRY", entry: result.entry });
      // A save can propagate a newly-added IP to other entries in the same
      // group (see the group-propagation notice in the preview modal), which
      // UPSERT_ENTRY above doesn't cover since it only touches the entry that
      // was actually edited.
      await refresh.refreshEntries();
      await refresh.refreshHistory();
      refresh.refreshHelperStatus().catch(() => {});
      if (result.flushOk === false || (result.flushOk === null && result.flushMessage)) {
        dispatch({
          type: "SET_TOAST",
          toast: { type: "error", title: "DNS flush failed", message: result.flushMessage ?? "The DNS cache could not be flushed.", retryFlush: true },
        });
      } else if (result.conflictWarning) {
        dispatch({
          type: "SET_TOAST",
          toast: { type: "warning", title: isNew ? "Entry added" : "Entry saved", message: result.conflictWarning },
        });
      } else {
        dispatch({
          type: "SET_TOAST",
          toast: {
            type: "success",
            title: isNew ? "Entry added" : "Entry saved",
            message: `${result.entry?.hostname ?? ""} has been written to the hosts file.`,
          },
        });
      }
    },
    [dispatch, refresh.refreshEntries, refresh.refreshHistory, refresh.refreshHelperStatus],
  );

  const handleRequestSave = useCallback(async () => {
    const draft = editingDraft;
    if (!draft || savingDraft) return;

    dispatch({ type: "SET_SAVING_DRAFT", saving: true });
    try {
      // New entries save immediately with no review step, unless the
      // hostname is a well-known system domain (then fall through to the
      // usual preview/diff confirmation so that warning still gets shown)
      // or the user has turned on "always confirm before saving".
      if (draft.id === null && !confirmBeforeSave) {
        try {
          const isShadow = await api.isShadowDomain(draft.hostname);
          if (isShadow) {
            const previewedDiff = await api.previewSave(draft);
            dispatch({ type: "SHOW_DIFF", diff: previewedDiff, pendingDraft: draft, pendingRestoreId: null, pendingDeleteId: null, pendingAdoptId: null, pendingRawSave: null });
            return;
          }
          await performConfirmSave(draft, true);
          dispatch({ type: "CLOSE_DRAFT" });
        } catch (err) {
          dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Failed to save entry", message: errorMessage(err) } });
        }
        return;
      }

      try {
        const previewedDiff = await api.previewSave(draft);
        dispatch({ type: "SHOW_DIFF", diff: previewedDiff, pendingDraft: draft, pendingRestoreId: null, pendingDeleteId: null, pendingAdoptId: null, pendingRawSave: null });
      } catch (err) {
        dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Couldn't preview changes", message: errorMessage(err) } });
      }
    } finally {
      dispatch({ type: "SET_SAVING_DRAFT", saving: false });
    }
  }, [editingDraft, savingDraft, confirmBeforeSave, dispatch, performConfirmSave]);

  const handleViewHistoryDiff = useCallback(
    async (id: string) => {
      try {
        const previewedDiff = await api.historyDiff(id);
        dispatch({ type: "SHOW_DIFF", diff: previewedDiff, pendingDraft: null, pendingRestoreId: null, pendingDeleteId: null, pendingAdoptId: null, pendingRawSave: null });
      } catch (err) {
        dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Couldn't load diff", message: errorMessage(err) } });
      }
    },
    [dispatch],
  );

  const handleRequestRestore = useCallback(
    async (id: string) => {
      try {
        const previewedDiff = await api.previewRestore(id);
        dispatch({ type: "SHOW_DIFF", diff: previewedDiff, pendingDraft: null, pendingRestoreId: id, pendingDeleteId: null, pendingAdoptId: null, pendingRawSave: null });
      } catch (err) {
        dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Couldn't preview restore", message: errorMessage(err) } });
      }
    },
    [dispatch],
  );

  const handleRequestDelete = useCallback(
    async (entryId: string) => {
      try {
        const previewedDiff = await api.previewDelete(entryId);
        dispatch({ type: "SHOW_DIFF", diff: previewedDiff, pendingDraft: null, pendingRestoreId: null, pendingDeleteId: entryId, pendingAdoptId: null, pendingRawSave: null });
      } catch (err) {
        dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Couldn't preview delete", message: errorMessage(err) } });
      }
    },
    [dispatch],
  );

  const handleRequestAdopt = useCallback(
    async (id: string) => {
      try {
        const previewedDiff = await api.previewAdopt(id);
        dispatch({ type: "SHOW_DIFF", diff: previewedDiff, pendingDraft: null, pendingRestoreId: null, pendingDeleteId: null, pendingAdoptId: id, pendingRawSave: null });
      } catch (err) {
        dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Couldn't preview adopt", message: errorMessage(err) } });
      }
    },
    [dispatch],
  );

  const handleAdoptSelected = useCallback(
    async (ids: string[]) => {
      const entries = await api.confirmAdoptMany(ids);
      dispatch({ type: "HIDE_ONBOARDING" });
      dispatch({ type: "SET_ENTRIES", entries });
      await refresh.refreshUnmanagedEntries();
      await refresh.refreshHistory();
      refresh.refreshHelperStatus().catch(() => {});
      dispatch({
        type: "SET_TOAST",
        toast: { type: "success", title: "Entries adopted", message: `${ids.length} ${ids.length === 1 ? "entry is" : "entries are"} now managed by re:route.` },
      });
    },
    [dispatch, refresh.refreshUnmanagedEntries, refresh.refreshHistory, refresh.refreshHelperStatus],
  );

  const handleRenameGroup = useCallback(
    async (oldName: string, newName: string) => {
      const trimmed = newName.trim();
      if (!trimmed || trimmed === oldName) return;
      try {
        const entries = await api.renameGroup(oldName, trimmed);
        dispatch({ type: "RENAME_GROUP_FILTER", oldName, newName: trimmed });
        dispatch({ type: "SET_ENTRIES", entries });
      } catch (err) {
        dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Couldn't rename group", message: errorMessage(err) } });
      }
    },
    [dispatch],
  );

  const handleSkipOnboarding = useCallback(() => {
    dispatch({ type: "HIDE_ONBOARDING" });
  }, [dispatch]);

  const handleRequestRawSave = useCallback(
    async (content: string) => {
      try {
        const previewedDiff = await api.previewRawSave(content);
        dispatch({ type: "SHOW_DIFF", diff: previewedDiff, pendingDraft: null, pendingRestoreId: null, pendingDeleteId: null, pendingAdoptId: null, pendingRawSave: content });
      } catch (err) {
        dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Couldn't preview changes", message: errorMessage(err) } });
      }
    },
    [dispatch],
  );

  const handleConfirmDiff = useCallback(async () => {
    if (!diff || confirmingDiff) return;
    dispatch({ type: "SET_CONFIRMING_DIFF", confirming: true });
    try {
      if (diff.mode === "save" && pendingDraft) {
        await performConfirmSave(pendingDraft, diff.isNew);
        dispatch({ type: "CLOSE_DIFF_AND_DRAFT" });
      } else if (diff.mode === "adopt" && pendingAdoptId) {
        const adopted = await api.confirmAdopt(pendingAdoptId);
        for (const entry of adopted) dispatch({ type: "UPSERT_ENTRY", entry });
        dispatch({ type: "CLOSE_DIFF" });
        await refresh.refreshUnmanagedEntries();
        await refresh.refreshHistory();
        refresh.refreshHelperStatus().catch(() => {});
        dispatch({
          type: "SET_TOAST",
          toast: {
            type: "success",
            title: adopted.length === 1 ? "Entry adopted" : "Entries adopted",
            message:
              adopted.length === 1
                ? `${adopted[0]?.hostname ?? "The entry"} is now managed by re:route.`
                : `${adopted.length} entries are now managed by re:route.`,
          },
        });
      } else if (diff.mode === "restore" && pendingRestoreId) {
        const result = await api.confirmRestore(pendingRestoreId);
        if (diff.isRemoval) {
          if (diff.restoreTargetId) dispatch({ type: "REMOVE_ENTRY", id: diff.restoreTargetId });
        } else if (result.entry) {
          dispatch({ type: "UPSERT_ENTRY", entry: result.entry });
        }
        dispatch({ type: "CLOSE_DIFF" });
        await refresh.refreshHistory();
        refresh.refreshHelperStatus().catch(() => {});
        dispatch({ type: "SET_TOAST", toast: { type: "success", title: "Restored", message: "Previous version has been written to the hosts file." } });
      } else if (diff.mode === "delete" && pendingDeleteId) {
        const hostname = diff.historyBefore?.hostname ?? "The entry";
        await api.confirmDelete(pendingDeleteId);
        dispatch({ type: "REMOVE_ENTRY", id: pendingDeleteId });
        dispatch({ type: "CLOSE_DIFF_AND_DRAFT" });
        await refresh.refreshHistory();
        refresh.refreshHelperStatus().catch(() => {});
        dispatch({ type: "SET_TOAST", toast: { type: "success", title: "Entry deleted", message: `${hostname} has been removed from the hosts file.` } });
      } else if (diff.mode === "raw" && pendingRawSave !== null) {
        await api.confirmRawSave(pendingRawSave);
        dispatch({ type: "SET_RAW_FILE_CONTENT", content: pendingRawSave });
        dispatch({ type: "CLOSE_DIFF" });
        await refresh.refreshEntries();
        await refresh.refreshUnmanagedEntries();
        await refresh.refreshHistory();
        refresh.refreshHelperStatus().catch(() => {});
        dispatch({ type: "SET_TOAST", toast: { type: "success", title: "Hosts file saved", message: "Your changes have been written to the hosts file." } });
      } else {
        dispatch({ type: "CLOSE_DIFF" });
      }
    } catch (err) {
      dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Write failed", message: errorMessage(err) } });
    } finally {
      dispatch({ type: "SET_CONFIRMING_DIFF", confirming: false });
    }
  }, [
    diff,
    confirmingDiff,
    pendingDraft,
    pendingRestoreId,
    pendingDeleteId,
    pendingAdoptId,
    pendingRawSave,
    dispatch,
    performConfirmSave,
    refresh.refreshUnmanagedEntries,
    refresh.refreshHistory,
    refresh.refreshHelperStatus,
    refresh.refreshEntries,
  ]);

  const handleSwitchIp = useCallback(
    async (entryId: string, ipId: string) => {
      dispatch({ type: "CLOSE_IP_MENU" });
      dispatch({ type: "SET_FLUSHING", id: entryId });
      try {
        const result = await api.switchActiveIp(entryId, ipId);
        if (result.entry) dispatch({ type: "UPSERT_ENTRY", entry: result.entry });
        dispatch({ type: "CLEAR_IP_UNREACHABLE", entryId });
        dispatch({ type: "SET_FLUSHING", id: null });
        await refresh.refreshHistory();
        refresh.refreshConflicts().catch(() => {});
        refresh.refreshHelperStatus().catch(() => {});
        const ip = result.entry?.ips.find((i) => i.id === ipId);
        if (result.flushOk === false || (result.flushOk === null && result.flushMessage)) {
          dispatch({
            type: "SET_TOAST",
            toast: { type: "error", title: "DNS flush failed", message: result.flushMessage ?? "The DNS cache could not be flushed.", retryFlush: true },
          });
        } else if (result.conflictWarning) {
          dispatch({
            type: "SET_TOAST",
            toast: { type: "warning", title: "IP switched", message: result.conflictWarning },
          });
        } else {
          dispatch({
            type: "SET_TOAST",
            toast: { type: "success", title: "IP switched", message: `${result.entry?.hostname} → ${ip?.ip} · DNS cache flushed` },
          });
        }
      } catch (err) {
        dispatch({ type: "SET_FLUSHING", id: null });
        dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Failed to switch IP", message: errorMessage(err) } });
      }
    },
    [dispatch, refresh.refreshHistory, refresh.refreshConflicts, refresh.refreshHelperStatus],
  );

  const handleSwitchGroupIp = useCallback(
    async (group: string, ip: string) => {
      dispatch({ type: "CLOSE_SWITCH_IP_MODAL" });
      try {
        const result = await api.switchGroupActiveIp(group, ip);
        dispatch({ type: "UPSERT_ENTRIES", entries: result.entries });
        for (const entry of result.entries) dispatch({ type: "CLEAR_IP_UNREACHABLE", entryId: entry.id });
        await refresh.refreshHistory();
        refresh.refreshConflicts().catch(() => {});
        refresh.refreshHelperStatus().catch(() => {});
        const count = result.entries.length;
        const entryWord = count === 1 ? "entry" : "entries";
        if (result.flushOk === false || (result.flushOk === null && result.flushMessage)) {
          dispatch({
            type: "SET_TOAST",
            toast: { type: "error", title: "DNS flush failed", message: result.flushMessage ?? "The DNS cache could not be flushed.", retryFlush: true },
          });
        } else if (result.conflictWarning) {
          dispatch({
            type: "SET_TOAST",
            toast: { type: "warning", title: "IP switched", message: result.conflictWarning },
          });
        } else {
          dispatch({
            type: "SET_TOAST",
            toast: { type: "success", title: "IP switched", message: `${count} ${entryWord} in "${group}" → ${ip} · DNS cache flushed` },
          });
        }
      } catch (err) {
        dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Failed to switch IP", message: errorMessage(err) } });
      }
    },
    [dispatch, refresh.refreshHistory, refresh.refreshConflicts, refresh.refreshHelperStatus],
  );

  const handleToggleEnabled = useCallback(
    async (entryId: string) => {
      try {
        const result = await api.toggleEnabled(entryId);
        if (result.entry) dispatch({ type: "UPSERT_ENTRY", entry: result.entry });
        await refresh.refreshHistory();
        refresh.refreshConflicts().catch(() => {});
        refresh.refreshHelperStatus().catch(() => {});
        if (result.entry && result.conflictWarning) {
          dispatch({
            type: "SET_TOAST",
            toast: {
              type: "warning",
              title: result.entry.enabled ? "Entry enabled" : "Entry disabled",
              message: result.conflictWarning,
            },
          });
        } else if (result.entry) {
          dispatch({
            type: "SET_TOAST",
            toast: {
              type: "success",
              title: result.entry.enabled ? "Entry enabled" : "Entry disabled",
              message: `${result.entry.hostname} ${result.entry.enabled ? "is now active in the hosts file." : "has been commented out."}`,
            },
          });
        }
      } catch (err) {
        dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Failed to update entry", message: errorMessage(err) } });
      }
    },
    [dispatch, refresh.refreshHistory, refresh.refreshConflicts, refresh.refreshHelperStatus],
  );

  const handleFlushDns = useCallback(async () => {
    dispatch({ type: "SET_TOAST", toast: { type: "info", title: "Flushing DNS…", message: "Flushing the local DNS resolver cache." } });
    try {
      const result = await api.flushDns();
      dispatch({
        type: "SET_TOAST",
        toast: {
          type: result.flushOk ? "success" : "error",
          title: result.flushOk ? "DNS flush succeeded" : "DNS flush failed",
          message: result.flushMessage ?? "DNS cache flushed successfully.",
          retryFlush: !result.flushOk,
        },
      });
    } catch (err) {
      dispatch({ type: "SET_TOAST", toast: { type: "error", title: "DNS flush failed", message: errorMessage(err), retryFlush: true } });
    }
  }, [dispatch]);

  return {
    handleReload,
    handleRequestSave,
    handleViewHistoryDiff,
    handleRequestRestore,
    handleRequestDelete,
    handleRequestAdopt,
    handleAdoptSelected,
    handleRenameGroup,
    handleSkipOnboarding,
    handleRequestRawSave,
    handleConfirmDiff,
    handleSwitchIp,
    handleSwitchGroupIp,
    handleToggleEnabled,
    handleFlushDns,
  };
}
