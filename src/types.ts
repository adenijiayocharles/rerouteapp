export interface IpCandidate {
  id: string;
  label: string;
  ip: string;
}

export interface Entry {
  id: string;
  hostname: string;
  comment: string;
  group: string;
  enabled: boolean;
  activeIpId: string;
  ips: IpCandidate[];
  lastModified: string;
}

export interface HistoryEntry {
  id: string;
  time: string;
  hostname: string;
  action: string;
  before: Entry | null;
  after: Entry | null;
}

export interface IpDraft {
  uid: string;
  label: string;
  ip: string;
}

export interface EntryDraft {
  id: string | null;
  hostname: string;
  comment: string;
  group: string;
  enabled: boolean;
  activeUid: string;
  ips: IpDraft[];
}

export interface UnmanagedEntry {
  id: string;
  ip: string;
  hostname: string;
  comment: string;
}

export interface DiffLine {
  kind: "same" | "added" | "removed";
  text: string;
}

export interface LintDiagnostic {
  line: number;
  severity: "error" | "warning";
  message: string;
}

export type DiffMode = "save" | "restore" | "view" | "delete" | "raw" | "adopt";

export interface DiffPreview {
  mode: DiffMode;
  isNew: boolean;
  isRemoval: boolean;
  title: string;
  subtitle: string;
  beforeLine: string | null;
  afterLine: string | null;
  isShadowDomain: boolean;
  restoreTargetId: string | null;
  historyBefore: Entry | null;
  historyAfter: Entry | null;
  diffLines: DiffLine[] | null;
  diagnostics: LintDiagnostic[] | null;
}

export interface WriteResult {
  entry: Entry | null;
  flushOk: boolean | null;
  flushMessage: string | null;
}

export type HistoryRetention = "50" | "100" | "200" | "unlimited";

export type ToastType = "success" | "error" | "info";

export interface ToastState {
  type: ToastType;
  title: string;
  message: string;
  retryFlush?: boolean;
}
