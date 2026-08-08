import { invoke } from "@tauri-apps/api/core";
import { isEnabled as isAutostartEnabled, enable as enableAutostart, disable as disableAutostart } from "@tauri-apps/plugin-autostart";
import type { DiffPreview, Entry, EntryDraft, HistoryEntry, HistoryRetention, WriteResult } from "./types";

export const api = {
  listEntries: () => invoke<Entry[]>("list_entries"),
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

  getHistoryRetention: () =>
    invoke<string | null>("get_setting", { key: "history_retention" }).then((v) => (v ?? "200") as HistoryRetention),
  setHistoryRetention: (value: HistoryRetention) => invoke<void>("set_setting", { key: "history_retention", value }),
};
