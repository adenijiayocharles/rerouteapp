import { invoke } from "@tauri-apps/api/core";
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
};
