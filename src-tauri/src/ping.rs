//! Post-switch reachability probe for an IP candidate: shells out to the
//! OS `ping` binary (one packet, ~1s timeout) rather than opening a raw
//! socket, matching `dns_flush.rs`'s pattern of delegating to native OS
//! tooling instead of reimplementing platform-specific network plumbing —
//! and sidestepping the fact that raw ICMP sockets need root on most of
//! these platforms, while the `ping` binary is already permitted to send
//! them.
//!
//! `-W`'s unit differs by platform (BSD/macOS: milliseconds, Linux:
//! seconds), so each OS gets its own argument list rather than one shared
//! `#[cfg(any(...))]` implementation.

use serde::Serialize;

pub const IP_HEALTH_CHECKED_EVENT: &str = "ip-health-checked";

#[derive(Serialize, Clone)]
pub struct IpHealthResult {
    #[serde(rename = "entryId")]
    pub entry_id: String,
    #[serde(rename = "ipId")]
    pub ip_id: String,
    pub reachable: bool,
}

#[cfg(target_os = "macos")]
pub fn is_reachable(ip: &str) -> bool {
    std::process::Command::new("ping")
        .args(["-c", "1", "-W", "1000", ip])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[cfg(target_os = "linux")]
pub fn is_reachable(ip: &str) -> bool {
    std::process::Command::new("ping")
        .args(["-c", "1", "-W", "1", ip])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
pub fn is_reachable(ip: &str) -> bool {
    std::process::Command::new("ping")
        .args(["-n", "1", "-w", "1000", ip])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loopback_is_reachable() {
        assert!(is_reachable("127.0.0.1"));
    }
}
