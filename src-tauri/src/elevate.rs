//! Privilege elevation for writing the hosts file and flushing DNS.
//!
//! Pragmatic implementation for this build: shell out through the OS's
//! standard elevation prompt (macOS: `osascript ... with administrator
//! privileges`) rather than a signed Authorization Services helper, which
//! needs an Apple Developer certificate this dev machine doesn't have.
//! `ElevatedExecutor` is the seam a signed helper would slot into later
//! without touching any call site in `commands.rs`.

use std::io::Read;
use std::path::Path;
use std::process::{Command, Output, Stdio};
use std::time::{Duration, Instant};

pub trait ElevatedExecutor: Send + Sync {
    /// Runs a shell command with elevated privileges, returning combined
    /// stdout on success or a human-readable error message on failure
    /// (including the user cancelling the elevation prompt). `shell_cmd` is
    /// written in the target OS's native scripting syntax (POSIX `sh` on
    /// macOS/Linux, PowerShell on Windows) — see the `build_*` helpers below,
    /// which are the only callers that should construct it.
    fn run_privileged_shell(&self, shell_cmd: &str) -> Result<String, String>;
}

/// How long an elevated command may run before the caller gives up waiting
/// on it. This bounds how long a caller's thread — and, transitively,
/// whatever lock it holds (see `commands.rs::write_content_to_hosts_file`,
/// which holds `AppState::conn`'s mutex across this call) — can be pinned by
/// a native admin-password dialog nobody answers. Generous enough that a
/// real user typing their password never trips it; short enough that "the
/// app looks frozen" resolves on its own within a few minutes instead of
/// requiring a force-quit.
const ELEVATION_TIMEOUT: Duration = Duration::from_secs(180);

/// Runs `cmd` to completion, waiting up to `timeout`, and returns the same
/// `Output` `Command::output()` would. If `cmd` hasn't exited within
/// `timeout`, kills it and returns a `TimedOut`-kind error instead of
/// blocking forever.
///
/// Every script this is used for (see the `build_*_script` functions below)
/// only ever echoes a handful of short marker lines to stdout/stderr — never
/// the hosts-file content itself, which is written to a file, not printed —
/// so polling `try_wait()` before draining the child's pipes can never fill
/// the OS pipe buffer and deadlock the child. A future caller piping
/// substantial output through here would need a concurrent reader instead of
/// this straightforward wait-then-read shape.
fn run_with_timeout(mut cmd: Command, timeout: Duration) -> std::io::Result<Output> {
    let mut child = cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()?;
    let start = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if start.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "timed out waiting for a response to the administrator prompt",
            ));
        }
        std::thread::sleep(Duration::from_millis(200));
    };
    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    if let Some(mut s) = child.stdout.take() {
        let _ = s.read_to_end(&mut stdout);
    }
    if let Some(mut s) = child.stderr.take() {
        let _ = s.read_to_end(&mut stderr);
    }
    Ok(Output { status, stdout, stderr })
}

/// Single-quotes a path for safe interpolation into a POSIX shell command.
#[cfg(unix)]
fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

/// Single-quotes a path for safe interpolation into a PowerShell command
/// (PowerShell's single-quoted strings are literal — no interpolation — so
/// the only character that needs escaping is the quote itself, doubled).
#[cfg(windows)]
fn ps_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

#[cfg(target_os = "macos")]
pub struct MacOsElevatedExecutor;

#[cfg(target_os = "macos")]
impl ElevatedExecutor for MacOsElevatedExecutor {
    fn run_privileged_shell(&self, shell_cmd: &str) -> Result<String, String> {
        // Embed shell_cmd inside an AppleScript double-quoted string. This
        // process only ever calls osascript with an argv array (no shell
        // interpolation at this layer), so we only need to escape for the
        // AppleScript string literal, not for the outer shell.
        let escaped = shell_cmd.replace('\\', "\\\\").replace('"', "\\\"");
        let script = format!(
            "do shell script \"{}\" with administrator privileges with prompt \"re:route needs administrator access to update {}.\"",
            escaped, "the hosts file"
        );

        let mut cmd = Command::new("osascript");
        cmd.arg("-e").arg(&script);
        let output = run_with_timeout(cmd, ELEVATION_TIMEOUT).map_err(|e| {
            if e.kind() == std::io::ErrorKind::TimedOut {
                "Administrator access timed out waiting for a response.".to_string()
            } else {
                format!("failed to launch osascript: {e}")
            }
        })?;

        if output.status.success() {
            // AppleScript's `do shell script` returns captured output as an
            // AppleScript string, which translates Unix LF ('\n') line
            // endings to classic Mac CR ('\r') — a long-standing, documented
            // quirk. Translate them back so line-oriented parsing of this
            // output (e.g. extract_marker_exit's use of str::lines(), which
            // does not treat a bare '\r' as a line break) works correctly.
            Ok(String::from_utf8_lossy(&output.stdout).replace('\r', "\n"))
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
        // Launches an elevated PowerShell (triggers the standard UAC
        // prompt) to run the command. `Start-Process -Verb RunAs` launches
        // via ShellExecute, which cannot share pipes with this (unelevated)
        // process — passing `-RedirectStandardOutput` alongside `-Verb`
        // fails outright, since RunAs forces UseShellExecute=true while
        // redirection requires it false. So instead, the elevated script
        // redirects its own output to a temp file, which we read back here
        // once `-Wait` returns control.
        //
        // Timeout caveat: `Start-Process -Verb RunAs` launches the elevated
        // process outside the normal parent/child tree (via the elevation
        // broker), so killing *this* (unelevated) launcher on timeout stops
        // our own wait but isn't guaranteed to dismiss the UAC prompt or the
        // elevated process itself — unlike the macOS path, where killing
        // osascript reliably tears down its `do shell script ... with
        // administrator privileges` child. If the user answers a
        // since-abandoned prompt after we've already given up and rolled
        // back, `commands.rs::write_content_to_hosts_file` resetting
        // `last_written` on any error here (see its own comment) ensures
        // that late write is still correctly picked up as an external change
        // rather than silently swallowed.
        let out_path = std::env::temp_dir().join(format!(
            "reroute-elevate-{}-{}.log",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or_default()
        ));
        let _ = std::fs::remove_file(&out_path);

        // `*>` merges all output streams (success, error, warning, etc.)
        // into the file so nothing gets lost across the elevation boundary.
        let inner = format!("& {{ {shell_cmd} }} *> {}", ps_quote(&out_path.to_string_lossy()));
        let ps_inner = inner.replace('\'', "''");
        let ps_command = format!(
            "Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile','-WindowStyle','Hidden','-Command','{}'",
            ps_inner
        );

        let mut cmd = Command::new("powershell");
        cmd.args(["-NoProfile", "-Command", &ps_command]);
        let output = run_with_timeout(cmd, ELEVATION_TIMEOUT).map_err(|e| {
            if e.kind() == std::io::ErrorKind::TimedOut {
                "Administrator access timed out waiting for a response.".to_string()
            } else {
                format!("failed to launch elevated PowerShell: {e}")
            }
        })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            // UAC dismissal surfaces as a terminating error in the
            // *unelevated* launcher process (Start-Process itself throws),
            // carrying Win32 error 1223 (ERROR_CANCELLED) somewhere in the
            // message.
            return if stderr.contains("1223") || stderr.to_lowercase().contains("cancel") {
                Err("Administrator access was cancelled.".to_string())
            } else {
                Err(format!("Elevated command failed: {stderr}"))
            };
        }

        let result = std::fs::read_to_string(&out_path).unwrap_or_default();
        let _ = std::fs::remove_file(&out_path);
        Ok(result)
    }
}

#[cfg(target_os = "linux")]
pub struct LinuxElevatedExecutor;

#[cfg(target_os = "linux")]
impl ElevatedExecutor for LinuxElevatedExecutor {
    fn run_privileged_shell(&self, shell_cmd: &str) -> Result<String, String> {
        // pkexec shows the desktop environment's native polkit prompt, then
        // runs `shell_cmd` as-is via `sh -c` (passed directly as an argv
        // element, so — unlike the macOS/Windows executors — no extra
        // string-literal escaping layer is needed here). Its own exit code
        // mirrors the launched command's, *except* per pkexec(1): 127 means
        // authorization couldn't be obtained (dialog dismissed or denied)
        // and 126 means authentication failed (e.g. wrong password entered
        // too many times) — both surfaced as a cancellation, since our
        // wrapped script always ends by echoing a marker and so otherwise
        // exits 0 regardless of the mv/flush outcome.
        //
        // Timeout caveat: killing `pkexec` on timeout terminates the process
        // we spawned; most polkit agents propagate that to the child they
        // launched, but this isn't a POSIX guarantee, so — as on Windows —
        // an abandoned prompt could in principle still complete after we've
        // given up. See `commands.rs::write_content_to_hosts_file`'s
        // `last_written` reset for why a late write is still handled safely.
        let mut cmd = Command::new("pkexec");
        cmd.arg("sh").arg("-c").arg(shell_cmd);
        let output = run_with_timeout(cmd, ELEVATION_TIMEOUT).map_err(|e| {
            if e.kind() == std::io::ErrorKind::TimedOut {
                "Administrator access timed out waiting for a response.".to_string()
            } else {
                format!("failed to launch pkexec: {e}")
            }
        })?;
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
const INSTALL_MARKER: &str = "HM_INSTALL_EXIT";

/// Runs only a DNS flush, elevated, with no file write. Backs the
/// standalone "Flush DNS now" action.
pub fn run_flush_only(executor: &dyn ElevatedExecutor, flush_cmd: &str) -> Result<bool, String> {
    let full_cmd = build_flush_only_script(flush_cmd);
    let stdout = executor.run_privileged_shell(&full_cmd)?;
    Ok(extract_marker_exit(&stdout, FLUSH_MARKER) == Some(0))
}

#[cfg(unix)]
fn build_flush_only_script(flush_cmd: &str) -> String {
    format!("{{ {flush_cmd} ; }} ; echo {FLUSH_MARKER}:$?")
}

// PowerShell's `$?` reflects the last statement as a boolean, not a numeric
// exit code, and native commands like `ipconfig` only populate
// `$LASTEXITCODE` — so unlike the POSIX builder above, success/failure is
// captured explicitly with try/catch rather than by echoing `$?` verbatim.
#[cfg(windows)]
fn build_flush_only_script(flush_cmd: &str) -> String {
    format!(
        "try {{ {flush_cmd} ; if ($LASTEXITCODE -ne 0) {{ throw 'flush failed' }} ; Write-Output '{FLUSH_MARKER}:0' }} catch {{ Write-Output '{FLUSH_MARKER}:1' }}"
    )
}

/// Moves `tmp_path` over `hosts_path` with elevated privileges, then
/// (optionally) runs `flush_cmd` in the same elevated shell so a single
/// admin prompt covers the whole action. The two steps are sequenced with
/// `;`, not `&&`, and their exit codes are captured via markers in stdout,
/// so a flush failure is reported without masking a successful write. The
/// script text itself is built per-OS (POSIX `sh` vs. PowerShell) since the
/// two aren't remotely compatible — see the `build_move_and_flush_script`
/// variants below.
pub fn write_hosts_file(
    executor: &dyn ElevatedExecutor,
    tmp_path: &Path,
    hosts_path: &Path,
    flush_cmd: Option<&str>,
) -> Result<WriteOutcome, String> {
    let full_cmd = build_move_and_flush_script(tmp_path, hosts_path, flush_cmd);

    let stdout = executor.run_privileged_shell(&full_cmd)?;
    let mv_exit = extract_marker_exit(&stdout, MV_MARKER);
    let flush_exit = flush_cmd.map(|_| extract_marker_exit(&stdout, FLUSH_MARKER));

    let outcome = WriteOutcome {
        write_ok: mv_exit == Some(0),
        flush_ok: flush_exit.map(|e| e == Some(0)),
    };
    if !outcome.write_ok {
        eprintln!("elevated hosts-file write failed; raw shell output:\n{stdout}");
    }
    Ok(outcome)
}

#[cfg(unix)]
fn build_move_and_flush_script(tmp_path: &Path, hosts_path: &Path, flush_cmd: Option<&str>) -> String {
    let mv_cmd = format!(
        "mv -f {} {}",
        shell_quote(&tmp_path.to_string_lossy()),
        shell_quote(&hosts_path.to_string_lossy())
    );
    match flush_cmd {
        Some(flush) => format!(
            "{{ {mv_cmd} ; }} ; echo {MV_MARKER}:$? ; {{ {flush} ; }} ; echo {FLUSH_MARKER}:$?"
        ),
        None => format!("{{ {mv_cmd} ; }} ; echo {MV_MARKER}:$?"),
    }
}

// `mv -f`/`{ ; }`/`$?` are POSIX-shell-only: PowerShell's `mv` (an alias for
// `Move-Item`) doesn't have a `-f` flag (`-Force` is ambiguous with
// `-Filter` under partial-name binding), bare `{ ... }` is an unexecuted
// script block rather than a grouped command, and `$?` is a boolean. So the
// move is done with `Move-Item -Force` in a try/catch that echoes a numeric
// marker explicitly, mirroring the POSIX builder's contract instead of
// reusing its syntax. `-ErrorAction Stop` is required for the catch to
// actually fire: cmdlets raise non-terminating errors by default, which
// `try`/`catch` silently ignores unless the cmdlet (or
// `$ErrorActionPreference`) is told to escalate them.
#[cfg(windows)]
fn build_move_and_flush_script(tmp_path: &Path, hosts_path: &Path, flush_cmd: Option<&str>) -> String {
    let mv_cmd = format!(
        "try {{ Move-Item -Force -ErrorAction Stop -LiteralPath {} -Destination {} ; Write-Output '{MV_MARKER}:0' }} catch {{ Write-Output '{MV_MARKER}:1' }}",
        ps_quote(&tmp_path.to_string_lossy()),
        ps_quote(&hosts_path.to_string_lossy()),
    );
    match flush_cmd {
        Some(flush) => format!(
            "{mv_cmd} ; try {{ {flush} ; if ($LASTEXITCODE -ne 0) {{ throw 'flush failed' }} ; Write-Output '{FLUSH_MARKER}:0' }} catch {{ Write-Output '{FLUSH_MARKER}:1' }}"
        ),
        None => mv_cmd,
    }
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
    token_staging: &Path,
    hosts_staging: &Path,
    hosts_path: &Path,
    flush_cmd: Option<&str>,
) -> Result<WriteOutcome, String> {
    let dest = format!(
        "{}/{}",
        helper_protocol::HELPER_INSTALL_DIR,
        helper_protocol::HELPER_BINARY_NAME
    );
    // The token must land at its root-owned, mode-0600 destination *before*
    // the daemon (re)starts, since it only reads that file once at its own
    // startup. Restarting an *already-loaded* daemon must not use
    // `bootout` followed immediately by `bootstrap`: `bootout` only signals
    // the old instance and returns before launchd finishes tearing it down
    // (macOS schedules that cleanup ~5s later), so an immediate `bootstrap`
    // can race it and fail with "service already loaded". Try `bootstrap`
    // first (the common first-install case, nothing loaded yet); if that
    // fails because it's already loaded, `kickstart -k` synchronously
    // kills-and-restarts the existing instance in place instead.
    let install_chain = format!(
        "mkdir -p {installdir} && cp {src} {dest} && chown root:wheel {dest} && chmod 755 {dest} && cp {token_src} {token_dest} && chown root:wheel {token_dest} && chmod 600 {token_dest} && cp {plist_src} {plist_dest} && chown root:wheel {plist_dest} && chmod 644 {plist_dest} && (launchctl bootstrap system {plist_dest} 2>/dev/null || launchctl kickstart -k system/{label})",
        installdir = shell_quote(helper_protocol::HELPER_INSTALL_DIR),
        src = shell_quote(&helper_binary_src.to_string_lossy()),
        dest = shell_quote(&dest),
        token_src = shell_quote(&token_staging.to_string_lossy()),
        token_dest = shell_quote(helper_protocol::HELPER_TOKEN_PATH),
        plist_src = shell_quote(&plist_staging.to_string_lossy()),
        plist_dest = shell_quote(helper_protocol::LAUNCH_DAEMON_PLIST_PATH),
        label = helper_protocol::HELPER_LABEL,
    );

    let mv_cmd = format!(
        "mv -f {} {}",
        shell_quote(&hosts_staging.to_string_lossy()),
        shell_quote(&hosts_path.to_string_lossy())
    );
    // Each stage's exit code is captured into a shell variable and echoed
    // unconditionally (via `;`, and inside an explicit if/else rather than
    // relying on `&&` short-circuiting to skip straight to a later echo),
    // so every marker is guaranteed to appear in the output exactly once —
    // this is deliberately more verbose than a chained `&&`/`;` one-liner
    // specifically so a failure's exact stage is never ambiguous.
    let mv_and_flush = match flush_cmd {
        Some(flush) => format!(
            "if [ \"$ic\" -eq 0 ]; then {{ {mv_cmd} ; }} ; echo {MV_MARKER}:$? ; else echo {MV_MARKER}:$ic ; fi ; {{ {flush} ; }} ; echo {FLUSH_MARKER}:$?"
        ),
        None => format!("if [ \"$ic\" -eq 0 ]; then {{ {mv_cmd} ; }} ; echo {MV_MARKER}:$? ; else echo {MV_MARKER}:$ic ; fi"),
    };
    let full_cmd = format!("{{ {install_chain} ; }} ; ic=$? ; echo {INSTALL_MARKER}:$ic ; {mv_and_flush}");

    let stdout = executor.run_privileged_shell(&full_cmd)?;
    let install_exit = extract_marker_exit(&stdout, INSTALL_MARKER);
    let mv_exit = extract_marker_exit(&stdout, MV_MARKER);
    let flush_exit = flush_cmd.map(|_| extract_marker_exit(&stdout, FLUSH_MARKER));

    let outcome = WriteOutcome {
        write_ok: mv_exit == Some(0),
        flush_ok: flush_exit.map(|e| e == Some(0)),
    };
    if !outcome.write_ok {
        eprintln!(
            "helper install + hosts-file write failed (install stage exit: {install_exit:?}); raw shell output:\n{stdout}"
        );
    }
    Ok(outcome)
}

#[cfg(not(target_os = "macos"))]
pub fn install_helper_and_write(
    _executor: &dyn ElevatedExecutor,
    _helper_binary_src: &Path,
    _plist_staging: &Path,
    _token_staging: &Path,
    _hosts_staging: &Path,
    _hosts_path: &Path,
    _flush_cmd: Option<&str>,
) -> Result<WriteOutcome, String> {
    // The background-helper install path is deliberately macOS-only
    // (LaunchDaemon + getpeereid); other platforms always use the per-write
    // elevation prompt in write_hosts_file instead.
    Err("The background helper is not yet supported on this OS.".to_string())
}

/// Elevated command to fully remove the helper daemon: stop it via
/// launchd, then delete its binary and LaunchDaemon plist.
#[cfg(target_os = "macos")]
pub fn build_uninstall_command() -> String {
    format!(
        "launchctl bootout system/{label} 2>/dev/null; rm -f {plist} {bin} {token}",
        label = helper_protocol::HELPER_LABEL,
        plist = shell_quote(helper_protocol::LAUNCH_DAEMON_PLIST_PATH),
        bin = shell_quote(&format!(
            "{}/{}",
            helper_protocol::HELPER_INSTALL_DIR,
            helper_protocol::HELPER_BINARY_NAME
        )),
        token = shell_quote(helper_protocol::HELPER_TOKEN_PATH),
    )
}

#[cfg(not(target_os = "macos"))]
pub fn build_uninstall_command() -> String {
    String::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
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

    #[cfg(unix)]
    fn echo_hello_command() -> Command {
        let mut c = Command::new("echo");
        c.arg("hello");
        c
    }
    #[cfg(windows)]
    fn echo_hello_command() -> Command {
        let mut c = Command::new("cmd");
        c.args(["/C", "echo hello"]);
        c
    }

    #[cfg(unix)]
    fn sleep_command(secs: u64) -> Command {
        let mut c = Command::new("sleep");
        c.arg(secs.to_string());
        c
    }
    #[cfg(windows)]
    fn sleep_command(secs: u64) -> Command {
        let mut c = Command::new("powershell");
        c.args(["-NoProfile", "-Command", &format!("Start-Sleep -Seconds {secs}")]);
        c
    }

    #[test]
    fn run_with_timeout_returns_output_when_command_finishes_in_time() {
        let output = run_with_timeout(echo_hello_command(), Duration::from_secs(5)).unwrap();
        assert!(output.status.success());
        assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), "hello");
    }

    #[test]
    fn run_with_timeout_kills_and_errors_when_command_runs_too_long() {
        let start = Instant::now();
        let result = run_with_timeout(sleep_command(5), Duration::from_millis(300));
        let elapsed = start.elapsed();

        let err = result.expect_err("expected the long-running command to time out");
        assert_eq!(err.kind(), std::io::ErrorKind::TimedOut);
        assert!(
            elapsed < Duration::from_secs(4),
            "expected the timeout to fire well before the 5s sleep finished naturally, took {elapsed:?}"
        );
    }

    #[cfg(windows)]
    #[test]
    fn ps_quote_escapes_single_quotes() {
        assert_eq!(ps_quote(r"C:\hosts"), r"'C:\hosts'");
        assert_eq!(ps_quote("it's"), "'it''s'");
    }

    #[cfg(windows)]
    #[test]
    fn build_move_and_flush_script_uses_powershell_syntax_and_numeric_markers() {
        let script = build_move_and_flush_script(
            Path::new(r"C:\staging\hosts"),
            Path::new(r"C:\Windows\System32\drivers\etc\hosts"),
            Some("ipconfig /flushdns"),
        );
        assert!(script.contains("Move-Item -Force -ErrorAction Stop"));
        assert!(script.contains(&format!("{MV_MARKER}:0")));
        assert!(script.contains(&format!("{MV_MARKER}:1")));
        assert!(script.contains(&format!("{FLUSH_MARKER}:0")));
        assert!(script.contains("$LASTEXITCODE"));
        // Not POSIX syntax that PowerShell would misinterpret.
        assert!(!script.contains("mv -f"));
        assert!(!script.contains("$?"));
    }

    #[cfg(windows)]
    #[test]
    fn build_flush_only_script_wraps_native_exit_code() {
        let script = build_flush_only_script("ipconfig /flushdns");
        assert!(script.contains("$LASTEXITCODE"));
        assert!(script.contains(&format!("{FLUSH_MARKER}:0")));
        assert!(script.contains(&format!("{FLUSH_MARKER}:1")));
    }
}
