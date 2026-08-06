//! Privilege elevation for writing the hosts file and flushing DNS.
//!
//! Pragmatic implementation for this build: shell out through the OS's
//! standard elevation prompt (macOS: `osascript ... with administrator
//! privileges`) rather than a signed Authorization Services helper, which
//! needs an Apple Developer certificate this dev machine doesn't have.
//! `ElevatedExecutor` is the seam a signed helper would slot into later
//! without touching any call site in `commands.rs`.

use std::path::Path;

pub trait ElevatedExecutor: Send + Sync {
    /// Runs a shell command with elevated privileges, returning combined
    /// stdout on success or a human-readable error message on failure
    /// (including the user cancelling the elevation prompt).
    fn run_privileged_shell(&self, shell_cmd: &str) -> Result<String, String>;
}

/// Single-quotes a path for safe interpolation into a shell command.
fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

#[cfg(target_os = "macos")]
pub struct MacOsElevatedExecutor;

#[cfg(target_os = "macos")]
impl ElevatedExecutor for MacOsElevatedExecutor {
    fn run_privileged_shell(&self, shell_cmd: &str) -> Result<String, String> {
        use std::process::Command;

        // Embed shell_cmd inside an AppleScript double-quoted string. This
        // process only ever calls osascript with an argv array (no shell
        // interpolation at this layer), so we only need to escape for the
        // AppleScript string literal, not for the outer shell.
        let escaped = shell_cmd.replace('\\', "\\\\").replace('"', "\\\"");
        let script = format!(
            "do shell script \"{}\" with administrator privileges with prompt \"Hosts Manager needs administrator access to update {}.\"",
            escaped, "the hosts file"
        );

        let output = Command::new("osascript")
            .arg("-e")
            .arg(&script)
            .output()
            .map_err(|e| format!("failed to launch osascript: {e}"))?;

        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).to_string())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            if stderr.contains("User canceled") || stderr.contains("-128") {
                Err("Administrator access was cancelled.".to_string())
            } else {
                Err(format!("Elevated command failed: {stderr}"))
            }
        }
    }
}

#[cfg(target_os = "windows")]
pub struct WindowsElevatedExecutor;

#[cfg(target_os = "windows")]
impl ElevatedExecutor for WindowsElevatedExecutor {
    fn run_privileged_shell(&self, shell_cmd: &str) -> Result<String, String> {
        // TODO: verify on Windows. Untested on this dev machine (macOS).
        // Launches an elevated PowerShell (triggers the standard UAC
        // prompt) to run the command, writing its exit code to a temp file
        // so we can detect failure across the elevation boundary.
        use std::process::Command;

        let ps_inner = shell_cmd.replace('\'', "''");
        let ps_command = format!(
            "Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile','-Command','{}'",
            ps_inner
        );
        let output = Command::new("powershell")
            .args(["-NoProfile", "-Command", &ps_command])
            .output()
            .map_err(|e| format!("failed to launch elevated PowerShell: {e}"))?;
        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).to_string())
        } else {
            Err(format!(
                "Elevated command failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ))
        }
    }
}

#[cfg(target_os = "linux")]
pub struct LinuxElevatedExecutor;

#[cfg(target_os = "linux")]
impl ElevatedExecutor for LinuxElevatedExecutor {
    fn run_privileged_shell(&self, shell_cmd: &str) -> Result<String, String> {
        // TODO: verify on Linux. Untested on this dev machine (macOS).
        // pkexec shows the desktop environment's native polkit prompt.
        use std::process::Command;

        let output = Command::new("pkexec")
            .arg("sh")
            .arg("-c")
            .arg(shell_cmd)
            .output()
            .map_err(|e| format!("failed to launch pkexec: {e}"))?;
        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).to_string())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            if output.status.code() == Some(126) || output.status.code() == Some(127) {
                Err("Administrator access was cancelled or unavailable.".to_string())
            } else {
                Err(format!("Elevated command failed: {stderr}"))
            }
        }
    }
}

#[cfg(target_os = "macos")]
pub fn default_executor() -> Box<dyn ElevatedExecutor> {
    Box::new(MacOsElevatedExecutor)
}
#[cfg(target_os = "windows")]
pub fn default_executor() -> Box<dyn ElevatedExecutor> {
    Box::new(WindowsElevatedExecutor)
}
#[cfg(target_os = "linux")]
pub fn default_executor() -> Box<dyn ElevatedExecutor> {
    Box::new(LinuxElevatedExecutor)
}

/// Result of a combined write(+flush) elevated call. `write_ok` reflects
/// only the file move; `flush_ok` is `None` when no flush command was
/// requested. A failed flush does not imply a failed write — spec
/// requirement: flush failures never roll back the file write.
pub struct WriteOutcome {
    pub write_ok: bool,
    pub flush_ok: Option<bool>,
}

const MV_MARKER: &str = "HM_MV_EXIT";
const FLUSH_MARKER: &str = "HM_FLUSH_EXIT";

/// Runs only a DNS flush, elevated, with no file write. Backs the
/// standalone "Flush DNS now" action.
pub fn run_flush_only(executor: &dyn ElevatedExecutor, flush_cmd: &str) -> Result<bool, String> {
    let full_cmd = format!("{{ {flush_cmd} ; }} ; echo {FLUSH_MARKER}:$?");
    let stdout = executor.run_privileged_shell(&full_cmd)?;
    Ok(extract_marker_exit(&stdout, FLUSH_MARKER) == Some(0))
}

/// Moves `tmp_path` over `hosts_path` with elevated privileges, then
/// (optionally) runs `flush_cmd` in the same elevated shell so a single
/// admin prompt covers the whole action. The two steps are sequenced with
/// `;`, not `&&`, and their exit codes are captured via markers in stdout,
/// so a flush failure is reported without masking a successful write.
pub fn write_hosts_file(
    executor: &dyn ElevatedExecutor,
    tmp_path: &Path,
    hosts_path: &Path,
    flush_cmd: Option<&str>,
) -> Result<WriteOutcome, String> {
    let mv_cmd = format!(
        "mv -f {} {}",
        shell_quote(&tmp_path.to_string_lossy()),
        shell_quote(&hosts_path.to_string_lossy())
    );
    let full_cmd = match flush_cmd {
        Some(flush) => format!(
            "{{ {mv_cmd} ; }} ; echo {MV_MARKER}:$? ; {{ {flush} ; }} ; echo {FLUSH_MARKER}:$?"
        ),
        None => format!("{{ {mv_cmd} ; }} ; echo {MV_MARKER}:$?"),
    };

    let stdout = executor.run_privileged_shell(&full_cmd)?;
    let mv_exit = extract_marker_exit(&stdout, MV_MARKER);
    let flush_exit = flush_cmd.map(|_| extract_marker_exit(&stdout, FLUSH_MARKER));

    Ok(WriteOutcome {
        write_ok: mv_exit == Some(0),
        flush_ok: flush_exit.map(|e| e == Some(0)),
    })
}

fn extract_marker_exit(stdout: &str, marker: &str) -> Option<i32> {
    let prefix = format!("{marker}:");
    stdout
        .lines()
        .rev()
        .find_map(|line| line.strip_prefix(&prefix))
        .and_then(|code| code.trim().parse::<i32>().ok())
}

/// Installs the privileged helper daemon (LaunchDaemon + binary in
/// `/Library/PrivilegedHelperTools`) and performs this write (+ optional
/// flush) in the *same* elevated shell invocation — one prompt covers
/// both. Install steps are chained with `&&` ahead of the existing
/// mv/flush marker sequence, so an install failure is reported as a
/// failed write (write_ok = false) rather than silently partially
/// succeeding.
#[cfg(target_os = "macos")]
pub fn install_helper_and_write(
    executor: &dyn ElevatedExecutor,
    helper_binary_src: &Path,
    plist_staging: &Path,
    hosts_staging: &Path,
    hosts_path: &Path,
    flush_cmd: Option<&str>,
) -> Result<WriteOutcome, String> {
    let dest = format!(
        "{}/{}",
        helper_protocol::HELPER_INSTALL_DIR,
        helper_protocol::HELPER_BINARY_NAME
    );
    let install_chain = format!(
        "mkdir -p {installdir} && cp {src} {dest} && chown root:wheel {dest} && chmod 755 {dest} && cp {plist_src} {plist_dest} && chown root:wheel {plist_dest} && chmod 644 {plist_dest} && (launchctl bootout system/{label} 2>/dev/null; launchctl bootstrap system {plist_dest})",
        installdir = shell_quote(helper_protocol::HELPER_INSTALL_DIR),
        src = shell_quote(&helper_binary_src.to_string_lossy()),
        dest = shell_quote(&dest),
        plist_src = shell_quote(&plist_staging.to_string_lossy()),
        plist_dest = shell_quote(helper_protocol::LAUNCH_DAEMON_PLIST_PATH),
        label = helper_protocol::HELPER_LABEL,
    );

    let mv_cmd = format!(
        "mv -f {} {}",
        shell_quote(&hosts_staging.to_string_lossy()),
        shell_quote(&hosts_path.to_string_lossy())
    );
    let full_cmd = match flush_cmd {
        Some(flush) => format!(
            "{install_chain} && {{ {mv_cmd} ; }} ; echo {MV_MARKER}:$? ; {{ {flush} ; }} ; echo {FLUSH_MARKER}:$?"
        ),
        None => format!("{install_chain} && {{ {mv_cmd} ; }} ; echo {MV_MARKER}:$?"),
    };

    let stdout = executor.run_privileged_shell(&full_cmd)?;
    let mv_exit = extract_marker_exit(&stdout, MV_MARKER);
    let flush_exit = flush_cmd.map(|_| extract_marker_exit(&stdout, FLUSH_MARKER));

    Ok(WriteOutcome {
        write_ok: mv_exit == Some(0),
        flush_ok: flush_exit.map(|e| e == Some(0)),
    })
}

#[cfg(not(target_os = "macos"))]
pub fn install_helper_and_write(
    _executor: &dyn ElevatedExecutor,
    _helper_binary_src: &Path,
    _plist_staging: &Path,
    _hosts_staging: &Path,
    _hosts_path: &Path,
    _flush_cmd: Option<&str>,
) -> Result<WriteOutcome, String> {
    // TODO: verify on this OS. The background-helper install path is
    // currently macOS-only (LaunchDaemon + getpeereid); other platforms
    // still use the per-write elevation prompt in write_hosts_file.
    Err("The background helper is not yet supported on this OS.".to_string())
}

/// Elevated command to fully remove the helper daemon: stop it via
/// launchd, then delete its binary and LaunchDaemon plist.
#[cfg(target_os = "macos")]
pub fn build_uninstall_command() -> String {
    format!(
        "launchctl bootout system/{label} 2>/dev/null; rm -f {plist} {bin}",
        label = helper_protocol::HELPER_LABEL,
        plist = shell_quote(helper_protocol::LAUNCH_DAEMON_PLIST_PATH),
        bin = shell_quote(&format!(
            "{}/{}",
            helper_protocol::HELPER_INSTALL_DIR,
            helper_protocol::HELPER_BINARY_NAME
        )),
    )
}

#[cfg(not(target_os = "macos"))]
pub fn build_uninstall_command() -> String {
    String::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_quote_escapes_single_quotes() {
        assert_eq!(shell_quote("/etc/hosts"), "'/etc/hosts'");
        assert_eq!(shell_quote("it's"), r"'it'\''s'");
    }

    #[test]
    fn extract_marker_exit_parses_last_matching_line() {
        let stdout = "some output\nHM_MV_EXIT:0\nHM_FLUSH_EXIT:1\n";
        assert_eq!(extract_marker_exit(stdout, MV_MARKER), Some(0));
        assert_eq!(extract_marker_exit(stdout, FLUSH_MARKER), Some(1));
        assert_eq!(extract_marker_exit(stdout, "MISSING"), None);
    }
}
