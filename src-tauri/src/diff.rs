use serde::Serialize;

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct DiffLine {
    pub kind: String,
    pub text: String,
}

/// The LCS DP table below is O(n*m) memory. A common prefix/suffix is
/// always part of every optimal alignment, so trimming it first shrinks
/// the table to just the part that actually differs — for a large hosts
/// file (ad-block-style lists commonly run tens of thousands of lines)
/// edited in one place, that's the difference between a handful of cells
/// and tens of gigabytes for what's really a one-line change.
pub fn diff_lines(old: &str, new: &str) -> Vec<DiffLine> {
    let old_lines: Vec<&str> = old.lines().collect();
    let new_lines: Vec<&str> = new.lines().collect();

    let mut prefix = 0;
    while prefix < old_lines.len() && prefix < new_lines.len() && old_lines[prefix] == new_lines[prefix] {
        prefix += 1;
    }
    let mut suffix = 0;
    while suffix < old_lines.len() - prefix
        && suffix < new_lines.len() - prefix
        && old_lines[old_lines.len() - 1 - suffix] == new_lines[new_lines.len() - 1 - suffix]
    {
        suffix += 1;
    }

    let old_mid = &old_lines[prefix..old_lines.len() - suffix];
    let new_mid = &new_lines[prefix..new_lines.len() - suffix];

    let mut result: Vec<DiffLine> = old_lines[..prefix]
        .iter()
        .map(|l| DiffLine { kind: "same".to_string(), text: l.to_string() })
        .collect();
    result.extend(diff_middle(old_mid, new_mid));
    result.extend(
        old_lines[old_lines.len() - suffix..]
            .iter()
            .map(|l| DiffLine { kind: "same".to_string(), text: l.to_string() }),
    );
    result
}

/// Above this many DP cells (~32MB of `usize`), skip the optimal LCS
/// alignment and fall back to a plain remove-all/add-all split for this
/// slice. Still correct (every line accounted for as removed or added),
/// just not minimal — a defense-in-depth cap so a pathological "replace
/// everything" edit can't allocate unbounded memory, independent of the
/// prefix/suffix trim above (which only helps when most content is
/// unchanged).
const MAX_DP_CELLS: usize = 4_000_000;

fn diff_middle(old_lines: &[&str], new_lines: &[&str]) -> Vec<DiffLine> {
    let n = old_lines.len();
    let m = new_lines.len();

    if n.saturating_mul(m) > MAX_DP_CELLS {
        let mut result: Vec<DiffLine> =
            old_lines.iter().map(|l| DiffLine { kind: "removed".to_string(), text: l.to_string() }).collect();
        result.extend(new_lines.iter().map(|l| DiffLine { kind: "added".to_string(), text: l.to_string() }));
        return result;
    }

    // Flat Vec instead of Vec<Vec<_>>: one allocation instead of n+1, and
    // cells in the same row stay contiguous, which matters for a table that
    // can legitimately reach MAX_DP_CELLS entries.
    let width = m + 1;
    let mut dp = vec![0usize; (n + 1) * width];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            dp[i * width + j] = if old_lines[i] == new_lines[j] {
                dp[(i + 1) * width + (j + 1)] + 1
            } else {
                dp[(i + 1) * width + j].max(dp[i * width + (j + 1)])
            };
        }
    }

    let mut result = Vec::new();
    let (mut i, mut j) = (0, 0);
    while i < n && j < m {
        if old_lines[i] == new_lines[j] {
            result.push(DiffLine { kind: "same".to_string(), text: old_lines[i].to_string() });
            i += 1;
            j += 1;
        } else if dp[(i + 1) * width + j] >= dp[i * width + (j + 1)] {
            result.push(DiffLine { kind: "removed".to_string(), text: old_lines[i].to_string() });
            i += 1;
        } else {
            result.push(DiffLine { kind: "added".to_string(), text: new_lines[j].to_string() });
            j += 1;
        }
    }
    while i < n {
        result.push(DiffLine { kind: "removed".to_string(), text: old_lines[i].to_string() });
        i += 1;
    }
    while j < m {
        result.push(DiffLine { kind: "added".to_string(), text: new_lines[j].to_string() });
        j += 1;
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identical_content_is_all_same() {
        let content = "a\nb\nc";
        let result = diff_lines(content, content);
        assert_eq!(result.len(), 3);
        assert!(result.iter().all(|l| l.kind == "same"));
    }

    #[test]
    fn pure_addition_is_all_added_lines() {
        let result = diff_lines("a\nb", "a\nb\nc");
        assert_eq!(
            result,
            vec![
                DiffLine { kind: "same".to_string(), text: "a".to_string() },
                DiffLine { kind: "same".to_string(), text: "b".to_string() },
                DiffLine { kind: "added".to_string(), text: "c".to_string() },
            ]
        );
    }

    #[test]
    fn pure_removal_is_all_removed_lines() {
        let result = diff_lines("a\nb\nc", "a\nb");
        assert_eq!(
            result,
            vec![
                DiffLine { kind: "same".to_string(), text: "a".to_string() },
                DiffLine { kind: "same".to_string(), text: "b".to_string() },
                DiffLine { kind: "removed".to_string(), text: "c".to_string() },
            ]
        );
    }

    #[test]
    fn changed_line_is_removed_then_added() {
        let result = diff_lines("127.0.0.1\told.local", "127.0.0.1\tnew.local");
        assert_eq!(
            result,
            vec![
                DiffLine { kind: "removed".to_string(), text: "127.0.0.1\told.local".to_string() },
                DiffLine { kind: "added".to_string(), text: "127.0.0.1\tnew.local".to_string() },
            ]
        );
    }

    #[test]
    fn empty_old_is_all_added() {
        let result = diff_lines("", "a\nb");
        assert_eq!(
            result,
            vec![
                DiffLine { kind: "added".to_string(), text: "a".to_string() },
                DiffLine { kind: "added".to_string(), text: "b".to_string() },
            ]
        );
    }

    #[test]
    fn empty_new_is_all_removed() {
        let result = diff_lines("a\nb", "");
        assert_eq!(
            result,
            vec![
                DiffLine { kind: "removed".to_string(), text: "a".to_string() },
                DiffLine { kind: "removed".to_string(), text: "b".to_string() },
            ]
        );
    }

    #[test]
    fn large_file_with_one_changed_line_is_fast_and_minimal() {
        let mut old_lines = Vec::new();
        for i in 0..60_000 {
            old_lines.push(format!("10.0.{}.{}\thost{}.example", i / 256, i % 256, i));
        }
        let mut new_lines = old_lines.clone();
        new_lines[30_000] = "10.0.99.99\tchanged.example".to_string();
        let old = old_lines.join("\n");
        let new = new_lines.join("\n");

        let start = std::time::Instant::now();
        let result = diff_lines(&old, &new);
        let elapsed = start.elapsed();

        assert!(elapsed.as_millis() < 500, "diff of a 60k-line file with one changed line took {elapsed:?}");
        let changed: Vec<_> = result.iter().filter(|l| l.kind != "same").collect();
        assert_eq!(changed.len(), 2, "expected exactly one removed + one added line, got {changed:?}");
        assert_eq!(changed[0].kind, "removed");
        assert_eq!(changed[1].kind, "added");
        assert_eq!(changed[1].text, "10.0.99.99\tchanged.example");
    }

    #[test]
    fn wholly_different_large_files_fall_back_without_hanging() {
        let old: String = (0..3000).map(|i| format!("10.0.0.{}\told{}.example\n", i % 256, i)).collect();
        let new: String = (0..3000).map(|i| format!("10.0.1.{}\tnew{}.example\n", i % 256, i)).collect();

        let start = std::time::Instant::now();
        let result = diff_lines(&old, &new);
        let elapsed = start.elapsed();

        assert!(elapsed.as_millis() < 2000, "fallback diff of two disjoint 3k-line files took {elapsed:?}");
        assert_eq!(result.len(), 6000);
        assert!(result[..3000].iter().all(|l| l.kind == "removed"));
        assert!(result[3000..].iter().all(|l| l.kind == "added"));
    }
}
