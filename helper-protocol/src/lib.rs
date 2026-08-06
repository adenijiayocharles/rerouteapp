//! Wire protocol shared between the Hosts Manager app and its privileged
//! helper daemon. Kept deliberately narrow: the daemon never executes a
//! client-supplied shell command or path — only these two fixed
//! operations — so there is no command/argument injection surface even
//! though any process running as the current user can reach the socket.

use std::io::{self, Read, Write};

use serde::{Deserialize, Serialize};

pub const HELPER_LABEL: &str = "com.hostsmanager.app.helper";
pub const HELPER_BINARY_NAME: &str = "com.hostsmanager.app.helper";
pub const SOCKET_PATH: &str = "/var/run/com.hostsmanager.app.helper.sock";
pub const HELPER_INSTALL_DIR: &str = "/Library/PrivilegedHelperTools";
pub const LAUNCH_DAEMON_PLIST_PATH: &str = "/Library/LaunchDaemons/com.hostsmanager.app.helper.plist";

#[derive(Serialize, Deserialize, Debug)]
pub enum Request {
    Ping,
    /// Overwrites the hosts file (a fixed, hardcoded path inside the
    /// daemon) with `content`. The daemon does the atomic temp+rename
    /// write itself; the client never controls the destination path.
    WriteHosts { content: String },
    /// Runs the OS DNS-cache flush using fixed, hardcoded argv arrays —
    /// no shell, no client-supplied command string.
    FlushDns,
}

#[derive(Serialize, Deserialize, Debug)]
pub enum Response {
    Pong,
    WriteOk,
    FlushOk,
    Err(String),
}

/// Writes a single length-prefixed JSON message: a 4-byte big-endian
/// length followed by the JSON payload. Used identically by both sides so
/// the framing logic exists in exactly one place.
pub fn write_message<W: Write, T: Serialize>(mut w: W, value: &T) -> io::Result<()> {
    let payload = serde_json::to_vec(value)?;
    let len = u32::try_from(payload.len())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "message too large"))?;
    w.write_all(&len.to_be_bytes())?;
    w.write_all(&payload)?;
    w.flush()
}

pub fn read_message<R: Read, T: for<'de> Deserialize<'de>>(mut r: R) -> io::Result<T> {
    let mut len_buf = [0u8; 4];
    r.read_exact(&mut len_buf)?;
    let len = u32::from_be_bytes(len_buf) as usize;
    if len > 16 * 1024 * 1024 {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "message too large"));
    }
    let mut payload = vec![0u8; len];
    r.read_exact(&mut payload)?;
    serde_json::from_slice(&payload).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn write_then_read_round_trips_request() {
        let mut buf = Vec::new();
        write_message(&mut buf, &Request::WriteHosts { content: "127.0.0.1\thost\n".to_string() }).unwrap();
        let read_back: Request = read_message(Cursor::new(buf)).unwrap();
        match read_back {
            Request::WriteHosts { content } => assert_eq!(content, "127.0.0.1\thost\n"),
            other => panic!("expected WriteHosts, got {other:?}"),
        }
    }

    #[test]
    fn write_then_read_round_trips_response() {
        let mut buf = Vec::new();
        write_message(&mut buf, &Response::Err("boom".to_string())).unwrap();
        let read_back: Response = read_message(Cursor::new(buf)).unwrap();
        match read_back {
            Response::Err(msg) => assert_eq!(msg, "boom"),
            other => panic!("expected Err, got {other:?}"),
        }
    }

    #[test]
    fn read_message_rejects_oversized_length_prefix() {
        let mut buf = Vec::new();
        buf.extend_from_slice(&(64u32 * 1024 * 1024).to_be_bytes());
        let result: io::Result<Request> = read_message(Cursor::new(buf));
        assert!(result.is_err());
    }
}
