use serde::Serialize;

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct DiffLine {
    pub kind: String,
    pub text: String,
}

pub fn diff_lines(old: &str, new: &str) -> Vec<DiffLine> {
    let old_lines: Vec<&str> = old.lines().collect();
    let new_lines: Vec<&str> = new.lines().collect();
    let n = old_lines.len();
    let m = new_lines.len();

    let mut dp = vec![vec![0usize; m + 1]; n + 1];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            dp[i][j] = if old_lines[i] == new_lines[j] {
                dp[i + 1][j + 1] + 1
            } else {
                dp[i + 1][j].max(dp[i][j + 1])
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
        } else if dp[i + 1][j] >= dp[i][j + 1] {
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
}
