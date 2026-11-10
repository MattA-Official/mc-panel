//! The Unix socket server, like `packages/agent/src/server.ts`, plus the check Bun can't do:
//! the kernel's `SO_PEERCRED` says who connected, and only root or the panel's group may talk
//! to the agent. The socket's file mode still guards it as before; this is a second lock.

use std::fs;
use std::io::{self, Read, Write};
use std::os::unix::fs::{PermissionsExt, chown};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use crate::envelope::{AgentError, ErrorCode, MAX_LINE_BYTES, Response};

/// A connection idle this long is closed.
pub const IDLE_TIMEOUT: Duration = Duration::from_mins(10);

pub struct ListenOptions {
    pub socket_path: PathBuf,
    /// The group allowed to connect (the panel's). `None` skips chown and the peer check, for
    /// tests that don't run as root.
    pub group: Option<u32>,
}

/// Looks up a group id in an `/etc/group` style file.
///
/// # Errors
/// If the file can't be read or the group isn't in it.
pub fn group_id(name: &str, group_file: &Path) -> io::Result<u32> {
    fs::read_to_string(group_file)?
        .lines()
        .find_map(|line| {
            let mut parts = line.split(':');
            let group = parts.next()?;
            let gid = parts.nth(1)?;
            (group == name).then(|| gid.parse().ok()).flatten()
        })
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, format!("group {name} not found")))
}

/// True if a peer with this uid and gid may use the agent.
#[must_use]
pub fn allowed(uid: u32, gid: u32, panel_gid: u32) -> bool {
    uid == 0 || gid == panel_gid
}

/// Creates the socket: directory 0750 and socket 0660, both `root:<panel group>`.
///
/// # Errors
/// If the directory or socket can't be made or given the right owner and mode.
pub fn bind(opts: &ListenOptions) -> io::Result<UnixListener> {
    let dir = opts.socket_path.parent().unwrap_or(Path::new("/"));
    fs::create_dir_all(dir)?;
    match fs::remove_file(&opts.socket_path) {
        Err(e) if e.kind() != io::ErrorKind::NotFound => return Err(e),
        _ => {}
    }
    let listener = UnixListener::bind(&opts.socket_path)?;
    if let Some(gid) = opts.group {
        chown(dir, Some(0), Some(gid))?;
        chown(&opts.socket_path, Some(0), Some(gid))?;
        fs::set_permissions(dir, fs::Permissions::from_mode(0o750))?;
    }
    fs::set_permissions(&opts.socket_path, fs::Permissions::from_mode(0o660))?;
    Ok(listener)
}

/// Accepts connections forever, one thread each. `handle` turns a line into a response.
pub fn serve<H>(listener: &UnixListener, panel_gid: Option<u32>, handle: H)
where
    H: Fn(&str) -> Response + Send + Sync + 'static,
{
    let handle = Arc::new(handle);
    for stream in listener.incoming() {
        let Ok(stream) = stream else { continue };
        let handle = Arc::clone(&handle);
        thread::spawn(move || {
            // A connection that fails just ends; the panel reconnects.
            let _ = connection(stream, panel_gid, &*handle);
        });
    }
}

fn connection(
    mut stream: UnixStream,
    panel_gid: Option<u32>,
    handle: &dyn Fn(&str) -> Response,
) -> io::Result<()> {
    if let Some(panel_gid) = panel_gid {
        let cred = rustix::net::sockopt::socket_peercred(&stream)?;
        if !allowed(cred.uid.as_raw(), cred.gid.as_raw(), panel_gid) {
            let refused = AgentError::new(ErrorCode::Forbidden, "only the panel may use the agent");
            stream.write_all(Response::err("unknown", &refused).encode().as_bytes())?;
            return Ok(());
        }
    }
    stream.set_read_timeout(Some(IDLE_TIMEOUT))?;
    let mut writer = stream.try_clone()?;
    let mut lines = Lines::default();
    let mut chunk = [0u8; 8192];
    loop {
        let n = match stream.read(&mut chunk) {
            Ok(0) => return Ok(()),
            Ok(n) => n,
            Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
            // Includes the idle timeout.
            Err(e) => return Err(e),
        };
        // Requests on one connection are answered strictly in order.
        for line in lines.feed(&chunk[..n])? {
            writer.write_all(handle(&line).encode().as_bytes())?;
        }
    }
}

/// Splits a byte stream into lines, refusing any longer than [`MAX_LINE_BYTES`] (the caller
/// drops the connection). Blank lines are skipped.
#[derive(Default)]
pub struct Lines {
    buffer: Vec<u8>,
}

impl Lines {
    /// Adds `chunk` and returns the lines it completed.
    ///
    /// # Errors
    /// If the unfinished line is now too long.
    pub fn feed(&mut self, chunk: &[u8]) -> io::Result<Vec<String>> {
        self.buffer.extend_from_slice(chunk);
        let mut out = Vec::new();
        while let Some(nl) = self.buffer.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = self.buffer.drain(..=nl).collect();
            let line = String::from_utf8_lossy(&line[..nl]);
            if !line.trim().is_empty() {
                out.push(line.into_owned());
            }
        }
        if self.buffer.len() > MAX_LINE_BYTES {
            self.buffer.clear();
            return Err(io::Error::new(io::ErrorKind::InvalidData, "line too long"));
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_lines() {
        let mut l = Lines::default();
        assert_eq!(l.feed(b"{\"a\":").unwrap(), Vec::<String>::new());
        assert_eq!(
            l.feed(b"1}\n\n  \n{\"b\":2}\n{").unwrap(),
            vec!["{\"a\":1}", "{\"b\":2}"]
        );
        // A character split across chunks survives.
        let pound = "£".as_bytes();
        assert!(l.feed(&pound[..1]).unwrap().is_empty());
        assert_eq!(l.feed(&[pound[1], b'}', b'\n']).unwrap(), vec!["{£}"]);
    }

    #[test]
    fn refuses_long_lines() {
        let mut l = Lines::default();
        assert!(l.feed(&vec![b'x'; MAX_LINE_BYTES]).is_ok());
        assert!(l.feed(b"x").is_err());
    }

    #[test]
    fn reads_group_file() {
        let dir = std::env::temp_dir().join(format!("flytower-agent-group-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("group");
        fs::write(&file, "root:x:0:\nflytower:x:998:panel\nbroken\n").unwrap();
        assert_eq!(group_id("flytower", &file).unwrap(), 998);
        assert!(group_id("nobody", &file).is_err());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn peer_rules() {
        assert!(allowed(0, 0, 998));
        assert!(allowed(1001, 998, 998));
        assert!(!allowed(1001, 1001, 998));
    }
}
