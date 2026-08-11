import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { isEnabled as isAutostartEnabled, enable as enableAutostart, disable as disableAutostart } from "@tauri-apps/plugin-autostart";
import { check as checkForUpdate } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import type {
  Conflict,
  DiffPreview,
  DoctorCheck,
  Entry,
  EntryDraft,
  HistoryEntry,
  HistoryRetention,
  LintDiagnostic,
  UnmanagedEntry,
  WriteResult,
} from "./types";

export const api = {
  listEntries: () => invoke<Entry[]>("list_entries"),
  listConflicts: () => invoke<Conflict[]>("list_conflicts"),
  getHistory: () => invoke<HistoryEntry[]>("get_history"),
  isShadowDomain: (hostname: string) => invoke<boolean>("is_shadow_domain", { hostname }),

  previewSave: (draft: EntryDraft) => invoke<DiffPreview>("preview_save", { draft }),
  confirmSave: (draft: EntryDraft) => invoke<WriteResult>("confirm_save", { draft }),

  switchActiveIp: (entryId: string, ipId: string) =>
    invoke<WriteResult>("switch_active_ip", { entryId, ipId }),
  toggleEnabled: (entryId: string) => invoke<WriteResult>("toggle_enabled", { entryId }),

  historyDiff: (historyId: string) => invoke<DiffPreview>("history_diff", { historyId }),
  previewRestore: (historyId: string) => invoke<DiffPreview>("preview_restore", { historyId }),
  confirmRestore: (historyId: string) => invoke<WriteResult>("confirm_restore", { historyId }),

  previewDelete: (entryId: string) => invoke<DiffPreview>("preview_delete", { entryId }),
  confirmDelete: (entryId: string) => invoke<WriteResult>("confirm_delete", { entryId }),
  renameGroup: (oldName: string, newName: string) => invoke<Entry[]>("rename_group", { oldName, newName }),

  listUnmanagedEntries: () => invoke<UnmanagedEntry[]>("list_unmanaged_entries"),
  previewAdopt: (id: string) => invoke<DiffPreview>("preview_adopt", { id }),
  confirmAdopt: (id: string) => invoke<Entry[]>("confirm_adopt", { id }),
  confirmAdoptMany: (ids: string[]) => invoke<Entry[]>("confirm_adopt_many", { ids }),

  readHostsFile: () => invoke<string>("read_hosts_file"),
  previewRawSave: (content: string) => invoke<DiffPreview>("preview_raw_save", { content }),
  confirmRawSave: (content: string) => invoke<WriteResult>("confirm_raw_save", { content }),
  lintHostsContent: (content: string) => invoke<LintDiagnostic[]>("lint_hosts_content", { content }),

  flushDns: () => invoke<WriteResult>("flush_dns"),

  helperStatus: () => invoke<boolean>("helper_status"),
  uninstallHelper: () => invoke<void>("uninstall_helper"),
  getHelperEnabled: () => invoke<boolean>("get_helper_enabled"),
  setHelperEnabled: (enabled: boolean) => invoke<void>("set_helper_enabled", { enabled }),

  getLaunchAtLogin: () => isAutostartEnabled(),
  setLaunchAtLogin: (enabled: boolean) => (enabled ? enableAutostart() : disableAutostart()),

  getSetting: (key: string) => invoke<string | null>("get_setting", { key }),
  setSetting: (key: string, value: string) => invoke<void>("set_setting", { key, value }),

  getAutoFlushDns: () => invoke<string | null>("get_setting", { key: "auto_flush_dns" }).then((v) => v !== "false"),
  setAutoFlushDns: (enabled: boolean) =>
    invoke<void>("set_setting", { key: "auto_flush_dns", value: enabled ? "true" : "false" }),

  getConfirmBeforeSave: () =>
    invoke<string | null>("get_setting", { key: "confirm_before_save" }).then((v) => v === "true"),
  setConfirmBeforeSave: (enabled: boolean) =>
    invoke<void>("set_setting", { key: "confirm_before_save", value: enabled ? "true" : "false" }),

  getPropagateGroupIps: () =>
    invoke<string | null>("get_setting", { key: "propagate_group_ips" }).then((v) => v !== "false"),
  setPropagateGroupIps: (enabled: boolean) =>
    invoke<void>("set_setting", { key: "propagate_group_ips", value: enabled ? "true" : "false" }),

  getUnmanagedListCollapsed: () =>
    invoke<string | null>("get_setting", { key: "unmanaged_list_collapsed" }).then((v) => v === "true"),
  setUnmanagedListCollapsed: (collapsed: boolean) =>
    invoke<void>("set_setting", { key: "unmanaged_list_collapsed", value: collapsed ? "true" : "false" }),

  getHistoryRetention: () =>
    invoke<string | null>("get_setting", { key: "history_retention" }).then((v) => (v ?? "200") as HistoryRetention),
  setHistoryRetention: (value: HistoryRetention) => invoke<void>("set_setting", { key: "history_retention", value }),

  getAppVersion: () => getVersion(),
  checkForUpdate: () => checkForUpdate(),
  getAutoCheckUpdates: () =>
    invoke<string | null>("get_setting", { key: "auto_check_updates" }).then((v) => v !== "false"),
  setAutoCheckUpdates: (enabled: boolean) =>
    invoke<void>("set_setting", { key: "auto_check_updates", value: enabled ? "true" : "false" }),
  relaunchApp: () => relaunch(),

  runDiagnostics: () => invoke<DoctorCheck[]>("run_diagnostics"),
};
