import { useCallback, type Dispatch } from "react";
import { api } from "../api";
import { errorMessage } from "../errorMessage";
import type { Action } from "../state/appReducer";
import type { HistoryRetention } from "../types";

/** Handlers for every SettingsModal toggle: persist to the backend, then
 * mirror the change into state (rolling back optimistic UI on failure). */
export function useSettingsSync(
  dispatch: Dispatch<Action>,
  helperActive: boolean,
  unmanagedListCollapsed: boolean,
  refreshHelperStatus: () => Promise<void>,
) {
  const handleSetHelperEnabled = useCallback(
    async (enabled: boolean) => {
      try {
        if (!enabled && helperActive) {
          await api.uninstallHelper();
        }
        await api.setHelperEnabled(enabled);
        dispatch({ type: "SET_HELPER_ENABLED", enabled });
        await refreshHelperStatus();
        dispatch({
          type: "SET_TOAST",
          toast: enabled
            ? { type: "success", title: "Background helper enabled", message: "It will be installed on the next write." }
            : { type: "success", title: "Background helper disabled", message: "The next write will prompt for your password." },
        });
      } catch (err) {
        dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Couldn't update the background helper", message: errorMessage(err) } });
      }
    },
    [dispatch, helperActive, refreshHelperStatus],
  );

  const handleSetLaunchAtLogin = useCallback(
    async (enabled: boolean) => {
      try {
        await api.setLaunchAtLogin(enabled);
        dispatch({ type: "SET_LAUNCH_AT_LOGIN", enabled });
      } catch (err) {
        dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Couldn't update launch at login", message: errorMessage(err) } });
      }
    },
    [dispatch],
  );

  const handleSetAutoFlushDns = useCallback(
    async (enabled: boolean) => {
      try {
        await api.setAutoFlushDns(enabled);
        dispatch({ type: "SET_AUTO_FLUSH_DNS", enabled });
      } catch (err) {
        dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Couldn't update DNS auto-flush", message: errorMessage(err) } });
      }
    },
    [dispatch],
  );

  const handleSetConfirmBeforeSave = useCallback(
    async (enabled: boolean) => {
      try {
        await api.setConfirmBeforeSave(enabled);
        dispatch({ type: "SET_CONFIRM_BEFORE_SAVE", enabled });
      } catch (err) {
        dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Couldn't update save confirmation", message: errorMessage(err) } });
      }
    },
    [dispatch],
  );

  const handleSetPropagateGroupIps = useCallback(
    async (enabled: boolean) => {
      try {
        await api.setPropagateGroupIps(enabled);
        dispatch({ type: "SET_PROPAGATE_GROUP_IPS", enabled });
      } catch (err) {
        dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Couldn't update group IP propagation", message: errorMessage(err) } });
      }
    },
    [dispatch],
  );

  const handleToggleUnmanagedCollapsed = useCallback(async () => {
    const collapsed = !unmanagedListCollapsed;
    // Optimistic: this is a lightweight display preference, not worth
    // blocking the toggle's visual response on a round-trip.
    dispatch({ type: "SET_UNMANAGED_LIST_COLLAPSED", collapsed });
    try {
      await api.setUnmanagedListCollapsed(collapsed);
    } catch (err) {
      dispatch({ type: "SET_UNMANAGED_LIST_COLLAPSED", collapsed: !collapsed });
      dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Couldn't save that preference", message: errorMessage(err) } });
    }
  }, [dispatch, unmanagedListCollapsed]);

  const handleSetHistoryRetention = useCallback(
    async (value: HistoryRetention) => {
      try {
        await api.setHistoryRetention(value);
        dispatch({ type: "SET_HISTORY_RETENTION", value });
      } catch (err) {
        dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Couldn't update history retention", message: errorMessage(err) } });
      }
    },
    [dispatch],
  );

  const handleSetAutoCheckUpdates = useCallback(
    async (enabled: boolean) => {
      try {
        await api.setAutoCheckUpdates(enabled);
        dispatch({ type: "SET_AUTO_CHECK_UPDATES", enabled });
      } catch (err) {
        dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Couldn't update auto-check setting", message: errorMessage(err) } });
      }
    },
    [dispatch],
  );

  return {
    handleSetHelperEnabled,
    handleSetLaunchAtLogin,
    handleSetAutoFlushDns,
    handleSetConfirmBeforeSave,
    handleSetPropagateGroupIps,
    handleToggleUnmanagedCollapsed,
    handleSetHistoryRetention,
    handleSetAutoCheckUpdates,
  };
}
