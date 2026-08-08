import { useEffect, useMemo, useReducer } from "react";
import { listen } from "@tauri-apps/api/event";
import "./App.css";
import { api } from "./api";
import { colorsFor, type Theme } from "./theme";
import type { DiffPreview, Entry, EntryDraft, HistoryEntry, HistoryRetention, ToastState } from "./types";
import { TitleBar } from "./components/TitleBar";
import { Sidebar } from "./components/Sidebar";
import { ListView } from "./components/ListView";
import { HistoryView } from "./components/HistoryView";
import { DraftPanel } from "./components/DraftPanel";
import { DiffModal } from "./components/DiffModal";
import { Toast } from "./components/Toast";
import { ReloadBanner } from "./components/ReloadBanner";
import { SettingsModal } from "./components/SettingsModal";

const HOSTS_CHANGED_EVENT = "hosts-file-changed-externally";
const THEME_STORAGE_KEY = "hosts-manager-theme";

function loadStoredTheme(): Theme {
  return localStorage.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
}

interface State {
  theme: Theme;
  view: "list" | "history";
  search: string;
  groupFilter: string | null;
  entries: Entry[];
  history: HistoryEntry[];
  openIpMenuId: string | null;
  flushingId: string | null;
  editingDraft: EntryDraft | null;
  diff: DiffPreview | null;
  pendingDraft: EntryDraft | null;
  pendingRestoreId: string | null;
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
}

type Action =
  | { type: "SET_ENTRIES"; entries: Entry[] }
  | { type: "SET_HISTORY"; history: HistoryEntry[] }
  | { type: "SET_THEME"; theme: Theme }
  | { type: "SET_HELPER_ACTIVE"; active: boolean }
  | { type: "SET_HELPER_ENABLED"; enabled: boolean }
  | { type: "SET_LAUNCH_AT_LOGIN"; enabled: boolean }
  | { type: "SET_AUTO_FLUSH_DNS"; enabled: boolean }
  | { type: "SET_CONFIRM_BEFORE_SAVE"; enabled: boolean }
  | { type: "SET_HISTORY_RETENTION"; value: HistoryRetention }
  | { type: "OPEN_SETTINGS" }
  | { type: "CLOSE_SETTINGS" }
  | { type: "TOGGLE_THEME" }
  | { type: "GO_LIST" }
  | { type: "GO_HISTORY" }
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
  | { type: "SHOW_DIFF"; diff: DiffPreview; pendingDraft: EntryDraft | null; pendingRestoreId: string | null }
  | { type: "CLOSE_DIFF" }
  | { type: "CLOSE_DIFF_AND_DRAFT" }
  | { type: "SET_TOAST"; toast: ToastState | null }
  | { type: "EXTERNAL_CHANGE_DETECTED" }
  | { type: "DISMISS_EXTERNAL_CHANGE" };

const initialState: State = {
  theme: loadStoredTheme(),
  view: "list",
  search: "",
  groupFilter: null,
  entries: [],
  history: [],
  openIpMenuId: null,
  flushingId: null,
  editingDraft: null,
  diff: null,
  pendingDraft: null,
  pendingRestoreId: null,
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
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "SET_ENTRIES":
      return { ...state, entries: action.entries };
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
    case "OPEN_SETTINGS":
      return { ...state, settingsOpen: true };
    case "CLOSE_SETTINGS":
      return { ...state, settingsOpen: false };
    case "TOGGLE_THEME":
      return { ...state, theme: state.theme === "light" ? "dark" : "light" };
    case "SET_THEME":
      return { ...state, theme: action.theme };
    case "GO_LIST":
      return { ...state, view: "list", trayOpen: false, groupFilter: null };
    case "GO_HISTORY":
      return { ...state, view: "history", trayOpen: false };
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
      return { ...state, diff: action.diff, pendingDraft: action.pendingDraft, pendingRestoreId: action.pendingRestoreId };
    case "CLOSE_DIFF":
      return { ...state, diff: null, pendingDraft: null, pendingRestoreId: null };
    case "CLOSE_DIFF_AND_DRAFT":
      return { ...state, diff: null, pendingDraft: null, pendingRestoreId: null, editingDraft: null };
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
  const c = colorsFor(state.theme);

  async function refreshEntries() {
    const entries = await api.listEntries();
    dispatch({ type: "SET_ENTRIES", entries });
  }

  async function refreshHistory() {
    const history = await api.getHistory();
    dispatch({ type: "SET_HISTORY", history });
  }

  async function refreshHelperStatus() {
    const active = await api.helperStatus();
    dispatch({ type: "SET_HELPER_ACTIVE", active });
  }

  useEffect(() => {
    refreshEntries().catch((err) =>
      dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Failed to load entries", message: errorMessage(err) } }),
    );
    refreshHistory().catch(() => {});
    refreshHelperStatus().catch(() => {});
    api.getHelperEnabled().then((enabled) => dispatch({ type: "SET_HELPER_ENABLED", enabled })).catch(() => {});
    api.getLaunchAtLogin().then((enabled) => dispatch({ type: "SET_LAUNCH_AT_LOGIN", enabled })).catch(() => {});
    api.getAutoFlushDns().then((enabled) => dispatch({ type: "SET_AUTO_FLUSH_DNS", enabled })).catch(() => {});
    api.getConfirmBeforeSave().then((enabled) => dispatch({ type: "SET_CONFIRM_BEFORE_SAVE", enabled })).catch(() => {});
    api.getHistoryRetention().then((value) => dispatch({ type: "SET_HISTORY_RETENTION", value })).catch(() => {});
  }, []);

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

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen(HOSTS_CHANGED_EVENT, () => dispatch({ type: "EXTERNAL_CHANGE_DETECTED" })).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    localStorage.setItem(THEME_STORAGE_KEY, state.theme);
  }, [state.theme]);

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

  const groups = useMemo(() => {
    const names = Array.from(new Set(state.entries.filter((e) => e.group).map((e) => e.group))).sort();
    return names.map((name) => ({ name, count: state.entries.filter((e) => e.group === name).length }));
  }, [state.entries]);

  async function handleReload() {
    dispatch({ type: "DISMISS_EXTERNAL_CHANGE" });
    try {
      await refreshEntries();
      await refreshHistory();
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
    dispatch({
      type: "SET_TOAST",
      toast: {
        type: "success",
        title: isNew ? "Entry added" : "Entry saved",
        message: `${result.entry?.hostname ?? ""} has been written to the hosts file.`,
      },
    });
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
          dispatch({ type: "SHOW_DIFF", diff, pendingDraft: draft, pendingRestoreId: null });
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
      dispatch({ type: "SHOW_DIFF", diff, pendingDraft: draft, pendingRestoreId: null });
    } catch (err) {
      dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Couldn't preview changes", message: errorMessage(err) } });
    }
  }

  async function handleViewHistoryDiff(id: string) {
    try {
      const diff = await api.historyDiff(id);
      dispatch({ type: "SHOW_DIFF", diff, pendingDraft: null, pendingRestoreId: null });
    } catch (err) {
      dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Couldn't load diff", message: errorMessage(err) } });
    }
  }

  async function handleRequestRestore(id: string) {
    try {
      const diff = await api.previewRestore(id);
      dispatch({ type: "SHOW_DIFF", diff, pendingDraft: null, pendingRestoreId: id });
    } catch (err) {
      dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Couldn't preview restore", message: errorMessage(err) } });
    }
  }

  async function handleConfirmDiff() {
    const { diff, pendingDraft, pendingRestoreId } = state;
    if (!diff) return;
    try {
      if (diff.mode === "save" && pendingDraft) {
        await performConfirmSave(pendingDraft, diff.isNew);
        dispatch({ type: "CLOSE_DIFF_AND_DRAFT" });
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
      } else {
        dispatch({ type: "CLOSE_DIFF" });
      }
    } catch (err) {
      dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Write failed", message: errorMessage(err) } });
    }
  }

  async function handleSwitchIp(entryId: string, ipId: string) {
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
  }

  async function handleToggleEnabled(entryId: string) {
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
  }

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
        theme={state.theme}
        onToggleTheme={() => dispatch({ type: "TOGGLE_THEME" })}
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
            search={state.search}
            onSearchChange={(v) => dispatch({ type: "SET_SEARCH", value: v })}
            onAddClick={() => dispatch({ type: "OPEN_ADD_PANEL" })}
            groupFilter={state.groupFilter}
            onClearGroupFilter={() => dispatch({ type: "CLEAR_GROUP_FILTER" })}
            openIpMenuId={state.openIpMenuId}
            flushingId={state.flushingId}
            disabled={state.externalChangeDetected}
            onToggleDropdown={(id) => dispatch({ type: "TOGGLE_IP_MENU", id })}
            onToggleEnabled={handleToggleEnabled}
            onEdit={(entry) => dispatch({ type: "OPEN_EDIT_PANEL", entry })}
            onSwitchIp={handleSwitchIp}
          />
        ) : (
          <HistoryView c={c} history={state.history} onViewDiff={handleViewHistoryDiff} onRestore={handleRequestRestore} />
        )}
      </div>

      {state.editingDraft && (
        <DraftPanel
          c={c}
          draft={state.editingDraft}
          onClose={() => dispatch({ type: "CLOSE_DRAFT" })}
          onFieldChange={(field, value) => dispatch({ type: "UPDATE_DRAFT_FIELD", field, value })}
          onIpFieldChange={(uid, field, value) => dispatch({ type: "UPDATE_DRAFT_IP", uid, field, value })}
          onAddIpRow={() => dispatch({ type: "ADD_DRAFT_IP_ROW" })}
          onRemoveIpRow={(uid) => dispatch({ type: "REMOVE_DRAFT_IP_ROW", uid })}
          onSetActive={(uid) => dispatch({ type: "SET_DRAFT_ACTIVE", uid })}
          onToggleEnabled={() => dispatch({ type: "TOGGLE_DRAFT_ENABLED" })}
          onSave={handleRequestSave}
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
          theme={state.theme}
          historyRetention={state.historyRetention}
          onClose={() => dispatch({ type: "CLOSE_SETTINGS" })}
          onSetTheme={(theme) => dispatch({ type: "SET_THEME", theme })}
          onSetHelperEnabled={handleSetHelperEnabled}
          onSetLaunchAtLogin={handleSetLaunchAtLogin}
          onSetAutoFlushDns={handleSetAutoFlushDns}
          onSetConfirmBeforeSave={handleSetConfirmBeforeSave}
          onSetHistoryRetention={handleSetHistoryRetention}
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
    </div>
  );
}
