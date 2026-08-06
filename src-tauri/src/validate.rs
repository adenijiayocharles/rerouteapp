use std::net::IpAddr;
use std::str::FromStr;
use std::sync::OnceLock;

use regex::Regex;

const SHADOW_DOMAINS: &[&str] = &[
    "localhost",
    "localhost.localdomain",
    "broadcasthost",
    "ip6-localhost",
    "ip6-loopback",
    "ip6-allnodes",
    "ip6-allrouters",
];

fn label_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$").unwrap())
}

/// RFC 1123 hostname validation: dot-separated labels, each 1-63 chars,
/// alphanumeric start/end, hyphens allowed inside, total length <= 253.
pub fn is_valid_hostname(hostname: &str) -> bool {
    if hostname.is_empty() || hostname.len() > 253 {
        return false;
    }
    hostname.split('.').all(|label| label_re().is_match(label))
}

/// Accepts both IPv4 and IPv6 addresses.
pub fn is_valid_ip(ip: &str) -> bool {
    IpAddr::from_str(ip.trim()).is_ok()
}

pub fn is_shadow_domain(hostname: &str) -> bool {
    let lower = hostname.trim().to_lowercase();
    SHADOW_DOMAINS.contains(&lower.as_str())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_valid_hostnames() {
        for h in [
            "api.myapp.local",
            "localhost",
            "db.internal",
            "a.b.c.d.example.com",
            "xn--80ak6aa92e.com",
            "host-name.example",
        ] {
            assert!(is_valid_hostname(h), "expected {h} to be valid");
        }
    }

    #[test]
    fn rejects_invalid_hostnames() {
        for h in [
            "",
            "-leading-hyphen.com",
            "trailing-hyphen-.com",
            "double..dot.com",
            ".leading-dot.com",
            "has_underscore.com",
            "has space.com",
            &"a".repeat(64),
        ] {
            assert!(!is_valid_hostname(h), "expected {h} to be invalid");
        }
        assert!(!is_valid_hostname(&format!(
            "{}.com",
            "a".repeat(250)
        )));
    }

    #[test]
    fn accepts_valid_ips() {
        for ip in ["127.0.0.1", "10.20.1.15", "::1", "2001:db8::1", "0.0.0.0"] {
            assert!(is_valid_ip(ip), "expected {ip} to be valid");
        }
    }

    #[test]
    fn rejects_invalid_ips() {
        for ip in ["", "999.1.1.1", "not-an-ip", "127.0.0.1.1", "12345::1::2"] {
            assert!(!is_valid_ip(ip), "expected {ip} to be invalid");
        }
    }

    #[test]
    fn detects_shadow_domains() {
        assert!(is_shadow_domain("localhost"));
        assert!(is_shadow_domain("LocalHost"));
        assert!(is_shadow_domain("broadcasthost"));
        assert!(!is_shadow_domain("api.myapp.local"));
    }
}
