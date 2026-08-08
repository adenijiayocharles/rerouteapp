//! One-time installation of the privileged helper daemon, combined with
//! the write that triggered it, so a single admin prompt covers both.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::elevate::{self, ElevatedExecutor, WriteOutcome};
use crate::hosts_parser;

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
    <true/>
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

    let hosts_staging = staging_dir.join(".staging-hosts");
    hosts_parser::atomic_write(&hosts_staging, hosts_content)
        .map_err(|e| format!("Failed to stage the hosts file: {e}"))?;

    elevate::install_helper_and_write(
        executor,
        &helper_src,
        &plist_staging,
        &hosts_staging,
        hosts_path,
        flush_cmd,
    )
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
