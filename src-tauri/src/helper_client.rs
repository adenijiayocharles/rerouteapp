//! Client for talking to the privileged helper daemon over its Unix
//! socket. This is the fast, no-prompt path; callers fall back to
//! `helper_install::install_and_write` (one elevated prompt) whenever
//! `ping()` reports the daemon isn't reachable.

#[cfg(target_os = "macos")]
mod imp {
    use std::io;
    use std::os::unix::net::UnixStream;
    use std::time::Duration;

    use helper_protocol::{read_message, write_message, Request, Response, SOCKET_PATH};

    fn connect() -> io::Result<UnixStream> {
        let stream = UnixStream::connect(SOCKET_PATH)?;
        stream.set_read_timeout(Some(Duration::from_secs(5)))?;
        stream.set_write_timeout(Some(Duration::from_secs(5)))?;
        Ok(stream)
    }

    pub fn ping() -> bool {
        let Ok(mut stream) = connect() else {
            return false;
        };
        if write_message(&mut stream, &Request::Ping).is_err() {
            return false;
        }
        matches!(read_message::<_, Response>(&mut stream), Ok(Response::Pong))
    }

    pub fn write_hosts(content: &str) -> Result<(), String> {
        let mut stream = connect().map_err(|e| format!("helper daemon unreachable: {e}"))?;
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

    pub fn flush_dns() -> Result<(), String> {
        let mut stream = connect().map_err(|e| format!("helper daemon unreachable: {e}"))?;
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
    pub fn ping() -> bool {
        false
    }
    pub fn write_hosts(_content: &str) -> Result<(), String> {
        Err("The background helper is not yet supported on this OS.".to_string())
    }
    pub fn flush_dns() -> Result<(), String> {
        Err("The background helper is not yet supported on this OS.".to_string())
    }
}

pub use imp::{flush_dns, ping, write_hosts};
