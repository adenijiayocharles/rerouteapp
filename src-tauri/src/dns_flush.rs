//! Per-OS DNS resolver cache flush commands. macOS is the real,
//! tested-on-this-machine path; Windows and Linux are implemented per the
//! spec but stubbed/marked since they can't be exercised here.

/// Returns the shell command to flush the DNS cache on the current OS, or
/// `None` if the platform has no supported way to determine one (used by
/// the Linux path when no supported resolver cache is detected).
#[cfg(target_os = "macos")]
pub fn flush_command() -> Option<String> {
    Some("dscacheutil -flushcache; killall -HUP mDNSResponder".to_string())
}

/// Name of the resolver `flush_command` targets, for the Doctor panel's
/// detail text. macOS/Windows each have exactly one, so this is always
/// `Some` there; Linux mirrors whatever `detect_linux_resolver` found.
#[cfg(target_os = "macos")]
pub fn resolver_name() -> Option<&'static str> {
    Some("macOS mDNSResponder")
}

#[cfg(target_os = "windows")]
pub fn flush_command() -> Option<String> {
    // TODO: verify on Windows. ipconfig /flushdns does not require
    // elevation in most Windows versions, but we still route it through
    // the same elevated executor for consistency with the macOS/Linux
    // paths (where it does need privileges).
    Some("ipconfig /flushdns".to_string())
}

#[cfg(target_os = "windows")]
pub fn resolver_name() -> Option<&'static str> {
    Some("Windows DNS Client")
}

#[cfg(target_os = "linux")]
struct LinuxResolver {
    name: &'static str,
    flush_cmd: &'static str,
}

// TODO: verify on Linux. Detects the active resolver cache and returns its
// name plus matching flush command; `None` if none of these are present
// (surfaced to the user as a Doctor warning). Checked in the order
// distros most commonly ship them: systemd-resolved (most current
// desktop/server distros), dnsmasq (common on routers/NetworkManager
// setups), nscd (older/minimal distros). Presence of the binary is used
// as a proxy for "this is the active resolver," same as the pre-existing
// resolvectl/nscd checks — not a guarantee it's actually in use, just the
// best signal available without parsing `/etc/resolv.conf` or querying
// D-Bus.
#[cfg(target_os = "linux")]
fn detect_linux_resolver() -> Option<LinuxResolver> {
    use std::process::Command;

    let has = |bin: &str| {
        Command::new("which")
            .arg(bin)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    };

    if has("resolvectl") {
        Some(LinuxResolver { name: "systemd-resolved", flush_cmd: "resolvectl flush-caches" })
    } else if has("dnsmasq") {
        // dnsmasq has no client subcommand to flush its cache; sending it
        // SIGHUP (its config-reload signal) also clears the cache.
        Some(LinuxResolver { name: "dnsmasq", flush_cmd: "pkill -HUP dnsmasq" })
    } else if has("nscd") {
        Some(LinuxResolver { name: "nscd", flush_cmd: "nscd -i hosts" })
    } else {
        None
    }
}

#[cfg(target_os = "linux")]
pub fn flush_command() -> Option<String> {
    detect_linux_resolver().map(|r| r.flush_cmd.to_string())
}

#[cfg(target_os = "linux")]
pub fn resolver_name() -> Option<&'static str> {
    detect_linux_resolver().map(|r| r.name)
}
