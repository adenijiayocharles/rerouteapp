use std::fs;
use std::fs::OpenOptions;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::models::Entry;
use crate::validate;

pub const START_MARKER: &str = "# hosts-manager:start";
pub const END_MARKER: &str = "# hosts-manager:end";

/// Docker Desktop writes and rewrites this exact block itself; lines
/// inside it are never offered for adoption so the app never fights it
/// for ownership of `kubernetes.docker.internal`.
const DOCKER_DESKTOP_START: &str = "# Added by Docker Desktop";
const DOCKER_DESKTOP_END: &str = "# End of section";

/// Returns the OS-specific hosts file path.
#[cfg(any(target_os = "macos", target_os = "linux"))]
pub fn hosts_file_path() -> PathBuf {
    PathBuf::from("/etc/hosts")
}

#[cfg(target_os = "windows")]
pub fn hosts_file_path() -> PathBuf {
    let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string());
    PathBuf::from(system_root)
        .join("System32")
        .join("drivers")
        .join("etc")
        .join("hosts")
}

/// A hosts file split into the app-managed block and everything else.
/// `prefix`/`suffix` are preserved verbatim (never rewritten) so manually
/// added comments, blank lines, and entries outside the managed block
/// survive round-trip untouched.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedHostsFile {
    pub prefix: Vec<String>,
    pub suffix: Vec<String>,
    pub had_managed_block: bool,
    pub trailing_newline: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedManagedLine {
    pub enabled: bool,
    pub ip: String,
    pub hostname: String,
    pub comment: String,
}

/// Finds the 0-based line indices of the start/end managed-block markers,
/// if both are present and in order. Shared by `parse()` (which needs to
/// split prefix/suffix around them) and the raw-editor lint pass (which
/// needs to map diagnostics back to original file line numbers).
pub fn find_managed_block_bounds(content: &str) -> Option<(usize, usize)> {
    let lines: Vec<&str> = content.lines().collect();
    let start_idx = lines.iter().position(|l| l.trim_end() == START_MARKER)?;
    let end_idx = lines.iter().position(|l| l.trim_end() == END_MARKER)?;
    if end_idx > start_idx {
        Some((start_idx, end_idx))
    } else {
        None
    }
}

pub fn parse(content: &str) -> ParsedHostsFile {
    let lines: Vec<String> = content.lines().map(|s| s.to_string()).collect();
    let trailing_newline = !content.is_empty() && content.ends_with('\n');

    if let Some((start, end)) = find_managed_block_bounds(content) {
        return ParsedHostsFile {
            prefix: lines[..start].to_vec(),
            suffix: lines[end + 1..].to_vec(),
            had_managed_block: true,
            trailing_newline,
        };
    }

    ParsedHostsFile {
        prefix: lines,
        suffix: Vec::new(),
        had_managed_block: false,
        trailing_newline,
    }
}

/// Parses the raw lines that were captured between the markers into
/// structured entries. Used to seed the database on first run against a
/// hosts file that already has an app-managed block (e.g. a prior install).
pub fn parse_managed_block(content: &str) -> Vec<ParsedManagedLine> {
    let Some((start, end)) = find_managed_block_bounds(content) else {
        return Vec::new();
    };
    let lines: Vec<&str> = content.lines().collect();
    lines[start + 1..end]
        .iter()
        .filter_map(|l| parse_managed_line(l))
        .collect()
}

fn parse_managed_line(raw: &str) -> Option<ParsedManagedLine> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let enabled = !trimmed.starts_with('#');
    let body = if enabled {
        trimmed
    } else {
        trimmed.trim_start_matches('#').trim_start()
    };
    if body.is_empty() {
        return None;
    }
    let (main, comment) = match body.find('#') {
        Some(idx) => (body[..idx].trim(), body[idx + 1..].trim().to_string()),
        None => (body, String::new()),
    };
    let mut parts = main.split_whitespace();
    let ip = parts.next()?.to_string();
    // A line can list multiple hostnames for the same IP (standard hosts
    // file syntax); keep them all, space-joined, rather than just the first.
    let hostname_tokens: Vec<&str> = parts.collect();
    if hostname_tokens.is_empty() {
        return None;
    }
    let hostname = hostname_tokens.join(" ");
    Some(ParsedManagedLine {
        enabled,
        ip,
        hostname,
        comment,
    })
}

/// A plain hostname entry that lives outside the app-managed block —
/// something the user (or another tool) added directly to the hosts file.
/// `id` is the 0-based line number the entry currently occupies, which is
/// how `remove_unmanaged_line` locates it again when adopting it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct UnmanagedEntry {
    pub id: String,
    pub ip: String,
    pub hostname: String,
    pub comment: String,
}

/// System-critical names that must never be offered for adoption: toggling
/// or deleting them through the app (or losing them to a stray edit) can
/// break loopback resolution for the whole machine.
fn is_system_hostname(hostname: &str) -> bool {
    hostname
        .split_whitespace()
        .any(|h| h.eq_ignore_ascii_case("localhost") || h.eq_ignore_ascii_case("broadcasthost"))
}

/// Parses a raw, non-managed hosts-file line into `(ip, hostname, comment)`.
/// Unlike `parse_managed_line`, a leading `#` here means "comment", not
/// "disabled" — the app-managed disabled-entry convention only applies
/// inside its own block.
fn parse_unmanaged_line(raw: &str) -> Option<(String, String, String)> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.starts_with('#') {
        return None;
    }
    let (main, comment) = match trimmed.find('#') {
        Some(idx) => (trimmed[..idx].trim(), trimmed[idx + 1..].trim().to_string()),
        None => (trimmed, String::new()),
    };
    let mut parts = main.split_whitespace();
    let ip = parts.next()?.to_string();
    if !validate::is_valid_ip(&ip) {
        return None;
    }
    let hostname_tokens: Vec<&str> = parts.collect();
    if hostname_tokens.is_empty() {
        return None;
    }
    Some((ip, hostname_tokens.join(" "), comment))
}

/// Finds plain hostname entries outside the app-managed block that are
/// safe to offer for one-click adoption into it. Excludes the managed
/// block itself (already represented by the app's own entries), system
/// names (`localhost`/`broadcasthost`), and Docker Desktop's own section.
pub fn list_unmanaged_entries(content: &str) -> Vec<UnmanagedEntry> {
    let lines: Vec<&str> = content.lines().collect();
    let managed_bounds = find_managed_block_bounds(content);
    let mut in_docker_block = false;
    let mut out = Vec::new();
    for (idx, raw) in lines.iter().enumerate() {
        if let Some((start, end)) = managed_bounds {
            if idx >= start && idx <= end {
                continue;
            }
        }
        let trimmed = raw.trim();
        if trimmed == DOCKER_DESKTOP_START {
            in_docker_block = true;
        }
        if in_docker_block {
            if trimmed == DOCKER_DESKTOP_END {
                in_docker_block = false;
            }
            continue;
        }
        let Some((ip, hostname, comment)) = parse_unmanaged_line(raw) else {
            continue;
        };
        if is_system_hostname(&hostname) {
            continue;
        }
        out.push(UnmanagedEntry {
            id: idx.to_string(),
            ip,
            hostname,
            comment,
        });
    }
    out
}

/// Removes the unmanaged line at `line_index` after verifying it still
/// matches what was listed (guards against the file having changed since,
/// e.g. an external edit), returning the reparsed file with that line
/// gone. The caller then renders it back out alongside the newly adopted
/// DB entry, so the line moves from raw text into the managed block in
/// the same write.
pub fn remove_unmanaged_line(
    content: &str,
    line_index: usize,
    expected_ip: &str,
    expected_hostname: &str,
    expected_comment: &str,
) -> Option<ParsedHostsFile> {
    let lines: Vec<&str> = content.lines().collect();
    let raw = *lines.get(line_index)?;
    let (ip, hostname, comment) = parse_unmanaged_line(raw)?;
    if ip != expected_ip || hostname != expected_hostname || comment != expected_comment {
        return None;
    }
    let mut kept = lines;
    kept.remove(line_index);
    let mut new_content = kept.join("\n");
    if content.ends_with('\n') && !kept.is_empty() {
        new_content.push('\n');
    }
    Some(parse(&new_content))
}

/// Builds the single hosts-file line for an entry, using its active IP.
/// A disabled entry is written with a leading `#` rather than being removed.
pub fn build_line(entry: &Entry) -> String {
    let ip = entry
        .ips
        .iter()
        .find(|i| i.id == entry.active_ip_id)
        .or_else(|| entry.ips.first());
    let ip_str = ip.map(|i| i.ip.as_str()).unwrap_or("0.0.0.0");
    let core = if entry.comment.trim().is_empty() {
        format!("{}\t{}", ip_str, entry.hostname)
    } else {
        format!("{}\t{}    # {}", ip_str, entry.hostname, entry.comment)
    };
    if entry.enabled {
        core
    } else {
        format!("#{}", core)
    }
}

/// Reconstructs the full hosts file content: preserved prefix, then the
/// regenerated managed block (skipped entirely if there are no entries),
/// then the preserved suffix. Entries are rendered in the order given,
/// which callers control via a stable order_index, so re-rendering after
/// an in-place edit doesn't reshuffle existing lines.
pub fn render(parsed: &ParsedHostsFile, entries: &[Entry]) -> String {
    let mut out_lines: Vec<String> = parsed.prefix.clone();

    if !entries.is_empty() {
        if let Some(last) = out_lines.last() {
            if !last.trim().is_empty() {
                out_lines.push(String::new());
            }
        }
        out_lines.push(START_MARKER.to_string());
        for entry in entries {
            out_lines.push(build_line(entry));
        }
        out_lines.push(END_MARKER.to_string());
    }

    out_lines.extend(parsed.suffix.clone());

    let mut out = out_lines.join("\n");
    let final_trailing_newline = if entries.is_empty() {
        parsed.trailing_newline
    } else {
        true
    };
    if final_trailing_newline && !out.is_empty() {
        out.push('\n');
    }
    out
}

/// Writes `content` to `path` atomically: write to a temp file in the same
/// directory, fsync, then rename over the target. Used for unprivileged
/// targets (e.g. tests, staging files); privileged writes to the real
/// hosts file go through `elevate::write_hosts_file`, which performs the
/// final rename with elevated permissions.
pub fn atomic_write(path: &Path, content: &str) -> io::Result<()> {
    let dir = path.parent().unwrap_or_else(|| Path::new("."));
    let tmp_path = dir.join(format!(
        ".{}.tmp-{}",
        path.file_name().and_then(|n| n.to_str()).unwrap_or("hosts"),
        std::process::id()
    ));
    {
        let mut f = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&tmp_path)?;
        f.write_all(content.as_bytes())?;
        f.sync_all()?;
    }
    fs::rename(&tmp_path, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::IpCandidate;

    fn entry(id: &str, hostname: &str, ip: &str, enabled: bool, comment: &str) -> Entry {
        Entry {
            id: id.to_string(),
            hostname: hostname.to_string(),
            comment: comment.to_string(),
            group: String::new(),
            enabled,
            active_ip_id: "ip1".to_string(),
            ips: vec![IpCandidate {
                id: "ip1".to_string(),
                label: "Local".to_string(),
                ip: ip.to_string(),
            }],
            last_modified: "now".to_string(),
        }
    }

    #[test]
    fn round_trip_preserves_unmanaged_content_with_no_entries() {
        let original = "127.0.0.1\tlocalhost\n# a manual comment\n\nfe80::1%lo0 localhost\n";
        let parsed = parse(original);
        assert!(!parsed.had_managed_block);
        let rendered = render(&parsed, &[]);
        assert_eq!(rendered, original);
    }

    #[test]
    fn round_trip_preserves_content_without_trailing_newline() {
        let original = "127.0.0.1\tlocalhost";
        let parsed = parse(original);
        let rendered = render(&parsed, &[]);
        assert_eq!(rendered, original);
    }

    #[test]
    fn round_trip_empty_file() {
        let parsed = parse("");
        let rendered = render(&parsed, &[]);
        assert_eq!(rendered, "");
    }

    #[test]
    fn adds_managed_block_around_existing_content() {
        let original = "127.0.0.1\tlocalhost\n# my manual note\n";
        let parsed = parse(original);
        let entries = vec![entry("e1", "api.myapp.local", "127.0.0.1", true, "gateway")];
        let rendered = render(&parsed, &entries);
        assert!(rendered.starts_with("127.0.0.1\tlocalhost\n# my manual note\n\n# hosts-manager:start\n"));
        assert!(rendered.contains("127.0.0.1\tapi.myapp.local    # gateway\n"));
        assert!(rendered.trim_end().ends_with("# hosts-manager:end"));
    }

    #[test]
    fn disabled_entry_gets_leading_hash() {
        let line = build_line(&entry("e1", "cdn.myapp.dev", "203.0.113.44", false, ""));
        assert_eq!(line, "#203.0.113.44\tcdn.myapp.dev");
    }

    #[test]
    fn build_line_writes_multiple_space_separated_hostnames() {
        let line = build_line(&entry("e1", "api.myapp.local admin.myapp.local", "127.0.0.1", true, ""));
        assert_eq!(line, "127.0.0.1\tapi.myapp.local admin.myapp.local");
    }

    #[test]
    fn managed_block_round_trips_with_unmanaged_lines_untouched() {
        let original = format!(
            "# top comment\n127.0.0.1\tlocalhost\n\n{}\n10.0.0.5\told.host    # stale\n{}\n\n# bottom comment\n",
            START_MARKER, END_MARKER
        );
        let parsed = parse(&original);
        assert!(parsed.had_managed_block);
        assert_eq!(parsed.prefix, vec!["# top comment", "127.0.0.1\tlocalhost", ""]);
        assert_eq!(parsed.suffix, vec!["", "# bottom comment"]);

        let entries = vec![entry("e1", "api.myapp.local", "10.20.1.15", true, "staging")];
        let rendered = render(&parsed, &entries);
        assert!(rendered.contains("# top comment"));
        assert!(rendered.contains("# bottom comment"));
        assert!(!rendered.contains("old.host"));
        assert!(rendered.contains("10.20.1.15\tapi.myapp.local    # staging"));
    }

    #[test]
    fn removing_all_entries_drops_the_managed_block_entirely() {
        let original = format!(
            "127.0.0.1\tlocalhost\n{}\n10.0.0.5\thost.example\n{}\n",
            START_MARKER, END_MARKER
        );
        let parsed = parse(&original);
        let rendered = render(&parsed, &[]);
        assert!(!rendered.contains(START_MARKER));
        assert!(!rendered.contains(END_MARKER));
        assert_eq!(rendered, "127.0.0.1\tlocalhost\n");
    }

    #[test]
    fn parses_existing_managed_block_for_first_run_import() {
        let original = format!(
            "127.0.0.1\tlocalhost\n{}\n10.0.0.5\tapi.local    # note\n#10.0.0.6\tdisabled.local\n{}\n",
            START_MARKER, END_MARKER
        );
        let parsed = parse_managed_block(&original);
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].ip, "10.0.0.5");
        assert_eq!(parsed[0].hostname, "api.local");
        assert_eq!(parsed[0].comment, "note");
        assert!(parsed[0].enabled);
        assert_eq!(parsed[1].hostname, "disabled.local");
        assert!(!parsed[1].enabled);
    }

    #[test]
    fn parses_multiple_hostnames_on_one_line() {
        let original = format!(
            "{}\n127.0.0.1\tapi.local admin.local    # note\n{}\n",
            START_MARKER, END_MARKER
        );
        let parsed = parse_managed_block(&original);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].hostname, "api.local admin.local");
        assert_eq!(parsed[0].comment, "note");
    }

    #[test]
    fn lists_plain_unmanaged_entries_outside_the_managed_block() {
        let original = format!(
            "127.0.0.1\tlocalhost\n255.255.255.255\tbroadcasthost\n::1\tlocalhost\n127.0.0.1\tavionexus.test\n\n{}\n127.0.0.1\tmail.com\n{}\n",
            START_MARKER, END_MARKER
        );
        let unmanaged = list_unmanaged_entries(&original);
        assert_eq!(unmanaged.len(), 1);
        assert_eq!(unmanaged[0].hostname, "avionexus.test");
        assert_eq!(unmanaged[0].ip, "127.0.0.1");
    }

    #[test]
    fn excludes_system_hostnames_and_docker_desktop_section() {
        let original = "127.0.0.1\tlocalhost\n255.255.255.255\tbroadcasthost\n::1\tlocalhost\n\
# Added by Docker Desktop\n\
# To allow the same kube context to work on the host and the container:\n\
127.0.0.1\tkubernetes.docker.internal\n\
# End of section\n\
127.0.0.1\tavionexus.test\n";
        let unmanaged = list_unmanaged_entries(original);
        assert_eq!(unmanaged.len(), 1);
        assert_eq!(unmanaged[0].hostname, "avionexus.test");
    }

    #[test]
    fn excludes_lines_that_are_not_valid_entries() {
        let original = "## Host Database ##\n# a comment\n\n127.0.0.1\tavionexus.test\n";
        let unmanaged = list_unmanaged_entries(original);
        assert_eq!(unmanaged.len(), 1);
        assert_eq!(unmanaged[0].hostname, "avionexus.test");
    }

    #[test]
    fn parses_trailing_comment_on_unmanaged_line() {
        let original = "::1\ttest.local # Local Site\n";
        let unmanaged = list_unmanaged_entries(original);
        assert_eq!(unmanaged.len(), 1);
        assert_eq!(unmanaged[0].ip, "::1");
        assert_eq!(unmanaged[0].hostname, "test.local");
        assert_eq!(unmanaged[0].comment, "Local Site");
    }

    #[test]
    fn removes_unmanaged_line_after_verifying_it_still_matches() {
        let original = "127.0.0.1\tlocalhost\n127.0.0.1\tavionexus.test\n10.0.0.5\tother.test\n";
        let unmanaged = list_unmanaged_entries(original);
        let target = unmanaged.iter().find(|u| u.hostname == "avionexus.test").unwrap();
        let line_index: usize = target.id.parse().unwrap();

        let parsed = remove_unmanaged_line(original, line_index, &target.ip, &target.hostname, &target.comment).unwrap();
        let rendered = render(&parsed, &[]);
        assert_eq!(rendered, "127.0.0.1\tlocalhost\n10.0.0.5\tother.test\n");
    }

    #[test]
    fn batch_removal_highest_index_first_does_not_shift_later_indices() {
        // Mirrors confirm_adopt_many's algorithm: resolve all target lines
        // against the original content up front, then remove them highest
        // line-index first, re-rendering with the *pre-adopt* managed
        // entries between steps so the managed block's line count (and
        // therefore every other line's absolute index) never moves.
        let pre_adopt_entries = vec![entry("e1", "mail.com", "127.0.0.1", true, "")];
        let original = format!(
            "127.0.0.1\tkeep-one.test\n127.0.0.1\tadopt-a.test\n127.0.0.1\tkeep-two.test\n{}\n127.0.0.1\tmail.com\n{}\n127.0.0.1\tadopt-b.test\n127.0.0.1\tkeep-three.test\n",
            START_MARKER, END_MARKER
        );

        let unmanaged = list_unmanaged_entries(&original);
        let targets: Vec<_> = unmanaged.into_iter().filter(|u| u.hostname.starts_with("adopt-")).collect();
        assert_eq!(targets.len(), 2);
        let mut targets = targets;
        targets.sort_by_key(|u| std::cmp::Reverse(u.id.parse::<usize>().unwrap()));

        let mut content = original;
        for t in &targets {
            let line_index: usize = t.id.parse().unwrap();
            let parsed = remove_unmanaged_line(&content, line_index, &t.ip, &t.hostname, &t.comment).unwrap();
            content = render(&parsed, &pre_adopt_entries);
        }

        assert_eq!(
            content,
            format!(
                "127.0.0.1\tkeep-one.test\n127.0.0.1\tkeep-two.test\n\n{}\n127.0.0.1\tmail.com\n{}\n127.0.0.1\tkeep-three.test\n",
                START_MARKER, END_MARKER
            )
        );
    }

    #[test]
    fn remove_unmanaged_line_fails_if_content_changed_since_listing() {
        let original = "127.0.0.1\tavionexus.test\n";
        let result = remove_unmanaged_line(original, 0, "127.0.0.1", "different.test", "");
        assert!(result.is_none());
    }

    #[test]
    fn atomic_write_round_trips_via_tempdir() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("hosts");
        atomic_write(&path, "127.0.0.1\tlocalhost\n").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "127.0.0.1\tlocalhost\n");
        atomic_write(&path, "10.0.0.1\tupdated\n").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "10.0.0.1\tupdated\n");
    }

    #[test]
    fn parse_render_10k_line_file_is_fast_and_lossless() {
        let mut original = String::new();
        for i in 0..10_000 {
            original.push_str(&format!("10.0.{}.{}\thost{}.example\n", i / 256, i % 256, i));
        }
        let start = std::time::Instant::now();
        let parsed = parse(&original);
        let rendered = render(&parsed, &[]);
        let elapsed = start.elapsed();
        assert_eq!(rendered, original);
        assert!(
            elapsed.as_millis() < 200,
            "parse+render of 10k lines took {elapsed:?}, expected < 200ms"
        );
    }
}
