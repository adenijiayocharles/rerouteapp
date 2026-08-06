//! Per-OS DNS resolver cache flush commands. macOS is the real,
//! tested-on-this-machine path; Windows and Linux are implemented per the
//! spec but stubbed/marked since they can't be exercised here.

/// Returns the shell command to flush the DNS cache on the current OS, or
/// `None` if the platform has no supported way to determine one (used by
/// the Linux path when neither systemd-resolved nor nscd is detected).
#[cfg(target_os = "macos")]
pub fn flush_command() -> Option<String> {
    Some("dscacheutil -flushcache; killall -HUP mDNSResponder".to_string())
}

#[cfg(target_os = "windows")]
pub fn flush_command() -> Option<String> {
    // TODO: verify on Windows. ipconfig /flushdns does not require
    // elevation in most Windows versions, but we still route it through
    // the same elevated executor for consistency with the macOS/Linux
    // paths (where it does need privileges).
    Some("ipconfig /flushdns".to_string())
}

#[cfg(target_os = "linux")]
pub fn flush_command() -> Option<String> {
    // TODO: verify on Linux. Detect the active resolver cache and use the
    // matching flush command; fall back to None (surfaced to the user as a
    // warning) if neither is present.
    use std::process::Command;

    let has = |bin: &str| {
        Command::new("which")
            .arg(bin)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    };

    if has("resolvectl") {
        Some("resolvectl flush-caches".to_string())
    } else if has("nscd") {
        Some("nscd -i hosts".to_string())
    } else {
        None
    }
}
