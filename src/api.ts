import { invoke } from "@tauri-apps/api/core";
import { isEnabled as isAutostartEnabled, enable as enableAutostart, disable as disableAutostart } from "@tauri-apps/plugin-autostart";
import type { DiffPreview, Entry, EntryDraft, HistoryEntry, WriteResult } from "./types";

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
};
