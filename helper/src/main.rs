//! Privileged helper daemon for Reroute. Installed once (as root,
//! via a LaunchDaemon) so the main app never needs a per-write admin
//! prompt again. Deliberately minimal: it exposes exactly two operations
//! — overwrite the hosts file, flush DNS — both hardcoded here, never
//! driven by a client-supplied path or shell command. The only thing a
//! client controls is the *content* to write, which is the entire point
//! of the app; there is no command or path injection surface.
//!
//! Authorization: any process running as a member of the `admin` group
//! may connect (checked via the connecting socket's peer UID), matching
//! the trust level that installing this daemon already required — a
//! non-admin process cannot instruct it to do anything.

use std::ffi::CString;
use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::os::unix::io::AsRawFd;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::Path;
use std::process::Command;

use helper_protocol::{read_message, write_message, Request, Response, SOCKET_PATH};

const HOSTS_PATH: &str = "/etc/hosts";

extern "C" {
    fn getpeereid(s: i32, euid: *mut u32, egid: *mut u32) -> i32;
}

fn peer_uid(stream: &UnixStream) -> std::io::Result<u32> {
    let mut euid: u32 = 0;
    let mut egid: u32 = 0;
    let rc = unsafe { getpeereid(stream.as_raw_fd(), &mut euid, &mut egid) };
    if rc != 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(euid)
}

/// True if `uid` belongs to the `admin` group, via the same directory
/// services lookup the OS itself uses (not just flat /etc/group), so this
/// correctly recognizes Open Directory-backed admin accounts.
fn is_admin(uid: u32) -> bool {
    unsafe {
        let pw = libc::getpwuid(uid);
        if pw.is_null() {
            return false;
        }
        let username = (*pw).pw_name;
        let primary_gid = (*pw).pw_gid;

        let admin_group_name = CString::new("admin").unwrap();
        let admin_group = libc::getgrnam(admin_group_name.as_ptr());
        if admin_group.is_null() {
            return false;
        }
        let admin_gid = (*admin_group).gr_gid;

        // Darwin's getgrouplist, unlike glibc's, does not write the
        // required size back into ngroups on truncation (rc == -1) — it
        // just fills what fits and gives no sizing hint. So on failure we
        // check the (possibly truncated) buffer we did get before growing
        // and retrying, since the group we care about may already be in
        // it, and cap retries at a sane upper bound rather than trusting
        // ngroups_inout to have grown.
        let mut ngroups: i32 = 16;
        loop {
            let mut groups: Vec<libc::gid_t> = vec![0; ngroups as usize];
            let mut ngroups_inout = ngroups;
            let rc = libc::getgrouplist(
                username,
                primary_gid as libc::c_int,
                groups.as_mut_ptr() as *mut libc::c_int,
                &mut ngroups_inout,
            );
            if rc >= 0 {
                groups.truncate(ngroups_inout.max(0) as usize);
                return groups.iter().any(|&g| g == admin_gid);
            }
            if groups.iter().any(|&g| g == admin_gid) {
                return true;
            }
            if ngroups >= 1024 {
                return false;
            }
            ngroups *= 2;
        }
    }
}

fn atomic_write(path: &Path, content: &str) -> std::io::Result<()> {
    let dir = path.parent().unwrap_or_else(|| Path::new("/"));
    let tmp_path = dir.join(format!(
        ".{}.tmp-{}",
        path.file_name().and_then(|n| n.to_str()).unwrap_or("hosts"),
        std::process::id()
    ));
    {
        let mut f = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o644)
            .open(&tmp_path)?;
        f.write_all(content.as_bytes())?;
        f.sync_all()?;
    }
    fs::rename(&tmp_path, path)?;
    Ok(())
}

fn flush_dns() -> Result<(), String> {
    let flush = Command::new("dscacheutil")
        .arg("-flushcache")
        .status()
        .map_err(|e| format!("dscacheutil failed to launch: {e}"))?;
    if !flush.success() {
        return Err("dscacheutil -flushcache exited with a non-zero status".to_string());
    }
    let hup = Command::new("killall")
        .args(["-HUP", "mDNSResponder"])
        .status()
        .map_err(|e| format!("killall failed to launch: {e}"))?;
    if !hup.success() {
        return Err("killall -HUP mDNSResponder exited with a non-zero status".to_string());
    }
    Ok(())
}

fn handle_client(mut stream: UnixStream) {
    let uid = match peer_uid(&stream) {
        Ok(uid) => uid,
        Err(_) => return,
    };
    if !is_admin(uid) {
        let _ = write_message(&mut stream, &Response::Err("unauthorized".to_string()));
        return;
    }

    loop {
        let request: Request = match read_message(&mut stream) {
            Ok(req) => req,
            Err(e) if e.kind() == ErrorKind::UnexpectedEof => return,
            Err(_) => return,
        };

        let response = match request {
            Request::Ping => Response::Pong,
            Request::WriteHosts { content } => match atomic_write(Path::new(HOSTS_PATH), &content) {
                Ok(()) => Response::WriteOk,
                Err(e) => Response::Err(format!("failed to write hosts file: {e}")),
            },
            Request::FlushDns => match flush_dns() {
                Ok(()) => Response::FlushOk,
                Err(e) => Response::Err(e),
            },
        };

        if write_message(&mut stream, &response).is_err() {
            return;
        }
    }
}

fn main() {
    let socket_path = Path::new(SOCKET_PATH);
    if socket_path.exists() {
        let _ = fs::remove_file(socket_path);
    }

    let listener = UnixListener::bind(socket_path).expect("failed to bind helper socket");
    // Any local user may connect; handle_client enforces admin-group
    // membership before honoring anything.
    let _ = fs::set_permissions(socket_path, fs::Permissions::from_mode(0o666));

    for incoming in listener.incoming() {
        match incoming {
            Ok(stream) => {
                std::thread::spawn(move || handle_client(stream));
            }
            Err(_) => continue,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Regression test for a real macOS quirk: getgrouplist doesn't report
    /// the required size on truncation (rc == -1) the way glibc does, so a
    /// naive "give up if the size didn't grow" loop incorrectly rejects
    /// admin users whose group list doesn't fit the initial guess. This
    /// runs as whatever user is running `cargo test`, which is a real
    /// admin account on the dev machine.
    #[test]
    fn is_admin_recognizes_the_current_admin_user() {
        let uid = unsafe { libc::getuid() };
        assert!(is_admin(uid), "expected uid {uid} to be recognized as admin");
    }

    #[test]
    fn is_admin_rejects_an_unassigned_high_uid() {
        // A UID unlikely to exist on any dev machine.
        assert!(!is_admin(999_999));
    }
}
