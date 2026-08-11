//! Privileged helper daemon for re:route. Installed once (as root,
//! via a LaunchDaemon) so the main app never needs a per-write admin
//! prompt again. Deliberately minimal: it exposes exactly two operations
//! — overwrite the hosts file, flush DNS — both hardcoded here, never
//! driven by a client-supplied path or shell command. The only thing a
//! client controls is the *content* to write, which is the entire point
//! of the app; there is no command or path injection surface.
//!
//! Authorization is two-layered:
//! 1. The connecting peer's UID must belong to the `admin` group (checked
//!    via the socket's peer credentials) — this alone only proves "some
//!    admin-owned process is asking," not that it's re:route.
//! 2. The peer must then also present the per-install shared secret at
//!    `HELPER_TOKEN_PATH` in a `Hello` handshake before any `Request` is
//!    honored. That file is written (root-owned, mode 0600) only by this
//!    daemon's own installer, at the same time as a copy is written into
//!    re:route's own app-data directory for the client to read back — so
//!    reaching this daemon now requires being re:route's installed client,
//!    not merely running as an admin user.

use std::ffi::{CStr, CString};
use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::os::unix::io::AsRawFd;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::Path;
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use helper_protocol::{read_message, write_message, Hello, Request, Response, HELPER_TOKEN_PATH, SOCKET_PATH};

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

/// Serializes every call into `is_admin`'s `unsafe` body. `getpwuid` and
/// `getgrnam` are specified around shared, non-reentrant static return
/// buffers (the reentrant variants are `getpwuid_r`/`getgrnam_r`), but
/// `handle_client` is invoked from a fresh thread per connection with no
/// other synchronization — without this lock, concurrent connections could
/// race on that shared state and corrupt each other's lookups mid-read.
static IS_ADMIN_LOCK: Mutex<()> = Mutex::new(());

/// True if `uid` belongs to the `admin` group, via the same directory
/// services lookup the OS itself uses (not just flat /etc/group), so this
/// correctly recognizes Open Directory-backed admin accounts.
fn is_admin(uid: u32) -> bool {
    let _guard = IS_ADMIN_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());

    unsafe {
        let pw = libc::getpwuid(uid);
        if pw.is_null() {
            return false;
        }
        let primary_gid = (*pw).pw_gid;
        // Copy the username out of getpwuid's static buffer immediately,
        // before any other libc call that might reuse or invalidate it.
        let username = CStr::from_ptr((*pw).pw_name).to_owned();

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
                username.as_ptr(),
                primary_gid as libc::c_int,
                groups.as_mut_ptr() as *mut libc::c_int,
                &mut ngroups_inout,
            );
            if rc >= 0 {
                groups.truncate(ngroups_inout.max(0) as usize);
                return groups.contains(&admin_gid);
            }
            if groups.contains(&admin_gid) {
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

/// Constant-time byte comparison so an invalid guess doesn't leak how many
/// leading bytes were correct via response timing. Not that a local Unix
/// socket is a realistic timing-attack vector, but the check is free.
fn constant_time_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    let mut diff: u8 = 0;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Caps concurrent connections so a burst of local connection attempts
/// (authorized or not — the cap applies before the admin-group/token
/// checks run) can't pin an unbounded number of threads/stacks in this
/// root process.
const MAX_CONCURRENT_CONNECTIONS: usize = 16;
static CONNECTION_COUNT: AtomicUsize = AtomicUsize::new(0);

/// Bounds how long a single request read may block, so a connection that
/// authenticates but then never sends (or half-sends) a request can't pin
/// its thread forever.
const REQUEST_READ_TIMEOUT: Duration = Duration::from_secs(30);

/// Decrements `CONNECTION_COUNT` when a connection's handler thread exits,
/// via any return path (success, error, or panic).
struct ConnectionGuard;

impl Drop for ConnectionGuard {
    fn drop(&mut self) {
        CONNECTION_COUNT.fetch_sub(1, Ordering::SeqCst);
    }
}

fn handle_client(mut stream: UnixStream, token: Arc<String>) {
    let uid = match peer_uid(&stream) {
        Ok(uid) => uid,
        Err(_) => return,
    };
    if !is_admin(uid) {
        let _ = write_message(&mut stream, &Response::Err("unauthorized".to_string()));
        return;
    }

    let hello: Hello = match read_message(&mut stream) {
        Ok(h) => h,
        Err(_) => return,
    };
    if token.is_empty() || !constant_time_eq(&hello.token, &token) {
        let _ = write_message(&mut stream, &Response::Err("unauthorized".to_string()));
        return;
    }
    if write_message(&mut stream, &Response::AuthOk).is_err() {
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
    // membership and the Hello token before honoring anything.
    let _ = fs::set_permissions(socket_path, fs::Permissions::from_mode(0o666));

    let token = fs::read_to_string(HELPER_TOKEN_PATH).unwrap_or_default().trim().to_string();
    if token.is_empty() {
        eprintln!(
            "warning: no readable token at {HELPER_TOKEN_PATH}; all connections will be rejected until reinstalled"
        );
    }
    let token = Arc::new(token);

    for incoming in listener.incoming() {
        match incoming {
            Ok(stream) => {
                if CONNECTION_COUNT.fetch_add(1, Ordering::SeqCst) >= MAX_CONCURRENT_CONNECTIONS {
                    CONNECTION_COUNT.fetch_sub(1, Ordering::SeqCst);
                    continue; // dropping `stream` here closes the connection
                }
                let _ = stream.set_read_timeout(Some(REQUEST_READ_TIMEOUT));
                let token = Arc::clone(&token);
                std::thread::spawn(move || {
                    let _guard = ConnectionGuard;
                    handle_client(stream, token);
                });
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
