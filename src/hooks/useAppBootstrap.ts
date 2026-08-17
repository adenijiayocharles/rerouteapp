import { useEffect, type Dispatch } from "react";
import { api } from "../api";
import { errorMessage } from "../errorMessage";
import type { DataRefresh } from "./useDataRefresh";
import type { Action } from "../state/appReducer";

/** Populates state from the backend on first mount: entries, history,
 * unmanaged entries, onboarding eligibility, helper status, and every
 * Settings-page preference. Deliberately a single once-only effect rather
 * than one per settings hook — these reads are independent of each other,
 * so splitting them up would just scatter one "load the app" concern
 * across several files for no behavioral benefit. */
export function useAppBootstrap(dispatch: Dispatch<Action>, refresh: DataRefresh, handleCheckForUpdates: (manual: boolean) => Promise<void>) {
  useEffect(() => {
    async function checkOnboarding() {
      try {
        const seen = await api.getSetting("onboarding_seen");
        if (seen === "true") return;
        const [entries, unmanaged] = await Promise.all([api.listEntries(), api.listUnmanagedEntries()]);
        if (entries.length === 0 && unmanaged.length > 0) {
          dispatch({ type: "SHOW_ONBOARDING", entries: unmanaged });
        }
        await api.setSetting("onboarding_seen", "true");
      } catch {
        // Onboarding is best-effort — if it can't be determined this launch, just skip it.
      }
    }

    refresh.refreshEntries().catch((err) =>
      dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Failed to load entries", message: errorMessage(err) } }),
    );
    refresh.refreshUnmanagedEntries().catch(() => {});
    checkOnboarding();
    refresh.refreshHistory().catch(() => {});
    refresh.refreshHelperStatus().catch(() => {});
    api
      .helperSupportedOnThisPlatform()
      .then((supported) => dispatch({ type: "SET_HELPER_SUPPORTED", supported }))
      .catch(() => {});
    refresh.refreshRawFile().catch(() => {});
    api.getHelperEnabled().then((enabled) => dispatch({ type: "SET_HELPER_ENABLED", enabled })).catch(() => {});
    api.getLaunchAtLogin().then((enabled) => dispatch({ type: "SET_LAUNCH_AT_LOGIN", enabled })).catch(() => {});
    api.getAutoFlushDns().then((enabled) => dispatch({ type: "SET_AUTO_FLUSH_DNS", enabled })).catch(() => {});
    api.getConfirmBeforeSave().then((enabled) => dispatch({ type: "SET_CONFIRM_BEFORE_SAVE", enabled })).catch(() => {});
    api.getPropagateGroupIps().then((enabled) => dispatch({ type: "SET_PROPAGATE_GROUP_IPS", enabled })).catch(() => {});
    api
      .getUnmanagedListCollapsed()
      .then((collapsed) => dispatch({ type: "SET_UNMANAGED_LIST_COLLAPSED", collapsed }))
      .catch(() => {});
    api.getHistoryRetention().then((value) => dispatch({ type: "SET_HISTORY_RETENTION", value })).catch(() => {});
    api.getAppVersion().then((version) => dispatch({ type: "SET_APP_VERSION", version })).catch(() => {});
    api.getAutoCheckUpdates().then((enabled) => {
      dispatch({ type: "SET_AUTO_CHECK_UPDATES", enabled });
      if (enabled) handleCheckForUpdates(false);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only: intentionally runs once, not on every identity change of refresh/handleCheckForUpdates.
  }, []);
}
