use serde::{Deserialize, Serialize};

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

#[derive(Serialize, Clone, Debug)]
pub struct DiffPreview {
    pub mode: String, // "save" | "restore" | "view"
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
}
