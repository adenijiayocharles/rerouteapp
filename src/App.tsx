import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import type { Update } from "@tauri-apps/plugin-updater";
import "./App.css";
import { api } from "./api";
import { colorsFor, type Theme, type ThemePreference } from "./theme";
import type { DiffPreview, Entry, EntryDraft, HistoryEntry, HistoryRetention, ToastState, UnmanagedEntry } from "./types";
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
import { OnboardingModal } from "./components/OnboardingModal";

const HOSTS_CHANGED_EVENT = "hosts-file-changed-externally";
const ENTRIES_CHANGED_EVENT = "entries-changed";
const THEME_STORAGE_KEY = "reroute-theme";
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "ready" | "error";

function loadStoredThemePreference(): ThemePreference {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
}

function systemPrefersDarkNow(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

interface State {
  themePreference: ThemePreference;
  systemPrefersDark: boolean;
  view: "list" | "history" | "raw";
  search: string;
  groupFilter: string | null;
  entries: Entry[];
  unmanagedEntries: UnmanagedEntry[];
  showOnboarding: boolean;
  onboardingEntries: UnmanagedEntry[];
  history: HistoryEntry[];
  openIpMenuId: string | null;
  flushingId: string | null;
  editingDraft: EntryDraft | null;
  diff: DiffPreview | null;
  pendingDraft: EntryDraft | null;
  pendingRestoreId: string | null;
  pendingDeleteId: string | null;
  pendingAdoptId: string | null;
  pendingRawSave: string | null;
  rawFileContent: string | null;
  rawDraftContent: string | null;
  toast: ToastState | null;
  trayOpen: boolean;
  externalChangeDetected: boolean;
  helperActive: boolean;
  helperEnabled: boolean;
  settingsOpen: boolean;
  launchAtLogin: boolean;
  autoFlushDns: boolean;
  confirmBeforeSave: boolean;
  historyRetention: HistoryRetention;
  appVersion: string | null;
  autoCheckUpdates: boolean;
  updateStatus: UpdateStatus;
  updateVersion: string | null;
  updateProgress: number | null;
}

type Action =
  | { type: "SET_ENTRIES"; entries: Entry[] }
  | { type: "SET_UNMANAGED_ENTRIES"; entries: UnmanagedEntry[] }
  | { type: "SHOW_ONBOARDING"; entries: UnmanagedEntry[] }
  | { type: "HIDE_ONBOARDING" }
  | { type: "SET_HISTORY"; history: HistoryEntry[] }
  | { type: "SET_THEME_PREFERENCE"; preference: ThemePreference }
  | { type: "SET_SYSTEM_PREFERS_DARK"; prefersDark: boolean }
  | { type: "SET_HELPER_ACTIVE"; active: boolean }
  | { type: "SET_HELPER_ENABLED"; enabled: boolean }
  | { type: "SET_LAUNCH_AT_LOGIN"; enabled: boolean }
  | { type: "SET_AUTO_FLUSH_DNS"; enabled: boolean }
  | { type: "SET_CONFIRM_BEFORE_SAVE"; enabled: boolean }
  | { type: "SET_HISTORY_RETENTION"; value: HistoryRetention }
  | { type: "SET_APP_VERSION"; version: string }
  | { type: "SET_AUTO_CHECK_UPDATES"; enabled: boolean }
  | { type: "SET_UPDATE_STATUS"; status: UpdateStatus; version?: string | null; progress?: number | null }
  | { type: "OPEN_SETTINGS" }
  | { type: "CLOSE_SETTINGS" }
  | { type: "GO_LIST" }
  | { type: "GO_HISTORY" }
  | { type: "GO_RAW" }
  | { type: "SET_RAW_FILE_CONTENT"; content: string }
  | { type: "SET_RAW_DRAFT_CONTENT"; content: string }
  | { type: "SELECT_GROUP"; group: string }
  | { type: "CLEAR_GROUP_FILTER" }
  | { type: "SET_SEARCH"; value: string }
  | { type: "TOGGLE_IP_MENU"; id: string }
  | { type: "CLOSE_IP_MENU" }
  | { type: "TOGGLE_TRAY" }
  | { type: "CLOSE_TRAY" }
  | { type: "SET_FLUSHING"; id: string | null }
  | { type: "UPSERT_ENTRY"; entry: Entry }
  | { type: "REMOVE_ENTRY"; id: string }
  | { type: "OPEN_ADD_PANEL" }
  | { type: "OPEN_EDIT_PANEL"; entry: Entry }
  | { type: "CLOSE_DRAFT" }
  | { type: "UPDATE_DRAFT_FIELD"; field: "hostname" | "comment" | "group"; value: string }
  | { type: "UPDATE_DRAFT_IP"; uid: string; field: "label" | "ip"; value: string }
  | { type: "ADD_DRAFT_IP_ROW" }
  | { type: "REMOVE_DRAFT_IP_ROW"; uid: string }
  | { type: "SET_DRAFT_ACTIVE"; uid: string }
  | { type: "TOGGLE_DRAFT_ENABLED" }
  | {
      type: "SHOW_DIFF";
      diff: DiffPreview;
      pendingDraft: EntryDraft | null;
      pendingRestoreId: string | null;
      pendingDeleteId: string | null;
      pendingAdoptId: string | null;
      pendingRawSave: string | null;
    }
  | { type: "CLOSE_DIFF" }
  | { type: "CLOSE_DIFF_AND_DRAFT" }
  | { type: "SET_TOAST"; toast: ToastState | null }
  | { type: "EXTERNAL_CHANGE_DETECTED" }
  | { type: "DISMISS_EXTERNAL_CHANGE" };

const initialState: State = {
  themePreference: loadStoredThemePreference(),
  systemPrefersDark: systemPrefersDarkNow(),
  view: "list",
  search: "",
  groupFilter: null,
  entries: [],
  unmanagedEntries: [],
  showOnboarding: false,
  onboardingEntries: [],
  history: [],
  openIpMenuId: null,
  flushingId: null,
  editingDraft: null,
  diff: null,
  pendingDraft: null,
  pendingRestoreId: null,
  pendingDeleteId: null,
  pendingAdoptId: null,
  pendingRawSave: null,
  rawFileContent: null,
  rawDraftContent: null,
  toast: null,
  trayOpen: false,
  externalChangeDetected: false,
  helperActive: false,
  helperEnabled: true,
  settingsOpen: false,
  launchAtLogin: false,
  autoFlushDns: true,
  confirmBeforeSave: false,
  historyRetention: "200",
  appVersion: null,
  autoCheckUpdates: true,
  updateStatus: "idle",
  updateVersion: null,
  updateProgress: null,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "SET_ENTRIES":
      return { ...state, entries: action.entries };
    case "SET_UNMANAGED_ENTRIES":
      return { ...state, unmanagedEntries: action.entries };
    case "SHOW_ONBOARDING":
      return { ...state, showOnboarding: true, onboardingEntries: action.entries };
    case "HIDE_ONBOARDING":
      return { ...state, showOnboarding: false };
    case "SET_HISTORY":
      return { ...state, history: action.history };
    case "SET_HELPER_ACTIVE":
      return { ...state, helperActive: action.active };
    case "SET_HELPER_ENABLED":
      return { ...state, helperEnabled: action.enabled };
    case "SET_LAUNCH_AT_LOGIN":
      return { ...state, launchAtLogin: action.enabled };
    case "SET_AUTO_FLUSH_DNS":
      return { ...state, autoFlushDns: action.enabled };
    case "SET_CONFIRM_BEFORE_SAVE":
      return { ...state, confirmBeforeSave: action.enabled };
    case "SET_HISTORY_RETENTION":
      return { ...state, historyRetention: action.value };
    case "SET_APP_VERSION":
      return { ...state, appVersion: action.version };
    case "SET_AUTO_CHECK_UPDATES":
      return { ...state, autoCheckUpdates: action.enabled };
    case "SET_UPDATE_STATUS":
      return {
        ...state,
        updateStatus: action.status,
        updateVersion: action.version !== undefined ? action.version : state.updateVersion,
        updateProgress: action.progress !== undefined ? action.progress : state.updateProgress,
      };
    case "OPEN_SETTINGS":
      return { ...state, settingsOpen: true };
    case "CLOSE_SETTINGS":
      return { ...state, settingsOpen: false };
    case "SET_THEME_PREFERENCE":
      return { ...state, themePreference: action.preference };
    case "SET_SYSTEM_PREFERS_DARK":
      return { ...state, systemPrefersDark: action.prefersDark };
    case "GO_LIST":
      return { ...state, view: "list", trayOpen: false, groupFilter: null };
    case "GO_HISTORY":
      return { ...state, view: "history", trayOpen: false };
    case "GO_RAW":
      return { ...state, view: "raw", trayOpen: false };
    case "SET_RAW_FILE_CONTENT":
      return { ...state, rawFileContent: action.content, rawDraftContent: action.content };
    case "SET_RAW_DRAFT_CONTENT":
      return { ...state, rawDraftContent: action.content };
    case "SELECT_GROUP":
      return { ...state, view: "list", trayOpen: false, groupFilter: action.group };
    case "CLEAR_GROUP_FILTER":
      return { ...state, groupFilter: null };
    case "SET_SEARCH":
      return { ...state, search: action.value };
    case "TOGGLE_IP_MENU":
      return { ...state, openIpMenuId: state.openIpMenuId === action.id ? null : action.id };
    case "CLOSE_IP_MENU":
      return { ...state, openIpMenuId: null };
    case "TOGGLE_TRAY":
      return { ...state, trayOpen: !state.trayOpen };
    case "CLOSE_TRAY":
      return { ...state, trayOpen: false };
    case "SET_FLUSHING":
      return { ...state, flushingId: action.id };
    case "UPSERT_ENTRY": {
      const exists = state.entries.some((e) => e.id === action.entry.id);
      return {
        ...state,
        entries: exists
          ? state.entries.map((e) => (e.id === action.entry.id ? action.entry : e))
          : [...state.entries, action.entry],
      };
    }
    case "REMOVE_ENTRY":
      return { ...state, entries: state.entries.filter((e) => e.id !== action.id) };
    case "OPEN_ADD_PANEL": {
      const uid = crypto.randomUUID();
      return {
        ...state,
        editingDraft: {
          id: null,
          hostname: "",
          comment: "",
          group: state.groupFilter ?? "",
          enabled: true,
          activeUid: uid,
          ips: [{ uid, label: "", ip: "" }],
        },
      };
    }
    case "OPEN_EDIT_PANEL":
      return {
        ...state,
        editingDraft: {
          id: action.entry.id,
          hostname: action.entry.hostname,
          comment: action.entry.comment,
          group: action.entry.group,
          enabled: action.entry.enabled,
          activeUid: action.entry.activeIpId,
          ips: action.entry.ips.map((i) => ({ uid: i.id, label: i.label, ip: i.ip })),
        },
      };
    case "CLOSE_DRAFT":
      return { ...state, editingDraft: null };
    case "UPDATE_DRAFT_FIELD":
      if (!state.editingDraft) return state;
      return { ...state, editingDraft: { ...state.editingDraft, [action.field]: action.value } };
    case "UPDATE_DRAFT_IP":
      if (!state.editingDraft) return state;
      return {
        ...state,
        editingDraft: {
          ...state.editingDraft,
          ips: state.editingDraft.ips.map((r) => (r.uid === action.uid ? { ...r, [action.field]: action.value } : r)),
        },
      };
    case "ADD_DRAFT_IP_ROW": {
      if (!state.editingDraft) return state;
      const uid = crypto.randomUUID();
      return {
        ...state,
        editingDraft: { ...state.editingDraft, ips: [...state.editingDraft.ips, { uid, label: "", ip: "" }] },
      };
    }
    case "REMOVE_DRAFT_IP_ROW": {
      if (!state.editingDraft) return state;
      const ips = state.editingDraft.ips.filter((r) => r.uid !== action.uid);
      const activeUid = state.editingDraft.activeUid === action.uid ? ips[0]?.uid ?? "" : state.editingDraft.activeUid;
      return { ...state, editingDraft: { ...state.editingDraft, ips, activeUid } };
    }
    case "SET_DRAFT_ACTIVE":
      if (!state.editingDraft) return state;
      return { ...state, editingDraft: { ...state.editingDraft, activeUid: action.uid } };
    case "TOGGLE_DRAFT_ENABLED":
      if (!state.editingDraft) return state;
      return { ...state, editingDraft: { ...state.editingDraft, enabled: !state.editingDraft.enabled } };
    case "SHOW_DIFF":
      return {
        ...state,
        diff: action.diff,
        pendingDraft: action.pendingDraft,
        pendingRestoreId: action.pendingRestoreId,
        pendingDeleteId: action.pendingDeleteId,
        pendingAdoptId: action.pendingAdoptId,
        pendingRawSave: action.pendingRawSave,
      };
    case "CLOSE_DIFF":
      return {
        ...state,
        diff: null,
        pendingDraft: null,
        pendingRestoreId: null,
        pendingDeleteId: null,
        pendingAdoptId: null,
        pendingRawSave: null,
      };
    case "CLOSE_DIFF_AND_DRAFT":
      return {
        ...state,
        diff: null,
        pendingDraft: null,
        pendingRestoreId: null,
        pendingDeleteId: null,
        pendingAdoptId: null,
        pendingRawSave: null,
        editingDraft: null,
      };
    case "SET_TOAST":
      return { ...state, toast: action.toast };
    case "EXTERNAL_CHANGE_DETECTED":
      return { ...state, externalChangeDetected: true };
    case "DISMISS_EXTERNAL_CHANGE":
      return { ...state, externalChangeDetected: false };
    default:
      return state;
  }
}

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
  const theme: Theme =
    state.themePreference === "system" ? (state.systemPrefersDark ? "dark" : "light") : state.themePreference;
  const c = colorsFor(theme);

  async function refreshEntries() {
    const entries = await api.listEntries();
    dispatch({ type: "SET_ENTRIES", entries });
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
    refreshRawFile().catch(() => {});
    api.getHelperEnabled().then((enabled) => dispatch({ type: "SET_HELPER_ENABLED", enabled })).catch(() => {});
    api.getLaunchAtLogin().then((enabled) => dispatch({ type: "SET_LAUNCH_AT_LOGIN", enabled })).catch(() => {});
    api.getAutoFlushDns().then((enabled) => dispatch({ type: "SET_AUTO_FLUSH_DNS", enabled })).catch(() => {});
    api.getConfirmBeforeSave().then((enabled) => dispatch({ type: "SET_CONFIRM_BEFORE_SAVE", enabled })).catch(() => {});
    api.getHistoryRetention().then((value) => dispatch({ type: "SET_HISTORY_RETENTION", value })).catch(() => {});
    api.getAppVersion().then((version) => dispatch({ type: "SET_APP_VERSION", version })).catch(() => {});
    api.getAutoCheckUpdates().then((enabled) => {
      dispatch({ type: "SET_AUTO_CHECK_UPDATES", enabled });
      if (enabled) handleCheckForUpdates(false);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      if (state.autoCheckUpdates && updateStatusRef.current === "idle") {
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
    try {
      await update.download((event) => {
        if (event.event === "Started") {
          contentLength = event.data.contentLength ?? 0;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          const progress = contentLength > 0 ? Math.min(100, Math.round((downloaded / contentLength) * 100)) : null;
          dispatch({ type: "SET_UPDATE_STATUS", status: "downloading", progress });
          dispatch({
            type: "SET_TOAST",
            toast: {
              type: "info",
              title: "Update available",
              message: progress !== null ? `Downloading Reroute v${update.version}… ${progress}%` : `Downloading Reroute v${update.version}…`,
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
          message: `Restart Reroute to finish installing v${update.version}.`,
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
              message: state.appVersion ? `Reroute v${state.appVersion} is the latest version.` : "You have the latest version.",
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
          message: `Reroute v${update.version} is ready to download.`,
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
    return state.entries.filter((e) => {
      if (state.groupFilter && e.group !== state.groupFilter) return false;
      if (!search) return true;
      return e.hostname.toLowerCase().includes(search) || (e.comment || "").toLowerCase().includes(search);
    });
  }, [state.entries, state.search, state.groupFilter]);

  const filteredUnmanagedEntries = useMemo(() => {
    const search = state.search.trim().toLowerCase();
    if (!search) return state.unmanagedEntries;
    return state.unmanagedEntries.filter(
      (e) => e.hostname.toLowerCase().includes(search) || (e.comment || "").toLowerCase().includes(search),
    );
  }, [state.unmanagedEntries, state.search]);

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
    await refreshHistory();
    refreshHelperStatus().catch(() => {});
    if (result.flushOk === false || (result.flushOk === null && result.flushMessage)) {
      dispatch({
        type: "SET_TOAST",
        toast: { type: "error", title: "DNS flush failed", message: result.flushMessage ?? "The DNS cache could not be flushed.", retryFlush: true },
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
    if (!draft) return;

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
    await api.confirmAdoptMany(ids);
    dispatch({ type: "HIDE_ONBOARDING" });
    await refreshEntries();
    await refreshUnmanagedEntries();
    await refreshHistory();
    refreshHelperStatus().catch(() => {});
    dispatch({
      type: "SET_TOAST",
      toast: { type: "success", title: "Entries adopted", message: `${ids.length} ${ids.length === 1 ? "entry is" : "entries are"} now managed by Reroute.` },
    });
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
    if (!diff) return;
    try {
      if (diff.mode === "save" && pendingDraft) {
        await performConfirmSave(pendingDraft, diff.isNew);
        dispatch({ type: "CLOSE_DIFF_AND_DRAFT" });
      } else if (diff.mode === "adopt" && pendingAdoptId) {
        const result = await api.confirmAdopt(pendingAdoptId);
        if (result.entry) dispatch({ type: "UPSERT_ENTRY", entry: result.entry });
        dispatch({ type: "CLOSE_DIFF" });
        await refreshUnmanagedEntries();
        await refreshHistory();
        refreshHelperStatus().catch(() => {});
        dispatch({
          type: "SET_TOAST",
          toast: { type: "success", title: "Entry adopted", message: `${result.entry?.hostname ?? "The entry"} is now managed by Reroute.` },
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
    }
  }

  const handleSwitchIp = useCallback(async (entryId: string, ipId: string) => {
    dispatch({ type: "CLOSE_IP_MENU" });
    dispatch({ type: "SET_FLUSHING", id: entryId });
    try {
      const result = await api.switchActiveIp(entryId, ipId);
      if (result.entry) dispatch({ type: "UPSERT_ENTRY", entry: result.entry });
      dispatch({ type: "SET_FLUSHING", id: null });
      await refreshHistory();
      refreshHelperStatus().catch(() => {});
      const ip = result.entry?.ips.find((i) => i.id === ipId);
      if (result.flushOk === false || (result.flushOk === null && result.flushMessage)) {
        dispatch({
          type: "SET_TOAST",
          toast: { type: "error", title: "DNS flush failed", message: result.flushMessage ?? "The DNS cache could not be flushed.", retryFlush: true },
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

  const handleToggleEnabled = useCallback(async (entryId: string) => {
    try {
      const result = await api.toggleEnabled(entryId);
      if (result.entry) dispatch({ type: "UPSERT_ENTRY", entry: result.entry });
      await refreshHistory();
      refreshHelperStatus().catch(() => {});
      if (result.entry) {
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
  const handleOpenAddPanel = useCallback(() => dispatch({ type: "OPEN_ADD_PANEL" }), []);
  const handleClearGroupFilter = useCallback(() => dispatch({ type: "CLEAR_GROUP_FILTER" }), []);
  const handleToggleIpMenu = useCallback((id: string) => dispatch({ type: "TOGGLE_IP_MENU", id }), []);
  const handleOpenEditPanel = useCallback((entry: Entry) => dispatch({ type: "OPEN_EDIT_PANEL", entry }), []);

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
        trayOpen={state.trayOpen}
        onToggleTray={() => dispatch({ type: "TOGGLE_TRAY" })}
        onCloseTray={() => dispatch({ type: "CLOSE_TRAY" })}
        entries={state.entries}
        onSwitchIp={handleSwitchIp}
        onFlushDns={handleFlushDns}
        onOpenSettings={() => dispatch({ type: "OPEN_SETTINGS" })}
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
        />

        {state.view === "list" ? (
          <ListView
            c={c}
            entries={filteredEntries}
            totalEntryCount={state.entries.length}
            unmanagedEntries={state.groupFilter ? [] : filteredUnmanagedEntries}
            search={state.search}
            onSearchChange={handleSearchChange}
            onAddClick={handleOpenAddPanel}
            groupFilter={state.groupFilter}
            onClearGroupFilter={handleClearGroupFilter}
            openIpMenuId={state.openIpMenuId}
            flushingId={state.flushingId}
            disabled={state.externalChangeDetected}
            onToggleDropdown={handleToggleIpMenu}
            onToggleEnabled={handleToggleEnabled}
            onEdit={handleOpenEditPanel}
            onSwitchIp={handleSwitchIp}
            onAdopt={handleRequestAdopt}
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
          onCancel={() => dispatch({ type: "CLOSE_DIFF" })}
          onConfirm={handleConfirmDiff}
        />
      )}

      {state.settingsOpen && (
        <SettingsModal
          c={c}
          helperEnabled={state.helperEnabled}
          helperActive={state.helperActive}
          launchAtLogin={state.launchAtLogin}
          autoFlushDns={state.autoFlushDns}
          confirmBeforeSave={state.confirmBeforeSave}
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
          onSetHistoryRetention={handleSetHistoryRetention}
          onSetAutoCheckUpdates={handleSetAutoCheckUpdates}
          onCheckForUpdatesNow={() => handleCheckForUpdates(true)}
        />
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
