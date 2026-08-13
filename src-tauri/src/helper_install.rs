//! One-time installation of the privileged helper daemon, combined with
//! the write that triggered it, so a single admin prompt covers both.

use std::io::Read;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::elevate::{self, ElevatedExecutor, WriteOutcome};
use crate::helper_client;
use crate::hosts_parser;

/// Generates a fresh 256-bit per-install auth token from the OS CSPRNG,
/// hex-encoded. Minted on every (re)install, since `install_and_write` also
/// restarts the daemon (`launchctl bootout` + `bootstrap`), so the new
/// token always takes effect immediately.
fn generate_token() -> Result<String, String> {
    let mut f = std::fs::File::open("/dev/urandom").map_err(|e| format!("Failed to open /dev/urandom: {e}"))?;
    let mut buf = [0u8; 32];
    f.read_exact(&mut buf).map_err(|e| format!("Failed to read random bytes: {e}"))?;
    Ok(buf.iter().map(|b| format!("{b:02x}")).collect())
}

/// `KeepAlive` only respawns the daemon after it exits non-zero (a crash),
/// not after every exit — `main`'s accept loop only returns via `expect()`
/// on bind failure, so this just avoids an unconditional respawn loop if
/// that ever happens repeatedly. `ThrottleInterval` adds an explicit
/// minimum gap between respawns on top of launchd's own default backoff.
const PLIST_TEMPLATE: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>{label}</string>
    <key>ProgramArguments</key>
    <array>
        <string>{dest}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>ThrottleInterval</key>
    <integer>10</integer>
</dict>
</plist>
"#;

/// Finds the built helper binary: next to the running executable in dev
/// (cargo puts both workspace binaries in the same target dir), or in the
/// app's bundled resources in a packaged build.
pub fn locate_helper_binary(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidate = dir.join("reroute-helper");
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidate = resource_dir.join("reroute-helper");
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

#[cfg(target_os = "macos")]
pub fn install_and_write(
    app: &AppHandle,
    executor: &dyn ElevatedExecutor,
    staging_dir: &Path,
    hosts_content: &str,
    hosts_path: &Path,
    flush_cmd: Option<&str>,
) -> Result<WriteOutcome, String> {
    let helper_src = locate_helper_binary(app).ok_or_else(|| {
        "Could not find the privileged helper binary to install.".to_string()
    })?;

    let dest = format!(
        "{}/{}",
        helper_protocol::HELPER_INSTALL_DIR,
        helper_protocol::HELPER_BINARY_NAME
    );
    let plist_content = PLIST_TEMPLATE
        .replace("{label}", helper_protocol::HELPER_LABEL)
        .replace("{dest}", &dest);

    let plist_staging = staging_dir.join(".staging-helper.plist");
    std::fs::write(&plist_staging, &plist_content)
        .map_err(|e| format!("Failed to stage the helper's launchd plist: {e}"))?;

    let token = generate_token()?;
    let token_staging = staging_dir.join(".staging-helper-token");
    // Mode 0600 from the moment the file exists: `staging_dir` is a normal,
    // non-root-owned app-data directory (unlike the elevated script's final
    // destination below), so an in-between default-permissioned copy of the
    // daemon's live auth token would be readable by any other local process
    // running as this user for as long as it stuck around.
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut f = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&token_staging)
            .map_err(|e| format!("Failed to stage the helper auth token: {e}"))?;
        f.write_all(token.as_bytes())
            .map_err(|e| format!("Failed to stage the helper auth token: {e}"))?;
    }

    let hosts_staging = staging_dir.join(".staging-hosts");
    hosts_parser::atomic_write(&hosts_staging, hosts_content)
        .map_err(|e| format!("Failed to stage the hosts file: {e}"))?;

    let outcome = elevate::install_helper_and_write(
        executor,
        &helper_src,
        &plist_staging,
        &token_staging,
        &hosts_staging,
        hosts_path,
        flush_cmd,
    );
    // Clean up regardless of outcome: the elevated script above only ever
    // needs to read this file once (to `cp` it to its root-owned, 0600 final
    // destination), so nothing should still depend on it existing here,
    // success or failure.
    let _ = std::fs::remove_file(&token_staging);
    let outcome = outcome?;

    // Only persist the client's own copy once the elevated install chain
    // (which writes the daemon's root-owned copy at the same token value)
    // has actually succeeded — otherwise a stale/mismatched local copy
    // could mask a still-good previous install.
    if outcome.write_ok {
        match app.path().app_data_dir() {
            Ok(app_data_dir) => {
                let token_path = app_data_dir.join(helper_client::CLIENT_TOKEN_FILENAME);
                match std::fs::write(&token_path, &token) {
                    Ok(()) => {
                        #[cfg(unix)]
                        {
                            use std::os::unix::fs::PermissionsExt;
                            if let Err(e) = std::fs::set_permissions(&token_path, std::fs::Permissions::from_mode(0o600)) {
                                eprintln!("failed to set permissions on {token_path:?}: {e}");
                            }
                        }
                    }
                    Err(e) => eprintln!("failed to persist client-side helper token to {token_path:?}: {e}"),
                }
            }
            Err(e) => eprintln!("failed to resolve app data dir to persist the client-side helper token: {e}"),
        }
    }

    Ok(outcome)
}

#[cfg(not(target_os = "macos"))]
pub fn install_and_write(
    _app: &AppHandle,
    _executor: &dyn ElevatedExecutor,
    _staging_dir: &Path,
    _hosts_content: &str,
    _hosts_path: &Path,
    _flush_cmd: Option<&str>,
) -> Result<WriteOutcome, String> {
    Err("The background helper is not yet supported on this OS.".to_string())
}
