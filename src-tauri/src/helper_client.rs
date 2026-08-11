//! Client for talking to the privileged helper daemon over its Unix
//! socket. This is the fast, no-prompt path; callers fall back to
//! `helper_install::install_and_write` (one elevated prompt) whenever
//! `ping()` reports the daemon isn't reachable.
//!
//! Every call authenticates with a `Hello { token }` handshake before
//! sending its actual request — see `helper_protocol`'s module doc for why.
//! `load_token` reads the client's own copy of that per-install secret,
//! written into the app's data directory (mode 0600) by
//! `helper_install::install_and_write` at the same time the daemon's own
//! root-owned copy is installed.

use std::path::Path;

/// Filename (within the app's data directory) of the client's copy of the
/// per-install helper auth token.
pub const CLIENT_TOKEN_FILENAME: &str = "helper-token";

/// Reads the client's stored copy of the helper auth token, if any. `None`
/// means the helper has never been installed by this app instance (or its
/// token file was removed) — callers should treat the daemon as
/// unreachable and fall back to (re)installing it.
pub fn load_token(app_data_dir: &Path) -> Option<String> {
    std::fs::read_to_string(app_data_dir.join(CLIENT_TOKEN_FILENAME))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

#[cfg(target_os = "macos")]
mod imp {
    use std::io;
    use std::os::unix::net::UnixStream;
    use std::time::Duration;

    use helper_protocol::{read_message, write_message, Hello, Request, Response, SOCKET_PATH};

    fn connect() -> io::Result<UnixStream> {
        let stream = UnixStream::connect(SOCKET_PATH)?;
        stream.set_read_timeout(Some(Duration::from_secs(5)))?;
        stream.set_write_timeout(Some(Duration::from_secs(5)))?;
        Ok(stream)
    }

    /// Sends the `Hello` handshake and requires `AuthOk` back before the
    /// caller proceeds to send its actual `Request`.
    fn authenticate(stream: &mut UnixStream, token: &str) -> io::Result<()> {
        write_message(
            &mut *stream,
            &Hello {
                token: token.to_string(),
            },
        )?;
        match read_message::<_, Response>(&mut *stream)? {
            Response::AuthOk => Ok(()),
            _ => Err(io::Error::new(io::ErrorKind::PermissionDenied, "helper rejected auth token")),
        }
    }

    pub fn ping(token: &str) -> bool {
        let Ok(mut stream) = connect() else {
            return false;
        };
        if authenticate(&mut stream, token).is_err() {
            return false;
        }
        if write_message(&mut stream, &Request::Ping).is_err() {
            return false;
        }
        matches!(read_message::<_, Response>(&mut stream), Ok(Response::Pong))
    }

    pub fn write_hosts(token: &str, content: &str) -> Result<(), String> {
        let mut stream = connect().map_err(|e| format!("helper daemon unreachable: {e}"))?;
        authenticate(&mut stream, token).map_err(|e| format!("helper authentication failed: {e}"))?;
        write_message(
            &mut stream,
            &Request::WriteHosts {
                content: content.to_string(),
            },
        )
        .map_err(|e| format!("failed to send request to helper: {e}"))?;
        match read_message::<_, Response>(&mut stream) {
            Ok(Response::WriteOk) => Ok(()),
            Ok(Response::Err(e)) => Err(e),
            Ok(_) => Err("unexpected response from helper".to_string()),
            Err(e) => Err(format!("failed to read response from helper: {e}")),
        }
    }

    pub fn flush_dns(token: &str) -> Result<(), String> {
        let mut stream = connect().map_err(|e| format!("helper daemon unreachable: {e}"))?;
        authenticate(&mut stream, token).map_err(|e| format!("helper authentication failed: {e}"))?;
        write_message(&mut stream, &Request::FlushDns)
            .map_err(|e| format!("failed to send request to helper: {e}"))?;
        match read_message::<_, Response>(&mut stream) {
            Ok(Response::FlushOk) => Ok(()),
            Ok(Response::Err(e)) => Err(e),
            Ok(_) => Err("unexpected response from helper".to_string()),
            Err(e) => Err(format!("failed to read response from helper: {e}")),
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    // TODO: verify on this OS. The background-helper daemon is
    // currently macOS-only.
    pub fn ping(_token: &str) -> bool {
        false
    }
    pub fn write_hosts(_token: &str, _content: &str) -> Result<(), String> {
        Err("The background helper is not yet supported on this OS.".to_string())
    }
    pub fn flush_dns(_token: &str) -> Result<(), String> {
        Err("The background helper is not yet supported on this OS.".to_string())
    }
}

pub use imp::{flush_dns, ping, write_hosts};
