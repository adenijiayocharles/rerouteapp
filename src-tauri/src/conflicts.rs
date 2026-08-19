//! Detects hostnames that more than one *enabled* entry claims with a
//! different active IP. A real `/etc/hosts` file silently uses whichever
//! line comes first for a given hostname, so without this the losing
//! entry's active IP would just never actually take effect — no error, no
//! write failure, nothing to notice until something doesn't resolve where
//! expected.

use std::collections::{HashMap, HashSet};

use serde::Serialize;

use crate::models::Entry;
use crate::validate;

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct ConflictMember {
    #[serde(rename = "entryId")]
    pub entry_id: String,
    pub hostname: String,
    pub ip: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Conflict {
    pub hostname: String,
    pub members: Vec<ConflictMember>,
}

/// Only considers enabled entries (a disabled entry's line is commented
/// out, so it can't actually conflict with anything). Entries whose
/// hostname field holds several space/comma-separated hostnames are
/// split first; comparison is case-insensitive, matching hosts-file/DNS
/// lookup semantics. Returned sorted by hostname for stable output.
pub fn find_conflicts(entries: &[Entry]) -> Vec<Conflict> {
    // Value is (first-seen original-case single hostname, members) — the
    // map key has to be lowercased for case-insensitive grouping, but that
    // key must never leak into `Conflict.hostname`: it would show the user
    // an all-lowercase hostname that doesn't match what they actually typed
    // or see anywhere else in the UI.
    let mut by_hostname: HashMap<String, (String, Vec<ConflictMember>)> = HashMap::new();

    for entry in entries.iter().filter(|e| e.enabled) {
        let Some(active_ip) = entry.ips.iter().find(|ip| ip.id == entry.active_ip_id) else {
            continue;
        };
        for hostname in validate::split_hostnames(&entry.hostname) {
            let bucket = by_hostname.entry(hostname.to_lowercase()).or_insert_with(|| (hostname.clone(), Vec::new()));
            bucket.1.push(ConflictMember {
                entry_id: entry.id.clone(),
                hostname: entry.hostname.clone(),
                ip: active_ip.ip.clone(),
            });
        }
    }

    let mut conflicts: Vec<Conflict> = by_hostname
        .into_values()
        .filter_map(|(hostname, members)| {
            let distinct_ips: HashSet<&str> = members.iter().map(|m| m.ip.as_str()).collect();
            (distinct_ips.len() > 1).then_some(Conflict { hostname, members })
        })
        .collect();

    conflicts.sort_by_key(|c| c.hostname.to_lowercase());
    conflicts
}

/// A one-line warning for the diff/toast surfaces when saving, switching,
/// or toggling `entry_id` would leave it (still) in conflict — `None` if
/// it doesn't participate in any of `conflicts`.
pub fn warning_for_entry(conflicts: &[Conflict], entry_id: &str) -> Option<String> {
    let hostnames: Vec<&str> = conflicts
        .iter()
        .filter(|c| c.members.iter().any(|m| m.entry_id == entry_id))
        .map(|c| c.hostname.as_str())
        .collect();
    if hostnames.is_empty() {
        return None;
    }
    Some(format!(
        "\u{201c}{}\u{201d} also resolves to a different address on another enabled entry — only one will actually take effect.",
        hostnames.join("\u{201d}, \u{201c}")
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::IpCandidate;

    fn entry(id: &str, hostname: &str, enabled: bool, ip: &str) -> Entry {
        Entry {
            id: id.to_string(),
            hostname: hostname.to_string(),
            comment: String::new(),
            group: String::new(),
            enabled,
            favorite: false,
            active_ip_id: "ip-1".to_string(),
            ips: vec![IpCandidate { id: "ip-1".to_string(), label: String::new(), ip: ip.to_string() }],
            last_modified: String::new(),
        }
    }

    #[test]
    fn no_conflicts_among_disjoint_hostnames() {
        let entries = vec![entry("a", "one.local", true, "10.0.0.1"), entry("b", "two.local", true, "10.0.0.2")];
        assert!(find_conflicts(&entries).is_empty());
    }

    #[test]
    fn no_conflict_when_same_hostname_shares_the_same_ip() {
        let entries = vec![entry("a", "api.local", true, "10.0.0.1"), entry("b", "api.local", true, "10.0.0.1")];
        assert!(find_conflicts(&entries).is_empty());
    }

    #[test]
    fn detects_conflict_across_two_enabled_entries() {
        let entries = vec![entry("a", "api.local", true, "10.0.0.1"), entry("b", "api.local", true, "10.0.0.2")];
        let conflicts = find_conflicts(&entries);
        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].hostname, "api.local");
        assert_eq!(conflicts[0].members.len(), 2);
    }

    #[test]
    fn ignores_disabled_entries() {
        let entries = vec![entry("a", "api.local", true, "10.0.0.1"), entry("b", "api.local", false, "10.0.0.2")];
        assert!(find_conflicts(&entries).is_empty());
    }

    #[test]
    fn detects_conflict_within_a_multi_hostname_field() {
        let entries = vec![entry("a", "api.local, api.test", true, "10.0.0.1"), entry("b", "api.test", true, "10.0.0.2")];
        let conflicts = find_conflicts(&entries);
        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].hostname, "api.test");
    }

    #[test]
    fn comparison_is_case_insensitive() {
        let entries = vec![entry("a", "API.local", true, "10.0.0.1"), entry("b", "api.local", true, "10.0.0.2")];
        let conflicts = find_conflicts(&entries);
        assert_eq!(conflicts.len(), 1);
        // Still matched as the same hostname despite the case difference,
        // but displayed as the first entry actually typed it rather than
        // silently lowercased.
        assert_eq!(conflicts[0].hostname, "API.local");
    }

    #[test]
    fn warning_for_entry_names_only_that_entrys_conflicting_hostnames() {
        let entries = vec![
            entry("a", "api.local", true, "10.0.0.1"),
            entry("b", "api.local", true, "10.0.0.2"),
            entry("c", "other.local", true, "10.0.0.3"),
        ];
        let conflicts = find_conflicts(&entries);
        assert!(warning_for_entry(&conflicts, "a").unwrap().contains("api.local"));
        assert!(warning_for_entry(&conflicts, "c").is_none());
    }
}
