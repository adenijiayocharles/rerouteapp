use std::collections::HashSet;

use serde::Serialize;

use crate::hosts_parser;
use crate::validate;

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct LintDiagnostic {
    pub line: usize,
    pub severity: String,
    pub message: String,
}

pub fn lint_managed_block(content: &str) -> Vec<LintDiagnostic> {
    let mut diagnostics = Vec::new();
    let Some((start, end)) = hosts_parser::find_managed_block_bounds(content) else {
        return diagnostics;
    };
    let lines: Vec<&str> = content.lines().collect();
    let mut seen_hostnames: HashSet<String> = HashSet::new();

    for (offset, raw) in lines[start + 1..end].iter().enumerate() {
        let line_no = start + 2 + offset;
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        let body = trimmed.trim_start_matches('#').trim_start();
        if body.is_empty() {
            continue;
        }
        let main = match body.find('#') {
            Some(idx) => body[..idx].trim(),
            None => body,
        };
        let mut parts = main.split_whitespace();
        let Some(ip) = parts.next() else {
            diagnostics.push(LintDiagnostic {
                line: line_no,
                severity: "error".to_string(),
                message: "Line isn't valid hosts-file syntax (expected: IP  hostname)".to_string(),
            });
            continue;
        };
        let hostname_tokens: Vec<&str> = parts.collect();
        if hostname_tokens.is_empty() {
            diagnostics.push(LintDiagnostic {
                line: line_no,
                severity: "error".to_string(),
                message: "Line isn't valid hosts-file syntax (expected: IP  hostname)".to_string(),
            });
            continue;
        }

        if !validate::is_valid_ip(ip) {
            diagnostics.push(LintDiagnostic {
                line: line_no,
                severity: "error".to_string(),
                message: format!("'{ip}' is not a valid IP address"),
            });
        }

        for h in &hostname_tokens {
            if !validate::is_valid_hostname(h) {
                diagnostics.push(LintDiagnostic {
                    line: line_no,
                    severity: "error".to_string(),
                    message: format!("'{h}' is not a valid hostname"),
                });
                continue;
            }
            if validate::is_shadow_domain(h) {
                diagnostics.push(LintDiagnostic {
                    line: line_no,
                    severity: "warning".to_string(),
                    message: format!("'{h}' is a reserved system hostname \u{2014} overriding it can affect the OS itself"),
                });
            }
            if !seen_hostnames.insert(h.to_string()) {
                diagnostics.push(LintDiagnostic {
                    line: line_no,
                    severity: "warning".to_string(),
                    message: format!("'{h}' is already defined on another line"),
                });
            }
        }
    }

    diagnostics
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wrap(body: &str) -> String {
        format!("{}\n{}\n{}\n", hosts_parser::START_MARKER, body, hosts_parser::END_MARKER)
    }

    #[test]
    fn valid_line_produces_no_diagnostics() {
        let content = wrap("127.0.0.1\tapi.local");
        assert!(lint_managed_block(&content).is_empty());
    }

    #[test]
    fn invalid_ip_is_an_error() {
        let content = wrap("999.1.1.1\tapi.local");
        let diags = lint_managed_block(&content);
        assert_eq!(diags.len(), 1);
        assert_eq!(diags[0].severity, "error");
        assert!(diags[0].message.contains("999.1.1.1"));
    }

    #[test]
    fn invalid_hostname_is_an_error() {
        let content = wrap("127.0.0.1\thas_underscore.com");
        let diags = lint_managed_block(&content);
        assert!(diags.iter().any(|d| d.severity == "error" && d.message.contains("has_underscore")));
    }

    #[test]
    fn multiple_valid_hostnames_on_one_line_produces_no_error() {
        let content = wrap("127.0.0.1\tapi.local admin.local");
        assert!(lint_managed_block(&content).is_empty());
    }

    #[test]
    fn shadow_domain_is_a_warning() {
        let content = wrap("127.0.0.1\tlocalhost");
        let diags = lint_managed_block(&content);
        assert_eq!(diags.len(), 1);
        assert_eq!(diags[0].severity, "warning");
        assert!(diags[0].message.contains("localhost"));
    }

    #[test]
    fn duplicate_hostname_is_a_warning() {
        let content = wrap("127.0.0.1\tapi.local\n10.0.0.2\tapi.local");
        let diags = lint_managed_block(&content);
        assert!(diags.iter().any(|d| d.severity == "warning" && d.message.contains("already defined")));
    }

    #[test]
    fn malformed_line_is_a_single_error() {
        let content = wrap("not-a-valid-line-at-all-just-one-token");
        let diags = lint_managed_block(&content);
        assert_eq!(diags.len(), 1);
        assert_eq!(diags[0].severity, "error");
    }

    #[test]
    fn line_numbers_account_for_content_before_the_managed_block() {
        let content = format!(
            "# a leading comment\n\n{}\n999.1.1.1\tbad.local\n{}\n",
            hosts_parser::START_MARKER,
            hosts_parser::END_MARKER
        );
        let diags = lint_managed_block(&content);
        assert_eq!(diags.len(), 1);
        assert_eq!(diags[0].line, 4);
    }

    #[test]
    fn content_with_no_managed_block_produces_no_diagnostics() {
        let content = "127.0.0.1\tlocalhost\n999.1.1.1\tbad-but-unmanaged.local\n";
        assert!(lint_managed_block(content).is_empty());
    }
}
