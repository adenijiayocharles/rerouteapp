use serde::{Deserialize, Serialize};

use crate::diff::DiffLine;
use crate::lint::LintDiagnostic;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct IpCandidate {
    pub id: String,
    pub label: String,
    pub ip: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Entry {
    pub id: String,
    pub hostname: String,
    pub comment: String,
    pub group: String,
    pub enabled: bool,
    #[serde(rename = "activeIpId")]
    pub active_ip_id: String,
    pub ips: Vec<IpCandidate>,
    #[serde(rename = "lastModified")]
    pub last_modified: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct HistoryEntry {
    pub id: String,
    pub time: String,
    pub hostname: String,
    pub action: String,
    pub before: Option<Entry>,
    pub after: Option<Entry>,
}

#[derive(Deserialize, Clone, Debug)]
pub struct IpDraft {
    pub uid: String,
    pub label: String,
    pub ip: String,
}

#[derive(Deserialize, Clone, Debug)]
pub struct EntryDraft {
    pub id: Option<String>,
    pub hostname: String,
    pub comment: String,
    pub group: String,
    pub enabled: bool,
    #[serde(rename = "activeUid")]
    pub active_uid: String,
    pub ips: Vec<IpDraft>,
}

/// Surfaced in the review-changes modal when saving an entry would (or, in
/// `confirm_save`, did) touch every other entry sharing its group, so the
/// propagation is never a silent side effect: `kind: "added"` means an
/// IP this save just introduced was also added as a candidate to those
/// entries; `kind: "relabeled"` means an IP's label was edited and that
/// new label was carried over to matching-address candidates there too.
/// Not written to the hosts file itself — see `store::rename_group` for the
/// "group is UI-only metadata" rationale, which applies here too: neither
/// kind changes which IP a sibling's line actually resolves to.
#[derive(Serialize, Clone, Debug)]
pub struct GroupPropagationNotice {
    pub group: String,
    pub kind: String, // "added" | "relabeled"
    pub ips: Vec<String>,
    pub hostnames: Vec<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct DiffPreview {
    pub mode: String, // "save" | "restore" | "view" | "delete" | "raw"
    #[serde(rename = "isNew")]
    pub is_new: bool,
    #[serde(rename = "isRemoval")]
    pub is_removal: bool,
    pub title: String,
    pub subtitle: String,
    #[serde(rename = "beforeLine")]
    pub before_line: Option<String>,
    #[serde(rename = "afterLine")]
    pub after_line: Option<String>,
    #[serde(rename = "isShadowDomain")]
    pub is_shadow_domain: bool,
    #[serde(rename = "restoreTargetId")]
    pub restore_target_id: Option<String>,
    #[serde(rename = "historyBefore")]
    pub history_before: Option<Entry>,
    #[serde(rename = "historyAfter")]
    pub history_after: Option<Entry>,
    #[serde(rename = "diffLines")]
    pub diff_lines: Option<Vec<DiffLine>>,
    pub diagnostics: Option<Vec<LintDiagnostic>>,
    #[serde(rename = "groupPropagation")]
    pub group_propagation: Option<Vec<GroupPropagationNotice>>,
    #[serde(rename = "conflictWarning")]
    pub conflict_warning: Option<String>,
}
