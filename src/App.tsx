import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import type { Update } from "@tauri-apps/plugin-updater";
import "./App.css";
import { api } from "./api";
import { colorsFor, type Theme, type ThemePreference } from "./theme";
import { createInitialState, reducer, type State, type UpdateStatus } from "./state/appReducer";
import type { Entry, EntryDraft, HistoryRetention, IpHealthResult } from "./types";
import { TitleBar } from "./components/TitleBar";
import { Sidebar } from "./components/Sidebar";
import { ListView } from "./components/ListView";
import { HistoryView } from "./components/HistoryView";
import { RawEditorView } from "./components/RawEditorView";
import { DraftPanel } from "./components/DraftPanel";
import { DiffModal } from "./components/DiffModal";
import { Toast } from "./components/Toast";
import { ReloadBanner } from "./components/ReloadBanner";
import { SettingsModal } from "./components/SettingsModal";
import { SwitchIpModal } from "./components/SwitchIpModal";
import { DoctorModal } from "./components/DoctorModal";
import { OnboardingModal } from "./components/OnboardingModal";

const HOSTS_CHANGED_EVENT = "hosts-file-changed-externally";
const ENTRIES_CHANGED_EVENT = "entries-changed";
const IP_HEALTH_CHECKED_EVENT = "ip-health-checked";
const MENU_ACTION_EVENT = "menu-action";
const THEME_STORAGE_KEY = "reroute-theme";
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

function loadStoredThemePreference(): ThemePreference {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
}

function systemPrefersDarkNow(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

const initialState: State = createInitialState({
  themePreference: loadStoredThemePreference(),
  systemPrefersDark: systemPrefersDarkNow(),
});

function errorMessage(err: unknown): string {
  return typeof err === "string" ? err : err instanceof Error ? err.message : "Something went wrong.";
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const pendingUpdateRef = useRef<Update | null>(null);
  const updateStatusRef = useRef<UpdateStatus>(state.updateStatus);
  useEffect(() => {
    updateStatusRef.current = state.updateStatus;
  }, [state.updateStatus]);
  const entriesRef = useRef<Entry[]>(state.entries);
  useEffect(() => {
    entriesRef.current = state.entries;
  }, [state.entries]);
  const theme: Theme =
    state.themePreference === "system" ? (state.systemPrefersDark ? "dark" : "light") : state.themePreference;
  const c = colorsFor(theme);

  async function refreshEntries() {
    const [entries, conflicts] = await Promise.all([api.listEntries(), api.listConflicts()]);
    dispatch({ type: "SET_ENTRIES", entries });
    dispatch({ type: "SET_CONFLICTS", conflicts });
  }

  async function refreshConflicts() {
    const conflicts = await api.listConflicts();
    dispatch({ type: "SET_CONFLICTS", conflicts });
  }

  async function refreshUnmanagedEntries() {
    const entries = await api.listUnmanagedEntries();
    dispatch({ type: "SET_UNMANAGED_ENTRIES", entries });
  }

  async function refreshHistory() {
    const history = await api.getHistory();
    dispatch({ type: "SET_HISTORY", history });
  }

  async function refreshHelperStatus() {
    const active = await api.helperStatus();
    dispatch({ type: "SET_HELPER_ACTIVE", active });
  }

  async function refreshRawFile() {
    const content = await api.readHostsFile();
    dispatch({ type: "SET_RAW_FILE_CONTENT", content });
  }

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

  useEffect(() => {
    refreshEntries().catch((err) =>
      dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Failed to load entries", message: errorMessage(err) } }),
    );
    refreshUnmanagedEntries().catch(() => {});
    checkOnboarding();
    refreshHistory().catch(() => {});
    refreshHelperStatus().catch(() => {});
    api
      .helperSupportedOnThisPlatform()
      .then((supported) => dispatch({ type: "SET_HELPER_SUPPORTED", supported }))
      .catch(() => {});
    refreshRawFile().catch(() => {});
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
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      // Skip a tick that lands while the window is hidden/minimized rather
      // than firing an update check nobody can see the result of yet — the
      // next tick (or the next time the window becomes visible) covers it.
      if (state.autoCheckUpdates && updateStatusRef.current === "idle" && document.visibilityState === "visible") {
        handleCheckForUpdates(false);
      }
    }, UPDATE_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [state.autoCheckUpdates]);

  async function handleSetHelperEnabled(enabled: boolean) {
    try {
      if (!enabled && state.helperActive) {
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
  }

  async function handleSetLaunchAtLogin(enabled: boolean) {
    try {
      await api.setLaunchAtLogin(enabled);
      dispatch({ type: "SET_LAUNCH_AT_LOGIN", enabled });
    } catch (err) {
      dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Couldn't update launch at login", message: errorMessage(err) } });
    }
  }

  async function handleSetAutoFlushDns(enabled: boolean) {
    try {
      await api.setAutoFlushDns(enabled);
      dispatch({ type: "SET_AUTO_FLUSH_DNS", enabled });
    } catch (err) {
      dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Couldn't update DNS auto-flush", message: errorMessage(err) } });
    }
  }

  async function handleSetConfirmBeforeSave(enabled: boolean) {
    try {
      await api.setConfirmBeforeSave(enabled);
      dispatch({ type: "SET_CONFIRM_BEFORE_SAVE", enabled });
    } catch (err) {
      dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Couldn't update save confirmation", message: errorMessage(err) } });
    }
  }

  async function handleSetPropagateGroupIps(enabled: boolean) {
    try {
      await api.setPropagateGroupIps(enabled);
      dispatch({ type: "SET_PROPAGATE_GROUP_IPS", enabled });
    } catch (err) {
      dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Couldn't update group IP propagation", message: errorMessage(err) } });
    }
  }

  async function handleToggleUnmanagedCollapsed() {
    const collapsed = !state.unmanagedListCollapsed;
    // Optimistic: this is a lightweight display preference, not worth
    // blocking the toggle's visual response on a round-trip.
    dispatch({ type: "SET_UNMANAGED_LIST_COLLAPSED", collapsed });
    try {
      await api.setUnmanagedListCollapsed(collapsed);
    } catch (err) {
      dispatch({ type: "SET_UNMANAGED_LIST_COLLAPSED", collapsed: !collapsed });
      dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Couldn't save that preference", message: errorMessage(err) } });
    }
  }

  async function handleSetHistoryRetention(value: HistoryRetention) {
    try {
      await api.setHistoryRetention(value);
      dispatch({ type: "SET_HISTORY_RETENTION", value });
    } catch (err) {
      dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Couldn't update history retention", message: errorMessage(err) } });
    }
  }

  async function handleSetAutoCheckUpdates(enabled: boolean) {
    try {
      await api.setAutoCheckUpdates(enabled);
      dispatch({ type: "SET_AUTO_CHECK_UPDATES", enabled });
    } catch (err) {
      dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Couldn't update auto-check setting", message: errorMessage(err) } });
    }
  }

  async function handleInstallUpdate() {
    const update = pendingUpdateRef.current;
    if (!update) return;
    try {
      await update.install();
      await api.relaunchApp();
    } catch (err) {
      dispatch({ type: "SET_UPDATE_STATUS", status: "error" });
      dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Update install failed", message: errorMessage(err) } });
    }
  }

  async function handleDownloadUpdate() {
    const update = pendingUpdateRef.current;
    if (!update) return;
    dispatch({ type: "SET_UPDATE_STATUS", status: "downloading", progress: 0 });

    let contentLength = 0;
    let downloaded = 0;
    // Progress events fire once per network chunk (potentially hundreds of
    // times for a multi-MB installer); only dispatch when the rounded
    // percentage actually changes instead of on every chunk, since every
    // dispatch re-renders the whole app under the single top-level reducer.
    let lastDispatchedProgress: number | null = 0;
    try {
      await update.download((event) => {
        if (event.event === "Started") {
          contentLength = event.data.contentLength ?? 0;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          const progress = contentLength > 0 ? Math.min(100, Math.round((downloaded / contentLength) * 100)) : null;
          if (progress === lastDispatchedProgress) return;
          lastDispatchedProgress = progress;
          dispatch({ type: "SET_UPDATE_STATUS", status: "downloading", progress });
          dispatch({
            type: "SET_TOAST",
            toast: {
              type: "info",
              title: "Update available",
              message: progress !== null ? `Downloading re:route v${update.version}… ${progress}%` : `Downloading re:route v${update.version}…`,
            },
          });
        }
      });
      dispatch({ type: "SET_UPDATE_STATUS", status: "ready", version: update.version });
      dispatch({
        type: "SET_TOAST",
        toast: {
          type: "info",
          title: "Update ready",
          message: `Restart re:route to finish installing v${update.version}.`,
          updateAction: { label: "Restart", onClick: handleInstallUpdate },
        },
      });
    } catch (err) {
      dispatch({ type: "SET_UPDATE_STATUS", status: "error" });
      dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Update download failed", message: errorMessage(err) } });
    }
  }

  async function handleCheckForUpdates(manual: boolean) {
    if (manual) dispatch({ type: "SET_UPDATE_STATUS", status: "checking" });
    try {
      const update = await api.checkForUpdate();
      if (!update) {
        if (manual) {
          dispatch({
            type: "SET_TOAST",
            toast: {
              type: "success",
              title: "You're up to date",
              message: state.appVersion ? `re:route v${state.appVersion} is the latest version.` : "You have the latest version.",
            },
          });
        }
        dispatch({ type: "SET_UPDATE_STATUS", status: "idle" });
        return;
      }
      pendingUpdateRef.current = update;
      dispatch({ type: "SET_UPDATE_STATUS", status: "available", version: update.version });
      dispatch({
        type: "SET_TOAST",
        toast: {
          type: "info",
          title: "Update available",
          message: `re:route v${update.version} is ready to download.`,
          updateAction: { label: "Download", onClick: handleDownloadUpdate },
        },
      });
    } catch (err) {
      if (manual) {
        dispatch({ type: "SET_UPDATE_STATUS", status: "idle" });
        dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Couldn't check for updates", message: errorMessage(err) } });
      }
    }
  }

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen(HOSTS_CHANGED_EVENT, () => dispatch({ type: "EXTERNAL_CHANGE_DETECTED" })).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    // Entries can change from the menu bar tray (switching an entry's
    // active IP) without any invoke() call originating from this window,
    // so pick those changes up here instead of relying on each caller to
    // refresh.
    let unlisten: (() => void) | undefined;
    listen(ENTRIES_CHANGED_EVENT, () => {
      refreshEntries().catch(() => {});
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    // Fired by the backend a moment after a successful IP switch, once its
    // background ping resolves (see `switch_active_ip`/`ping.rs`) — never
    // blocks the switch itself, just warns after the fact if the newly
    // active IP didn't respond.
    let unlisten: (() => void) | undefined;
    listen<IpHealthResult>(IP_HEALTH_CHECKED_EVENT, (event) => {
      const { entryId, ipId, reachable } = event.payload;
      if (reachable) return;
      dispatch({ type: "SET_IP_UNREACHABLE", entryId, ipId });
      const entry = entriesRef.current.find((e) => e.id === entryId);
      if (!entry || entry.activeIpId !== ipId) return; // switched again before this landed
      const ip = entry.ips.find((i) => i.id === ipId);
      dispatch({
        type: "SET_TOAST",
        toast: {
          type: "warning",
          title: "IP unreachable",
          message: `${entry.hostname} now points to ${ip?.ip ?? ipId}, but it didn't respond to a ping.`,
        },
      });
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    // The native File menu mirrors a handful of in-app actions so they're
    // reachable without the window already being focused on the right view.
    let unlisten: (() => void) | undefined;
    listen<string>(MENU_ACTION_EVENT, (event) => {
      switch (event.payload) {
        case "add-entry":
          dispatch({ type: "OPEN_ADD_PANEL" });
          break;
        case "flush-dns":
          handleFlushDns();
          break;
        case "open-raw-file":
          dispatch({ type: "GO_RAW" });
          refreshRawFile().catch(() => {});
          break;
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    localStorage.setItem(THEME_STORAGE_KEY, state.themePreference);
  }, [state.themePreference]);

  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (e: MediaQueryListEvent) => dispatch({ type: "SET_SYSTEM_PREFERS_DARK", prefersDark: e.matches });
    mql.addEventListener("change", handleChange);
    return () => mql.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    if (!state.toast) return;
    if (state.toast.type === "info") return;
    const timer = setTimeout(() => dispatch({ type: "SET_TOAST", toast: null }), 4200);
    return () => clearTimeout(timer);
  }, [state.toast]);

  const filteredEntries = useMemo(() => {
    const search = state.search.trim().toLowerCase();
    const filtered = state.entries.filter((e) => {
      if (state.groupFilter && e.group !== state.groupFilter) return false;
      if (!search) return true;
      return e.hostname.toLowerCase().includes(search) || (e.comment || "").toLowerCase().includes(search);
    });
    if (state.hostnameSort === "none") return filtered;
    const direction = state.hostnameSort === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => direction * a.hostname.localeCompare(b.hostname));
  }, [state.entries, state.search, state.groupFilter, state.hostnameSort]);

  // Entries in the active group filter, unaffected by the search box — the
  // backend's switch_group_active_ip matches by group alone, so SwitchIpModal
  // must show the same set it's about to switch rather than filteredEntries,
  // which also excludes hostnames the search box currently hides.
  const groupEntries = useMemo(
    () => (state.groupFilter ? state.entries.filter((e) => e.group === state.groupFilter) : []),
    [state.entries, state.groupFilter],
  );

  const filteredUnmanagedEntries = useMemo(() => {
    const search = state.search.trim().toLowerCase();
    if (!search) return state.unmanagedEntries;
    return state.unmanagedEntries.filter(
      (e) => e.hostname.toLowerCase().includes(search) || (e.comment || "").toLowerCase().includes(search),
    );
  }, [state.unmanagedEntries, state.search]);

  // Which hostname(s) each entry is in conflict over, keyed by entry id —
  // built once per conflicts refresh rather than re-scanned per row.
  const conflictsByEntry = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const conflict of state.conflicts) {
      for (const member of conflict.members) {
        const hostnames = map.get(member.entryId) ?? [];
        hostnames.push(conflict.hostname);
        map.set(member.entryId, hostnames);
      }
    }
    return map;
  }, [state.conflicts]);

  const groups = useMemo(() => {
    const names = Array.from(new Set(state.entries.filter((e) => e.group).map((e) => e.group))).sort();
    return names.map((name) => ({ name, count: state.entries.filter((e) => e.group === name).length }));
  }, [state.entries]);

  async function handleReload() {
    dispatch({ type: "DISMISS_EXTERNAL_CHANGE" });
    try {
      await refreshEntries();
      await refreshUnmanagedEntries();
      await refreshHistory();
      await refreshRawFile();
      dispatch({ type: "SET_TOAST", toast: { type: "success", title: "Reloaded", message: "Loaded the latest hosts file." } });
    } catch (err) {
      dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Reload failed", message: errorMessage(err) } });
    }
  }

  async function performConfirmSave(draft: EntryDraft, isNew: boolean) {
    const result = await api.confirmSave(draft);
    if (result.entry) dispatch({ type: "UPSERT_ENTRY", entry: result.entry });
    // A save can propagate a newly-added IP to other entries in the same
    // group (see the group-propagation notice in the preview modal), which
    // UPSERT_ENTRY above doesn't cover since it only touches the entry that
    // was actually edited.
    await refreshEntries();
    await refreshHistory();
    refreshHelperStatus().catch(() => {});
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
  }

  async function handleRequestSave() {
    const draft = state.editingDraft;
    if (!draft || state.savingDraft) return;

    dispatch({ type: "SET_SAVING_DRAFT", saving: true });
    try {
      // New entries save immediately with no review step, unless the
      // hostname is a well-known system domain (then fall through to the
      // usual preview/diff confirmation so that warning still gets shown)
      // or the user has turned on "always confirm before saving".
      if (draft.id === null && !state.confirmBeforeSave) {
        try {
          const isShadow = await api.isShadowDomain(draft.hostname);
          if (isShadow) {
            const diff = await api.previewSave(draft);
            dispatch({ type: "SHOW_DIFF", diff, pendingDraft: draft, pendingRestoreId: null, pendingDeleteId: null, pendingAdoptId: null, pendingRawSave: null });
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
        const diff = await api.previewSave(draft);
        dispatch({ type: "SHOW_DIFF", diff, pendingDraft: draft, pendingRestoreId: null, pendingDeleteId: null, pendingAdoptId: null, pendingRawSave: null });
      } catch (err) {
        dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Couldn't preview changes", message: errorMessage(err) } });
      }
    } finally {
      dispatch({ type: "SET_SAVING_DRAFT", saving: false });
    }
  }

  async function handleViewHistoryDiff(id: string) {
    try {
      const diff = await api.historyDiff(id);
      dispatch({ type: "SHOW_DIFF", diff, pendingDraft: null, pendingRestoreId: null, pendingDeleteId: null, pendingAdoptId: null, pendingRawSave: null });
    } catch (err) {
      dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Couldn't load diff", message: errorMessage(err) } });
    }
  }

  async function handleRequestRestore(id: string) {
    try {
      const diff = await api.previewRestore(id);
      dispatch({ type: "SHOW_DIFF", diff, pendingDraft: null, pendingRestoreId: id, pendingDeleteId: null, pendingAdoptId: null, pendingRawSave: null });
    } catch (err) {
      dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Couldn't preview restore", message: errorMessage(err) } });
    }
  }

  async function handleRequestDelete(entryId: string) {
    try {
      const diff = await api.previewDelete(entryId);
      dispatch({ type: "SHOW_DIFF", diff, pendingDraft: null, pendingRestoreId: null, pendingDeleteId: entryId, pendingAdoptId: null, pendingRawSave: null });
    } catch (err) {
      dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Couldn't preview delete", message: errorMessage(err) } });
    }
  }

  const handleRequestAdopt = useCallback(async (id: string) => {
    try {
      const diff = await api.previewAdopt(id);
      dispatch({ type: "SHOW_DIFF", diff, pendingDraft: null, pendingRestoreId: null, pendingDeleteId: null, pendingAdoptId: id, pendingRawSave: null });
    } catch (err) {
      dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Couldn't preview adopt", message: errorMessage(err) } });
    }
  }, []);

  async function handleAdoptSelected(ids: string[]) {
    const entries = await api.confirmAdoptMany(ids);
    dispatch({ type: "HIDE_ONBOARDING" });
    dispatch({ type: "SET_ENTRIES", entries });
    await refreshUnmanagedEntries();
    await refreshHistory();
    refreshHelperStatus().catch(() => {});
    dispatch({
      type: "SET_TOAST",
      toast: { type: "success", title: "Entries adopted", message: `${ids.length} ${ids.length === 1 ? "entry is" : "entries are"} now managed by re:route.` },
    });
  }

  async function handleRenameGroup(oldName: string, newName: string) {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) return;
    try {
      const entries = await api.renameGroup(oldName, trimmed);
      dispatch({ type: "RENAME_GROUP_FILTER", oldName, newName: trimmed });
      dispatch({ type: "SET_ENTRIES", entries });
    } catch (err) {
      dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Couldn't rename group", message: errorMessage(err) } });
    }
  }

  function handleSkipOnboarding() {
    dispatch({ type: "HIDE_ONBOARDING" });
  }

  async function handleRequestRawSave(content: string) {
    try {
      const diff = await api.previewRawSave(content);
      dispatch({ type: "SHOW_DIFF", diff, pendingDraft: null, pendingRestoreId: null, pendingDeleteId: null, pendingAdoptId: null, pendingRawSave: content });
    } catch (err) {
      dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Couldn't preview changes", message: errorMessage(err) } });
    }
  }

  async function handleConfirmDiff() {
    const { diff, pendingDraft, pendingRestoreId, pendingDeleteId, pendingAdoptId, pendingRawSave } = state;
    if (!diff || state.confirmingDiff) return;
    dispatch({ type: "SET_CONFIRMING_DIFF", confirming: true });
    try {
      if (diff.mode === "save" && pendingDraft) {
        await performConfirmSave(pendingDraft, diff.isNew);
        dispatch({ type: "CLOSE_DIFF_AND_DRAFT" });
      } else if (diff.mode === "adopt" && pendingAdoptId) {
        const adopted = await api.confirmAdopt(pendingAdoptId);
        for (const entry of adopted) dispatch({ type: "UPSERT_ENTRY", entry });
        dispatch({ type: "CLOSE_DIFF" });
        await refreshUnmanagedEntries();
        await refreshHistory();
        refreshHelperStatus().catch(() => {});
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
        await refreshHistory();
        refreshHelperStatus().catch(() => {});
        dispatch({ type: "SET_TOAST", toast: { type: "success", title: "Restored", message: "Previous version has been written to the hosts file." } });
      } else if (diff.mode === "delete" && pendingDeleteId) {
        const hostname = diff.historyBefore?.hostname ?? "The entry";
        await api.confirmDelete(pendingDeleteId);
        dispatch({ type: "REMOVE_ENTRY", id: pendingDeleteId });
        dispatch({ type: "CLOSE_DIFF_AND_DRAFT" });
        await refreshHistory();
        refreshHelperStatus().catch(() => {});
        dispatch({ type: "SET_TOAST", toast: { type: "success", title: "Entry deleted", message: `${hostname} has been removed from the hosts file.` } });
      } else if (diff.mode === "raw" && pendingRawSave !== null) {
        await api.confirmRawSave(pendingRawSave);
        dispatch({ type: "SET_RAW_FILE_CONTENT", content: pendingRawSave });
        dispatch({ type: "CLOSE_DIFF" });
        await refreshEntries();
        await refreshUnmanagedEntries();
        await refreshHistory();
        refreshHelperStatus().catch(() => {});
        dispatch({ type: "SET_TOAST", toast: { type: "success", title: "Hosts file saved", message: "Your changes have been written to the hosts file." } });
      } else {
        dispatch({ type: "CLOSE_DIFF" });
      }
    } catch (err) {
      dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Write failed", message: errorMessage(err) } });
    } finally {
      dispatch({ type: "SET_CONFIRMING_DIFF", confirming: false });
    }
  }

  const handleSwitchIp = useCallback(async (entryId: string, ipId: string) => {
    dispatch({ type: "CLOSE_IP_MENU" });
    dispatch({ type: "SET_FLUSHING", id: entryId });
    try {
      const result = await api.switchActiveIp(entryId, ipId);
      if (result.entry) dispatch({ type: "UPSERT_ENTRY", entry: result.entry });
      dispatch({ type: "CLEAR_IP_UNREACHABLE", entryId });
      dispatch({ type: "SET_FLUSHING", id: null });
      await refreshHistory();
      refreshConflicts().catch(() => {});
      refreshHelperStatus().catch(() => {});
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
  }, []);

  const handleSwitchGroupIp = useCallback(async (group: string, ip: string) => {
    dispatch({ type: "CLOSE_SWITCH_IP_MODAL" });
    try {
      const result = await api.switchGroupActiveIp(group, ip);
      dispatch({ type: "UPSERT_ENTRIES", entries: result.entries });
      for (const entry of result.entries) dispatch({ type: "CLEAR_IP_UNREACHABLE", entryId: entry.id });
      await refreshHistory();
      refreshConflicts().catch(() => {});
      refreshHelperStatus().catch(() => {});
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
  }, []);

  const handleToggleEnabled = useCallback(async (entryId: string) => {
    try {
      const result = await api.toggleEnabled(entryId);
      if (result.entry) dispatch({ type: "UPSERT_ENTRY", entry: result.entry });
      await refreshHistory();
      refreshConflicts().catch(() => {});
      refreshHelperStatus().catch(() => {});
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
  }, []);

  async function handleFlushDns() {
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
  }

  // Stable references so ListView's memoized EntryRow/UnmanagedRow children
  // don't re-render (and re-subscribe their effects) on every unrelated
  // App re-render — see EntryRow.tsx.
  const handleSearchChange = useCallback((value: string) => dispatch({ type: "SET_SEARCH", value }), []);
  const handleToggleHostnameSort = useCallback(() => dispatch({ type: "TOGGLE_HOSTNAME_SORT" }), []);
  const handleOpenAddPanel = useCallback(() => dispatch({ type: "OPEN_ADD_PANEL" }), []);
  const handleClearGroupFilter = useCallback(() => dispatch({ type: "CLEAR_GROUP_FILTER" }), []);
  const handleOpenSwitchIpModal = useCallback(() => dispatch({ type: "OPEN_SWITCH_IP_MODAL" }), []);
  const handleToggleIpMenu = useCallback((id: string) => dispatch({ type: "TOGGLE_IP_MENU", id }), []);
  const handleOpenEditPanel = useCallback((entry: Entry) => dispatch({ type: "OPEN_EDIT_PANEL", entry }), []);
  const handleDeleteFromRow = useCallback((entryId: string) => handleRequestDelete(entryId), []);

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: c.bg,
        color: c.text,
        fontFamily: "'Space Grotesk',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
        fontSize: 14,
        transition: "background .25s ease",
        position: "relative",
        overflow: "hidden",
        // @ts-expect-error custom property for scrollbar thumb color
        "--hm-scroll-thumb": c.scrollThumb,
      }}
    >
      <TitleBar
        c={c}
        version={state.appVersion}
        onFlushDns={handleFlushDns}
        onOpenSettings={() => dispatch({ type: "OPEN_SETTINGS" })}
        onOpenDoctor={() => dispatch({ type: "OPEN_DOCTOR" })}
      />

      {state.externalChangeDetected && (
        <ReloadBanner c={c} onReload={handleReload} onDismiss={() => dispatch({ type: "DISMISS_EXTERNAL_CHANGE" })} />
      )}

      <div style={{ flex: 1, display: "flex", overflow: "hidden", position: "relative" }}>
        <Sidebar
          c={c}
          view={state.view}
          onGoList={() => dispatch({ type: "GO_LIST" })}
          onGoHistory={() => dispatch({ type: "GO_HISTORY" })}
          onGoRaw={() => {
            dispatch({ type: "GO_RAW" });
            refreshRawFile().catch(() => {});
          }}
          entryCount={state.entries.length}
          groups={groups}
          groupFilter={state.groupFilter}
          onSelectGroup={(g) => dispatch({ type: "SELECT_GROUP", group: g })}
          onRenameGroup={handleRenameGroup}
        />

        {state.view === "list" ? (
          <ListView
            c={c}
            entries={filteredEntries}
            totalEntryCount={state.entries.length}
            conflictsByEntry={conflictsByEntry}
            unreachableIps={state.unreachableIps}
            unmanagedEntries={state.groupFilter ? [] : filteredUnmanagedEntries}
            search={state.search}
            onSearchChange={handleSearchChange}
            hostnameSort={state.hostnameSort}
            onToggleHostnameSort={handleToggleHostnameSort}
            onAddClick={handleOpenAddPanel}
            groupFilter={state.groupFilter}
            onClearGroupFilter={handleClearGroupFilter}
            onOpenSwitchIpModal={handleOpenSwitchIpModal}
            openIpMenuId={state.openIpMenuId}
            flushingId={state.flushingId}
            disabled={state.externalChangeDetected}
            onToggleDropdown={handleToggleIpMenu}
            onToggleEnabled={handleToggleEnabled}
            onEdit={handleOpenEditPanel}
            onDelete={handleDeleteFromRow}
            onSwitchIp={handleSwitchIp}
            onAdopt={handleRequestAdopt}
            unmanagedCollapsed={state.unmanagedListCollapsed}
            onToggleUnmanagedCollapsed={handleToggleUnmanagedCollapsed}
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
      </div>

      {state.editingDraft && (
        <DraftPanel
          c={c}
          theme={theme}
          draft={state.editingDraft}
          saving={state.savingDraft}
          onClose={() => dispatch({ type: "CLOSE_DRAFT" })}
          onFieldChange={(field, value) => dispatch({ type: "UPDATE_DRAFT_FIELD", field, value })}
          onIpFieldChange={(uid, field, value) => dispatch({ type: "UPDATE_DRAFT_IP", uid, field, value })}
          onAddIpRow={() => dispatch({ type: "ADD_DRAFT_IP_ROW" })}
          onRemoveIpRow={(uid) => dispatch({ type: "REMOVE_DRAFT_IP_ROW", uid })}
          onSetActive={(uid) => dispatch({ type: "SET_DRAFT_ACTIVE", uid })}
          onToggleEnabled={() => dispatch({ type: "TOGGLE_DRAFT_ENABLED" })}
          onSave={handleRequestSave}
          onDelete={() => {
            if (state.editingDraft?.id) handleRequestDelete(state.editingDraft.id);
          }}
        />
      )}

      {state.diff && (
        <DiffModal
          key={state.diff.title + state.diff.subtitle}
          c={c}
          diff={state.diff}
          confirming={state.confirmingDiff}
          onCancel={() => dispatch({ type: "CLOSE_DIFF" })}
          onConfirm={handleConfirmDiff}
        />
      )}

      {state.switchIpOpen && state.groupFilter && (
        <SwitchIpModal
          c={c}
          groupName={state.groupFilter}
          entries={groupEntries}
          onCancel={() => dispatch({ type: "CLOSE_SWITCH_IP_MODAL" })}
          onSwitchIp={handleSwitchGroupIp}
        />
      )}

      {state.settingsOpen && (
        <SettingsModal
          c={c}
          helperEnabled={state.helperEnabled}
          helperActive={state.helperActive}
          helperSupported={state.helperSupported}
          launchAtLogin={state.launchAtLogin}
          autoFlushDns={state.autoFlushDns}
          confirmBeforeSave={state.confirmBeforeSave}
          propagateGroupIps={state.propagateGroupIps}
          themePreference={state.themePreference}
          historyRetention={state.historyRetention}
          appVersion={state.appVersion}
          autoCheckUpdates={state.autoCheckUpdates}
          checkingForUpdates={state.updateStatus === "checking"}
          onClose={() => dispatch({ type: "CLOSE_SETTINGS" })}
          onSetThemePreference={(preference) => dispatch({ type: "SET_THEME_PREFERENCE", preference })}
          onSetHelperEnabled={handleSetHelperEnabled}
          onSetLaunchAtLogin={handleSetLaunchAtLogin}
          onSetAutoFlushDns={handleSetAutoFlushDns}
          onSetConfirmBeforeSave={handleSetConfirmBeforeSave}
          onSetPropagateGroupIps={handleSetPropagateGroupIps}
          onSetHistoryRetention={handleSetHistoryRetention}
          onSetAutoCheckUpdates={handleSetAutoCheckUpdates}
          onCheckForUpdatesNow={() => handleCheckForUpdates(true)}
        />
      )}

      {state.doctorOpen && (
        <DoctorModal c={c} onClose={() => dispatch({ type: "CLOSE_DOCTOR" })} runDiagnostics={api.runDiagnostics} />
      )}

      {state.toast && (
        <Toast
          c={c}
          toast={state.toast}
          onDismiss={() => dispatch({ type: "SET_TOAST", toast: null })}
          onRetryFlush={handleFlushDns}
        />
      )}

      {state.showOnboarding && (
        <OnboardingModal c={c} entries={state.onboardingEntries} onAdopt={handleAdoptSelected} onSkip={handleSkipOnboarding} />
      )}
    </div>
  );
}
