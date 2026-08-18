import type { ThemePreference } from "../theme";
import type {
  Conflict,
  DiffPreview,
  Entry,
  EntryDraft,
  HistoryEntry,
  HistoryRetention,
  IpCandidate,
  ToastState,
  UnmanagedEntry,
} from "../types";

export type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "ready" | "error";

export interface State {
  themePreference: ThemePreference;
  systemPrefersDark: boolean;
  view: "list" | "history" | "raw";
  search: string;
  hostnameSort: "none" | "asc" | "desc";
  groupFilter: string | null;
  entries: Entry[];
  conflicts: Conflict[];
  unreachableIps: Record<string, string>;
  unmanagedEntries: UnmanagedEntry[];
  showOnboarding: boolean;
  onboardingEntries: UnmanagedEntry[];
  history: HistoryEntry[];
  openIpMenuId: string | null;
  flushingId: string | null;
  editingDraft: EntryDraft | null;
  savingDraft: boolean;
  diff: DiffPreview | null;
  confirmingDiff: boolean;
  pendingDraft: EntryDraft | null;
  pendingRestoreId: string | null;
  pendingDeleteId: string | null;
  pendingAdoptId: string | null;
  pendingRawSave: string | null;
  rawFileContent: string | null;
  rawDraftContent: string | null;
  toast: ToastState | null;
  externalChangeDetected: boolean;
  helperActive: boolean;
  helperEnabled: boolean;
  helperSupported: boolean;
  settingsOpen: boolean;
  doctorOpen: boolean;
  switchIpOpen: boolean;
  launchAtLogin: boolean;
  autoFlushDns: boolean;
  confirmBeforeSave: boolean;
  propagateGroupIps: boolean;
  unmanagedListCollapsed: boolean;
  historyRetention: HistoryRetention;
  appVersion: string | null;
  autoCheckUpdates: boolean;
  updateStatus: UpdateStatus;
  updateVersion: string | null;
  updateProgress: number | null;
}

export type Action =
  | { type: "SET_ENTRIES"; entries: Entry[] }
  | { type: "SET_CONFLICTS"; conflicts: Conflict[] }
  | { type: "SET_IP_UNREACHABLE"; entryId: string; ipId: string }
  | { type: "CLEAR_IP_UNREACHABLE"; entryId: string }
  | { type: "SET_UNMANAGED_ENTRIES"; entries: UnmanagedEntry[] }
  | { type: "SHOW_ONBOARDING"; entries: UnmanagedEntry[] }
  | { type: "HIDE_ONBOARDING" }
  | { type: "SET_HISTORY"; history: HistoryEntry[] }
  | { type: "SET_THEME_PREFERENCE"; preference: ThemePreference }
  | { type: "SET_SYSTEM_PREFERS_DARK"; prefersDark: boolean }
  | { type: "SET_HELPER_ACTIVE"; active: boolean }
  | { type: "SET_HELPER_ENABLED"; enabled: boolean }
  | { type: "SET_HELPER_SUPPORTED"; supported: boolean }
  | { type: "SET_LAUNCH_AT_LOGIN"; enabled: boolean }
  | { type: "SET_AUTO_FLUSH_DNS"; enabled: boolean }
  | { type: "SET_CONFIRM_BEFORE_SAVE"; enabled: boolean }
  | { type: "SET_PROPAGATE_GROUP_IPS"; enabled: boolean }
  | { type: "SET_UNMANAGED_LIST_COLLAPSED"; collapsed: boolean }
  | { type: "SET_HISTORY_RETENTION"; value: HistoryRetention }
  | { type: "SET_APP_VERSION"; version: string }
  | { type: "SET_AUTO_CHECK_UPDATES"; enabled: boolean }
  | { type: "SET_UPDATE_STATUS"; status: UpdateStatus; version?: string | null; progress?: number | null }
  | { type: "OPEN_SETTINGS" }
  | { type: "CLOSE_SETTINGS" }
  | { type: "OPEN_DOCTOR" }
  | { type: "CLOSE_DOCTOR" }
  | { type: "OPEN_SWITCH_IP_MODAL" }
  | { type: "CLOSE_SWITCH_IP_MODAL" }
  | { type: "GO_LIST" }
  | { type: "GO_HISTORY" }
  | { type: "GO_RAW" }
  | { type: "SET_RAW_FILE_CONTENT"; content: string }
  | { type: "SET_RAW_DRAFT_CONTENT"; content: string }
  | { type: "SELECT_GROUP"; group: string }
  | { type: "CLEAR_GROUP_FILTER" }
  | { type: "RENAME_GROUP_FILTER"; oldName: string; newName: string }
  | { type: "SET_SEARCH"; value: string }
  | { type: "TOGGLE_HOSTNAME_SORT" }
  | { type: "TOGGLE_IP_MENU"; id: string }
  | { type: "CLOSE_IP_MENU" }
  | { type: "SET_FLUSHING"; id: string | null }
  | { type: "UPSERT_ENTRY"; entry: Entry }
  | { type: "UPSERT_ENTRIES"; entries: Entry[] }
  | { type: "REMOVE_ENTRY"; id: string }
  | { type: "OPEN_ADD_PANEL" }
  | { type: "OPEN_EDIT_PANEL"; entry: Entry }
  | { type: "DUPLICATE_ENTRY"; entry: Entry }
  | { type: "CLOSE_DRAFT" }
  | { type: "UPDATE_DRAFT_FIELD"; field: "hostname" | "group"; value: string }
  | { type: "UPDATE_DRAFT_IP"; uid: string; field: "label" | "ip"; value: string }
  | { type: "ADD_DRAFT_IP_ROW" }
  | { type: "REMOVE_DRAFT_IP_ROW"; uid: string }
  | { type: "SET_DRAFT_ACTIVE"; uid: string }
  | { type: "TOGGLE_DRAFT_ENABLED" }
  | { type: "SET_SAVING_DRAFT"; saving: boolean }
  | {
      type: "SHOW_DIFF";
      diff: DiffPreview;
      pendingDraft: EntryDraft | null;
      pendingRestoreId: string | null;
      pendingDeleteId: string | null;
      pendingAdoptId: string | null;
      pendingRawSave: string | null;
    }
  | { type: "SET_CONFIRMING_DIFF"; confirming: boolean }
  | { type: "CLOSE_DIFF" }
  | { type: "CLOSE_DIFF_AND_DRAFT" }
  | { type: "SET_TOAST"; toast: ToastState | null }
  | { type: "EXTERNAL_CHANGE_DETECTED" }
  | { type: "DISMISS_EXTERNAL_CHANGE" };

/** The two values only the browser can supply (localStorage/matchMedia);
 * everything else in `State` has a static default. Kept as caller-supplied
 * arguments rather than read inside this module so `createInitialState`
 * (and therefore `reducer`'s behavior) stays testable without a DOM. */
export function createInitialState(browserDefaults: { themePreference: ThemePreference; systemPrefersDark: boolean }): State {
  return {
    themePreference: browserDefaults.themePreference,
    systemPrefersDark: browserDefaults.systemPrefersDark,
    view: "list",
    search: "",
    hostnameSort: "none",
    groupFilter: null,
    entries: [],
    conflicts: [],
    unreachableIps: {},
    unmanagedEntries: [],
    showOnboarding: false,
    onboardingEntries: [],
    history: [],
    openIpMenuId: null,
    flushingId: null,
    editingDraft: null,
    savingDraft: false,
    diff: null,
    confirmingDiff: false,
    pendingDraft: null,
    pendingRestoreId: null,
    pendingDeleteId: null,
    pendingAdoptId: null,
    pendingRawSave: null,
    rawFileContent: null,
    rawDraftContent: null,
    toast: null,
    externalChangeDetected: false,
    helperActive: false,
    helperEnabled: true,
    helperSupported: true,
    settingsOpen: false,
    doctorOpen: false,
    switchIpOpen: false,
    launchAtLogin: false,
    autoFlushDns: true,
    confirmBeforeSave: false,
    propagateGroupIps: true,
    unmanagedListCollapsed: false,
    historyRetention: "200",
    appVersion: null,
    autoCheckUpdates: true,
    updateStatus: "idle",
    updateVersion: null,
    updateProgress: null,
  };
}

function ipsEqual(a: IpCandidate[], b: IpCandidate[]): boolean {
  return a.length === b.length && a.every((ip, i) => ip.id === b[i].id && ip.label === b[i].label && ip.ip === b[i].ip);
}

function entriesEqual(a: Entry, b: Entry): boolean {
  return (
    a.hostname === b.hostname &&
    a.comment === b.comment &&
    a.group === b.group &&
    a.enabled === b.enabled &&
    a.activeIpId === b.activeIpId &&
    a.lastModified === b.lastModified &&
    ipsEqual(a.ips, b.ips)
  );
}

/**
 * Reuses `prev`'s object references for entries whose content is unchanged
 * in `next`, instead of adopting `next` wholesale. Every `invoke()`
 * round-trip deserializes a brand-new object graph, so a plain "replace
 * with the freshly fetched array" defeats `EntryRow`'s `React.memo` for
 * every row on every refresh, not just the row that actually changed.
 */
export function mergeEntries(prev: Entry[], next: Entry[]): Entry[] {
  const prevById = new Map(prev.map((e) => [e.id, e]));
  return next.map((entry) => {
    const existing = prevById.get(entry.id);
    return existing && entriesEqual(existing, entry) ? existing : entry;
  });
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "SET_ENTRIES":
      return { ...state, entries: mergeEntries(state.entries, action.entries) };
    case "SET_CONFLICTS":
      return { ...state, conflicts: action.conflicts };
    case "SET_IP_UNREACHABLE":
      return { ...state, unreachableIps: { ...state.unreachableIps, [action.entryId]: action.ipId } };
    case "CLEAR_IP_UNREACHABLE": {
      if (!(action.entryId in state.unreachableIps)) return state;
      const unreachableIps = { ...state.unreachableIps };
      delete unreachableIps[action.entryId];
      return { ...state, unreachableIps };
    }
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
    case "SET_HELPER_SUPPORTED":
      return { ...state, helperSupported: action.supported };
    case "SET_LAUNCH_AT_LOGIN":
      return { ...state, launchAtLogin: action.enabled };
    case "SET_AUTO_FLUSH_DNS":
      return { ...state, autoFlushDns: action.enabled };
    case "SET_CONFIRM_BEFORE_SAVE":
      return { ...state, confirmBeforeSave: action.enabled };
    case "SET_PROPAGATE_GROUP_IPS":
      return { ...state, propagateGroupIps: action.enabled };
    case "SET_UNMANAGED_LIST_COLLAPSED":
      return { ...state, unmanagedListCollapsed: action.collapsed };
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
    case "OPEN_DOCTOR":
      return { ...state, doctorOpen: true };
    case "CLOSE_DOCTOR":
      return { ...state, doctorOpen: false };
    case "OPEN_SWITCH_IP_MODAL":
      return { ...state, switchIpOpen: true };
    case "CLOSE_SWITCH_IP_MODAL":
      return { ...state, switchIpOpen: false };
    case "SET_THEME_PREFERENCE":
      return { ...state, themePreference: action.preference };
    case "SET_SYSTEM_PREFERS_DARK":
      return { ...state, systemPrefersDark: action.prefersDark };
    case "GO_LIST":
      return { ...state, view: "list", groupFilter: null, switchIpOpen: false };
    case "GO_HISTORY":
      return { ...state, view: "history", switchIpOpen: false };
    case "GO_RAW":
      return { ...state, view: "raw", switchIpOpen: false };
    case "SET_RAW_FILE_CONTENT":
      return { ...state, rawFileContent: action.content, rawDraftContent: action.content };
    case "SET_RAW_DRAFT_CONTENT":
      return { ...state, rawDraftContent: action.content };
    case "SELECT_GROUP":
      return { ...state, view: "list", groupFilter: action.group, switchIpOpen: false };
    case "CLEAR_GROUP_FILTER":
      return { ...state, groupFilter: null, switchIpOpen: false };
    case "RENAME_GROUP_FILTER":
      return state.groupFilter === action.oldName ? { ...state, groupFilter: action.newName } : state;
    case "SET_SEARCH":
      return { ...state, search: action.value };
    case "TOGGLE_HOSTNAME_SORT": {
      const next = state.hostnameSort === "none" ? "asc" : state.hostnameSort === "asc" ? "desc" : "none";
      return { ...state, hostnameSort: next };
    }
    case "TOGGLE_IP_MENU":
      return { ...state, openIpMenuId: state.openIpMenuId === action.id ? null : action.id };
    case "CLOSE_IP_MENU":
      return { ...state, openIpMenuId: null };
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
    case "UPSERT_ENTRIES": {
      const byId = new Map(action.entries.map((e) => [e.id, e]));
      const updated = state.entries.map((e) => byId.get(e.id) ?? e);
      const newOnes = action.entries.filter((e) => !state.entries.some((existing) => existing.id === e.id));
      return { ...state, entries: [...updated, ...newOnes] };
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
    case "DUPLICATE_ENTRY": {
      const ips = action.entry.ips.map((i) => ({ uid: crypto.randomUUID(), label: i.label, ip: i.ip }));
      const activeSource = action.entry.ips.findIndex((i) => i.id === action.entry.activeIpId);
      const activeUid = ips[activeSource >= 0 ? activeSource : 0]?.uid ?? "";
      return {
        ...state,
        editingDraft: {
          id: null,
          hostname: action.entry.hostname,
          comment: action.entry.comment,
          group: action.entry.group,
          enabled: action.entry.enabled,
          activeUid,
          ips,
        },
      };
    }
    case "CLOSE_DRAFT":
      return { ...state, editingDraft: null, savingDraft: false };
    case "SET_SAVING_DRAFT":
      return { ...state, savingDraft: action.saving };
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
    case "SET_CONFIRMING_DIFF":
      return { ...state, confirmingDiff: action.confirming };
    case "CLOSE_DIFF":
      return {
        ...state,
        diff: null,
        confirmingDiff: false,
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
        confirmingDiff: false,
        pendingDraft: null,
        pendingRestoreId: null,
        pendingDeleteId: null,
        pendingAdoptId: null,
        pendingRawSave: null,
        editingDraft: null,
        savingDraft: false,
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
