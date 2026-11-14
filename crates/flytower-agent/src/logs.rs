//! Following a server's log for `log.follow`, with inotify instead of polling. One follower
//! per server, however many subscribers, each with its own thread blocked in `read` on an
//! inotify descriptor. It watches the server's folder (for `logs` and `crash-reports`
//! appearing, and the server being deleted), the `logs` folder (for `latest.log` growing,
//! being rotated to a new file or truncated) and `crash-reports` (for new reports).
//!
//! Root reads files in a folder the server's user can change, so nothing here follows a
//! symlink, and `latest.log` must be a regular file with one link: a server can't point the
//! agent at someone else's file.

use std::collections::HashMap;
use std::fs::File;
use std::mem::MaybeUninit;
use std::os::fd::OwnedFd;
use std::os::unix::fs::{FileExt, MetadataExt};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::thread;

use rustix::fs::inotify::{self, CreateFlags, ReadFlags, WatchFlags};
use rustix::fs::{CWD, Mode, OFlags, openat};
use serde_json::{Value, json};

use crate::envelope::{AgentError, End, EndReason, ErrorCode};
use crate::stream::{Sink, Stream};

/// Longest line sent; the rest of a longer one is dropped.
pub const MAX_LINE: usize = 64 * 1024;

/// Most seed the panel may ask for.
pub const MAX_SEED: u64 = 1024 * 1024;

/// A batch of lines ends at whichever of these comes first, so one frame stays well under the
/// client's frame limit even when every character needs escaping.
const BATCH_LINES: usize = 512;
const BATCH_BYTES: usize = 128 * 1024;

/// How much is read from the file at a time.
const CHUNK: usize = 64 * 1024;

/// How many of the last bytes read are kept to notice a file rewritten in place.
const TAIL: usize = 64;

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// Splits bytes into whole lines, never sending half of one. A line over [`MAX_LINE`] is cut
/// there, and bad UTF-8 is replaced rather than refused.
#[derive(Default)]
pub struct Splitter {
    partial: Vec<u8>,
    /// Dropping the rest of a line that was too long.
    overflow: bool,
}

impl Splitter {
    pub fn feed(&mut self, mut data: &[u8], out: &mut Vec<String>) {
        while !data.is_empty() {
            let (seg, done, rest) = match data.iter().position(|&b| b == b'\n') {
                Some(i) => (&data[..i], true, &data[i + 1..]),
                None => (data, false, &[][..]),
            };
            data = rest;
            if self.overflow {
                self.overflow = !done;
                continue;
            }
            let room = MAX_LINE - self.partial.len();
            if seg.len() > room {
                self.partial.extend_from_slice(&seg[..room]);
                out.push(self.take());
                self.overflow = !done;
                continue;
            }
            self.partial.extend_from_slice(seg);
            if done {
                out.push(self.take());
            }
        }
    }

    /// The unfinished line, if any, as a line: for a file that has been rotated away.
    pub fn flush(&mut self, out: &mut Vec<String>) {
        if !self.partial.is_empty() {
            out.push(self.take());
        }
        self.overflow = false;
    }

    /// Bytes held back as an unfinished line.
    #[must_use]
    pub const fn pending(&self) -> usize {
        self.partial.len()
    }

    fn take(&mut self) -> String {
        let mut bytes = std::mem::take(&mut self.partial);
        if bytes.last() == Some(&b'\r') {
            bytes.pop();
        }
        String::from_utf8_lossy(&bytes).into_owned()
    }
}

/// Groups lines into events of at most [`BATCH_LINES`] lines and about [`BATCH_BYTES`].
fn batches(lines: Vec<String>, key: &str) -> Vec<Value> {
    let mut out = Vec::new();
    let mut batch = Vec::new();
    let mut bytes = 0;
    for line in lines {
        bytes += line.len();
        batch.push(line);
        if batch.len() >= BATCH_LINES || bytes >= BATCH_BYTES {
            out.push(json!({ key: std::mem::take(&mut batch) }));
            bytes = 0;
        }
    }
    if !batch.is_empty() {
        out.push(json!({ key: batch }));
    }
    out
}

const DIR: OFlags = OFlags::RDONLY
    .union(OFlags::DIRECTORY)
    .union(OFlags::NOFOLLOW)
    .union(OFlags::CLOEXEC);

/// `logs/latest.log` in `dir`, opened without following a symlink anywhere below `dir`, if
/// it's a regular file with a single link. Returns the file and its inode.
fn open_log(dir: &Path) -> Option<(File, u64)> {
    let server = openat(CWD, dir, DIR, Mode::empty()).ok()?;
    let logs = openat(&server, "logs", DIR, Mode::empty()).ok()?;
    let fd: OwnedFd = openat(
        &logs,
        "latest.log",
        OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
        Mode::empty(),
    )
    .ok()?;
    let file = File::from(fd);
    let meta = file.metadata().ok()?;
    (meta.is_file() && meta.nlink() == 1).then(|| (file, meta.ino()))
}

/// Where the last line of `file` starts: just after its last newline in the final
/// [`CHUNK`], or the end if that holds no newline (one line longer than that is cut anyway).
fn last_line_start(file: &File) -> u64 {
    let Ok(size) = file.metadata().map(|m| m.len()) else {
        return 0;
    };
    let from = size.saturating_sub(CHUNK as u64);
    let mut tail = vec![0u8; usize::try_from(size - from).unwrap_or(0)];
    if file.read_exact_at(&mut tail, from).is_err() {
        return size;
    }
    match tail.iter().rposition(|&b| b == b'\n') {
        Some(i) => from + i as u64 + 1,
        None if from == 0 => 0,
        None => size,
    }
}

struct Subscriber {
    sink: Sink,
    crashes: bool,
}

#[derive(Default)]
struct State {
    subs: Vec<Subscriber>,
    logs_wd: Option<i32>,
    crashes_wd: Option<i32>,
    /// The file being followed and its inode.
    file: Option<(File, u64)>,
    /// Bytes of `file` read so far.
    offset: u64,
    /// The last bytes read, up to [`TAIL`]. If they've changed, the file was truncated and
    /// written again, even if it has since grown past `offset`.
    tail: Vec<u8>,
    split: Splitter,
    /// No subscribers are left, or the server is gone: the follower is ending.
    stopping: bool,
}

impl State {
    fn send(&mut self, event: &Value, crash: bool) {
        self.subs
            .retain(|s| (crash && !s.crashes) || s.sink.send(event.clone()));
    }

    fn send_lines(&mut self, lines: Vec<String>) {
        for event in batches(lines, "lines") {
            self.send(&event, false);
        }
    }
}

/// Follows one server's log for every subscriber to it.
pub struct Follower {
    dir: PathBuf,
    inotify: OwnedFd,
    dir_wd: i32,
    state: Mutex<State>,
}

type Registry = Mutex<HashMap<PathBuf, Arc<Follower>>>;

fn registry() -> &'static Registry {
    static FOLLOWERS: OnceLock<Registry> = OnceLock::new();
    FOLLOWERS.get_or_init(Registry::default)
}

const SERVER_EVENTS: WatchFlags = WatchFlags::CREATE
    .union(WatchFlags::MOVED_TO)
    .union(WatchFlags::DELETE_SELF)
    .union(WatchFlags::MOVE_SELF)
    .union(WatchFlags::ONLYDIR)
    .union(WatchFlags::DONT_FOLLOW);
const LOG_EVENTS: WatchFlags = WatchFlags::MODIFY
    .union(WatchFlags::CREATE)
    .union(WatchFlags::MOVED_TO)
    .union(WatchFlags::MOVED_FROM)
    .union(WatchFlags::DELETE)
    .union(WatchFlags::ONLYDIR)
    .union(WatchFlags::DONT_FOLLOW);
const CRASH_EVENTS: WatchFlags = WatchFlags::CLOSE_WRITE
    .union(WatchFlags::MOVED_TO)
    .union(WatchFlags::ONLYDIR)
    .union(WatchFlags::DONT_FOLLOW);

fn no_server(dir: &Path) -> AgentError {
    let name = dir.file_name().unwrap_or_default().to_string_lossy();
    AgentError::new(ErrorCode::NotFound, format!("no server called {name}"))
}

/// The stream for one `log.follow` subscription to the server whose folder is `dir`. Checks
/// now that the server exists, so the panel gets `not_found` instead of a stream.
///
/// # Errors
/// `not_found` if `dir` isn't a real folder.
pub fn follow(dir: PathBuf, seed_bytes: u64, crashes: bool) -> Result<Stream, AgentError> {
    if !std::fs::symlink_metadata(&dir).is_ok_and(|m| m.is_dir()) {
        return Err(no_server(&dir));
    }
    Ok(Box::new(move |sink| {
        match join(&dir, sink, seed_bytes.min(MAX_SEED), crashes) {
            Ok(follower) => {
                sink.wait_until_stopped();
                follower.leave(sink);
            }
            Err(e) => sink.end(End::failed(e.message)),
        }
        sink.ended().unwrap_or(End::new(EndReason::Cancelled))
    }))
}

/// Adds `sink` to the server's follower, starting one if there isn't one, and sends it the
/// seed. Done under the registry's lock, so a follower that's just ending is never joined.
#[expect(
    clippy::significant_drop_tightening,
    reason = "the registry and the follower are locked together, in that order, so a follower is never joined while it ends"
)]
fn join(
    dir: &Path,
    sink: &Sink,
    seed_bytes: u64,
    crashes: bool,
) -> Result<Arc<Follower>, AgentError> {
    let mut followers = lock(registry());
    let follower = if let Some(f) = followers.get(dir) {
        Arc::clone(f)
    } else {
        let f = Follower::start(dir)?;
        followers.insert(dir.to_path_buf(), Arc::clone(&f));
        f
    };
    let mut st = lock(&follower.state);
    for event in batches(seed(&st, seed_bytes), "seed") {
        if !sink.send(event) {
            break;
        }
    }
    st.subs.push(Subscriber {
        sink: sink.clone(),
        crashes,
    });
    drop(st);
    Ok(follower)
}

/// The last `seed_bytes` of what's been sent, as whole lines.
fn seed(st: &State, seed_bytes: u64) -> Vec<String> {
    let Some((file, _)) = &st.file else {
        return Vec::new();
    };
    let end = st.offset - st.split.pending() as u64;
    let from = end.saturating_sub(seed_bytes);
    let Ok(len) = usize::try_from(end - from) else {
        return Vec::new();
    };
    let mut buf = vec![0u8; len];
    if file.read_exact_at(&mut buf, from).is_err() {
        return Vec::new();
    }
    // Starting mid-file, the first line is probably cut; drop it.
    let text = if from > 0 {
        buf.iter()
            .position(|&b| b == b'\n')
            .map_or(&[][..], |i| &buf[i + 1..])
    } else {
        &buf[..]
    };
    let mut lines = Vec::new();
    Splitter::default().feed(text, &mut lines);
    lines
}

impl Follower {
    #[expect(
        clippy::significant_drop_tightening,
        reason = "the state stays locked while it's first read"
    )]
    fn start(dir: &Path) -> Result<Arc<Self>, AgentError> {
        let failed = |e: rustix::io::Errno| {
            AgentError::new(ErrorCode::Failed, format!("can't follow the log: {e}"))
        };
        let fd = inotify::init(CreateFlags::CLOEXEC).map_err(failed)?;
        let dir_wd = match inotify::add_watch(&fd, dir, SERVER_EVENTS) {
            Ok(wd) => wd,
            Err(rustix::io::Errno::NOENT | rustix::io::Errno::NOTDIR) => {
                return Err(no_server(dir));
            }
            Err(e) => return Err(failed(e)),
        };
        let me = Arc::new(Self {
            dir: dir.to_path_buf(),
            inotify: fd,
            dir_wd,
            state: Mutex::default(),
        });
        // Start at the end (a log can be large, and the seed reads back from there), but at the
        // start of its last line, so a line being written isn't sent cut in two.
        {
            let mut st = lock(&me.state);
            let file = open_log(dir);
            if let Some((f, _)) = &file {
                let offset = last_line_start(f);
                let start = offset.saturating_sub(TAIL as u64);
                let mut tail = vec![0u8; usize::try_from(offset - start).unwrap_or(0)];
                if f.read_exact_at(&mut tail, start).is_ok() {
                    st.offset = offset;
                    st.tail = tail;
                }
            }
            st.file = file;
            me.sync(&mut st, &[]);
        }
        let run = Arc::clone(&me);
        thread::Builder::new()
            .name("log.follow".into())
            .stack_size(256 * 1024)
            .spawn(move || run.run())
            .map_err(|e| {
                AgentError::new(ErrorCode::Failed, format!("can't follow the log: {e}"))
            })?;
        Ok(me)
    }

    /// Takes a subscriber off. The last one to go stops the follower: removing the folder's
    /// watch wakes its thread, which then sees there's nobody left.
    #[expect(
        clippy::significant_drop_tightening,
        reason = "the registry and the follower are locked together, in that order, so a follower is never joined while it ends"
    )]
    fn leave(self: &Arc<Self>, sink: &Sink) {
        let mut followers = lock(registry());
        let mut st = lock(&self.state);
        st.subs.retain(|s| !s.sink.same(sink));
        if st.subs.is_empty() && !st.stopping {
            st.stopping = true;
            if followers
                .get(&self.dir)
                .is_some_and(|f| Arc::ptr_eq(f, self))
            {
                followers.remove(&self.dir);
            }
            let _ = inotify::remove_watch(&self.inotify, self.dir_wd);
        }
    }

    #[expect(
        clippy::significant_drop_tightening,
        reason = "the state stays locked while it's brought up to date"
    )]
    fn run(self: &Arc<Self>) {
        let mut buf = [MaybeUninit::<u8>::uninit(); 16 * 1024];
        let mut reader = inotify::Reader::new(&self.inotify, &mut buf);
        let mut crashes = Vec::new();
        loop {
            let mut gone = false;
            let mut forgot = Vec::new();
            // Wait for one event, then take every other one already read, and act once.
            loop {
                match reader.next() {
                    Ok(ev) => {
                        let mask = ev.events();
                        let wd = ev.wd();
                        if wd == self.dir_wd
                            && mask.intersects(ReadFlags::DELETE_SELF | ReadFlags::MOVE_SELF)
                        {
                            gone = true;
                        }
                        if mask.contains(ReadFlags::IGNORED) {
                            forgot.push(wd);
                        }
                        if mask.intersects(ReadFlags::CLOSE_WRITE | ReadFlags::MOVED_TO)
                            && let Some(name) = ev.file_name()
                        {
                            crashes.push((wd, name.to_string_lossy().into_owned()));
                        }
                    }
                    Err(rustix::io::Errno::INTR) => {}
                    Err(e) => {
                        self.finish(&End::failed(format!("following the log failed: {e}")));
                        return;
                    }
                }
                if reader.is_buffer_empty() {
                    break;
                }
            }
            let mut st = lock(&self.state);
            if st.stopping {
                return;
            }
            if gone || forgot.contains(&self.dir_wd) {
                drop(st);
                self.finish(&End {
                    reason: EndReason::Finished,
                    message: Some("the server was deleted".into()),
                });
                return;
            }
            for wd in forgot {
                if st.logs_wd == Some(wd) {
                    st.logs_wd = None;
                }
                if st.crashes_wd == Some(wd) {
                    st.crashes_wd = None;
                }
            }
            let reports: Vec<String> = std::mem::take(&mut crashes)
                .into_iter()
                .filter(|(wd, _)| st.crashes_wd == Some(*wd))
                .map(|(_, name)| name)
                .collect();
            self.sync(&mut st, &reports);
        }
    }

    /// Ends every subscriber and takes the follower out of the registry.
    #[expect(
        clippy::significant_drop_tightening,
        reason = "the registry and the follower are locked together, in that order, so a follower is never joined while it ends"
    )]
    fn finish(self: &Arc<Self>, end: &End) {
        let mut followers = lock(registry());
        let mut st = lock(&self.state);
        st.stopping = true;
        for s in st.subs.drain(..) {
            s.sink.end(end.clone());
        }
        if followers
            .get(&self.dir)
            .is_some_and(|f| Arc::ptr_eq(f, self))
        {
            followers.remove(&self.dir);
        }
    }

    /// Catches up: watches folders that have appeared, switches to a new `latest.log`, and
    /// sends what's been written since last time, then any new crash reports.
    fn sync(&self, st: &mut State, reports: &[String]) {
        if st.logs_wd.is_none() {
            st.logs_wd = inotify::add_watch(&self.inotify, self.dir.join("logs"), LOG_EVENTS).ok();
        }
        if st.crashes_wd.is_none() {
            st.crashes_wd =
                inotify::add_watch(&self.inotify, self.dir.join("crash-reports"), CRASH_EVENTS)
                    .ok();
        }
        let now = open_log(&self.dir);
        let same = matches!((&st.file, &now), (Some((_, a)), Some((_, b))) if a == b);
        if !same {
            // Whatever the old file got before it was rotated away is still news.
            let mut lines = Self::read_new(st);
            st.split.flush(&mut lines);
            st.send_lines(lines);
            st.file = now;
            st.offset = 0;
            st.tail.clear();
        }
        let lines = Self::read_new(st);
        st.send_lines(lines);
        for name in reports {
            let event = json!({ "crash": format!("crash-reports/{name}") });
            st.send(&event, true);
        }
    }

    /// Reads whatever `file` has past `offset`, starting again from the top if it shrank.
    fn read_new(st: &mut State) -> Vec<String> {
        let mut lines = Vec::new();
        let Some((file, _)) = &st.file else {
            return lines;
        };
        let Ok(size) = file.metadata().map(|m| m.len()) else {
            return lines;
        };
        let rewritten = size < st.offset || {
            let mut now = vec![0u8; st.tail.len()];
            let at = st.offset - st.tail.len() as u64;
            file.read_exact_at(&mut now, at).is_err() || now != st.tail
        };
        if rewritten {
            st.offset = 0;
            st.tail.clear();
            st.split = Splitter::default();
        }
        let mut chunk = vec![0u8; CHUNK];
        while st.offset < size {
            match file.read_at(&mut chunk, st.offset) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    st.offset += n as u64;
                    st.split.feed(&chunk[..n], &mut lines);
                    let keep = n.min(TAIL);
                    st.tail.drain(..st.tail.len().saturating_sub(TAIL - keep));
                    st.tail.extend_from_slice(&chunk[n - keep..n]);
                }
            }
        }
        lines
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stream::Outbox;
    use std::fs;
    use std::io::Write;
    use std::time::{Duration, Instant};

    struct Server {
        dir: PathBuf,
    }

    impl Server {
        fn new(label: &str) -> Self {
            static N: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
            let n = N.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let dir = std::env::temp_dir()
                .join(format!("flytower-logs-{label}-{}-{n}", std::process::id()));
            fs::create_dir_all(&dir).unwrap();
            Self { dir }
        }
        fn log(&self) -> PathBuf {
            self.dir.join("logs/latest.log")
        }
        fn append(&self, text: &str) {
            fs::create_dir_all(self.dir.join("logs")).unwrap();
            fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(self.log())
                .unwrap()
                .write_all(text.as_bytes())
                .unwrap();
        }
    }

    impl Drop for Server {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.dir);
        }
    }

    /// A subscription on its own outbox, with its stream running.
    struct Sub {
        out: Arc<Outbox>,
        stream: Option<thread::JoinHandle<End>>,
        got: Vec<Value>,
    }

    impl Sub {
        fn start(server: &Server, seed: u64, crashes: bool) -> Self {
            Self::start_on(Outbox::new(), server, seed, crashes)
        }

        fn start_on(out: Arc<Outbox>, server: &Server, seed: u64, crashes: bool) -> Self {
            let sink = out.open("s", "log.follow");
            let stream = follow(server.dir.clone(), seed, crashes).unwrap();
            let stream = Some(thread::spawn(move || stream(&sink)));
            Self {
                out,
                stream,
                got: Vec::new(),
            }
        }

        fn take(&mut self) {
            for line in self.out.ready_now().lines() {
                let v: Value = serde_json::from_str(line).unwrap();
                self.got.push(v);
            }
        }

        /// Every line received under `key` ("seed" or "lines").
        fn lines(&self, key: &str) -> Vec<String> {
            self.got
                .iter()
                .filter_map(|f| f["event"][key].as_array())
                .flatten()
                .map(|l| l.as_str().unwrap().to_string())
                .collect()
        }

        fn until(&mut self, what: &str, check: impl Fn(&Self) -> bool) {
            let deadline = Instant::now() + Duration::from_secs(10);
            loop {
                self.take();
                if check(self) {
                    return;
                }
                assert!(
                    Instant::now() < deadline,
                    "timed out waiting for {what}: {:?}",
                    self.got
                );
                thread::sleep(Duration::from_millis(5));
            }
        }

        fn stop(mut self) -> End {
            self.out.cancel("s");
            self.stream.take().unwrap().join().unwrap()
        }
    }

    fn follower_count(server: &Server) -> usize {
        usize::from(lock(registry()).contains_key(&server.dir))
    }

    #[test]
    fn splits_whole_lines_and_caps_long_ones() {
        let mut s = Splitter::default();
        let mut out = Vec::new();
        s.feed(b"one\r\ntw", &mut out);
        assert_eq!(out, ["one"]);
        s.feed(b"o\n\xff\xfe bad\n", &mut out);
        assert_eq!(out, ["one", "two", "\u{fffd}\u{fffd} bad"]);
        out.clear();
        let mut long = vec![b'x'; MAX_LINE + 10];
        long.extend_from_slice(b"\nnext\n");
        s.feed(&long, &mut out);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].len(), MAX_LINE);
        assert_eq!(out[1], "next");
        // A long line split over several reads is still cut once.
        out.clear();
        s.feed(&vec![b'y'; MAX_LINE - 1], &mut out);
        s.feed(b"yyyy", &mut out);
        s.feed(b"zz\nok\n", &mut out);
        assert_eq!(out.len(), 2);
        assert_eq!(out[1], "ok");
    }

    #[test]
    fn seeds_then_follows() {
        let server = Server::new("seed");
        server.append("first\nsecond\nthird\n");
        let mut sub = Sub::start(&server, 13, false);
        sub.until("the seed", |s| !s.lines("seed").is_empty());
        // 13 bytes reach back into "second", which is cut, so it's dropped.
        assert_eq!(sub.lines("seed"), ["third"]);
        server.append("fourth\nhalf");
        sub.until("fourth", |s| s.lines("lines") == ["fourth"]);
        server.append(" a line\n");
        sub.until("the rest", |s| {
            s.lines("lines") == ["fourth", "half a line"]
        });
        assert_eq!(sub.stop().reason, EndReason::Cancelled);
    }

    #[test]
    fn starts_at_the_end_without_cutting_a_line() {
        let server = Server::new("end");
        let old: String = (0..10_000)
            .map(|n| format!("old {n}\n"))
            .collect::<Vec<_>>()
            .concat();
        server.append(&old);
        server.append("being wri");
        let mut sub = Sub::start(&server, 10, false);
        sub.until("the seed", |s| !s.lines("seed").is_empty());
        assert_eq!(sub.lines("seed"), ["old 9999"]);
        server.append("tten\n");
        sub.until("the whole line", |s| s.lines("lines") == ["being written"]);
        let _ = sub.stop();
    }

    #[test]
    fn follows_rotation_and_truncation() {
        let server = Server::new("rotate");
        server.append("old 1\n");
        let mut sub = Sub::start(&server, 1024, false);
        sub.until("the seed", |s| s.lines("seed") == ["old 1"]);
        // Minecraft renames latest.log away and starts a new one.
        server.append("old 2\n");
        fs::rename(server.log(), server.dir.join("logs/2026-11-14-1.log")).unwrap();
        server.append("new 1\n");
        sub.until("the new file", |s| {
            s.lines("lines").contains(&"new 1".to_string())
        });
        assert_eq!(sub.lines("lines"), ["old 2", "new 1"]);
        // Truncated: what's there now is all new.
        fs::write(server.log(), "").unwrap();
        server.append("after\n");
        sub.until("after truncation", |s| {
            s.lines("lines").ends_with(&["after".to_string()])
        });
        let _ = sub.stop();
    }

    #[test]
    fn waits_for_a_server_that_has_never_run() {
        let server = Server::new("fresh");
        let mut sub = Sub::start(&server, 1024, false);
        thread::sleep(Duration::from_millis(50));
        server.append("Starting minecraft server\n");
        sub.until("the first line", |s| {
            s.lines("lines") == ["Starting minecraft server"]
        });
        assert!(sub.lines("seed").is_empty());
        let _ = sub.stop();
    }

    #[test]
    fn keeps_up_with_a_burst() {
        let server = Server::new("burst");
        server.append("");
        let mut sub = Sub::start(&server, 0, false);
        thread::sleep(Duration::from_millis(50));
        let text = (0..100_000)
            .map(|n| format!("line {n}\n"))
            .collect::<Vec<_>>()
            .concat();
        server.append(&text);
        sub.until("100k lines", |s| s.lines("lines").len() == 100_000);
        let lines = sub.lines("lines");
        assert_eq!(lines[0], "line 0");
        assert_eq!(lines[99_999], "line 99999");
        assert!(sub.got.iter().all(|f| f.get("skipped").is_none()));
        let _ = sub.stop();
    }

    #[test]
    fn tells_a_slow_reader_what_it_missed() {
        let server = Server::new("slow");
        server.append("");
        let mut sub = Sub::start_on(Outbox::with_queue(2), &server, 0, false);
        thread::sleep(Duration::from_millis(50));
        // Many small writes, each its own batch, with nobody reading.
        for n in 0..50 {
            server.append(&format!("line {n}\n"));
            thread::sleep(Duration::from_millis(2));
        }
        thread::sleep(Duration::from_millis(100));
        sub.until("a skip", |s| {
            s.got.iter().any(|f| f.get("skipped").is_some())
        });
        let _ = sub.stop();
    }

    #[test]
    fn ends_when_the_server_is_deleted() {
        let server = Server::new("deleted");
        server.append("hello\n");
        let mut sub = Sub::start(&server, 1024, false);
        sub.until("the seed", |s| !s.lines("seed").is_empty());
        fs::remove_dir_all(&server.dir).unwrap();
        let end = sub.stream.take().unwrap().join().unwrap();
        assert_eq!(
            end,
            End {
                reason: EndReason::Finished,
                message: Some("the server was deleted".into())
            }
        );
        assert_eq!(follower_count(&server), 0);
    }

    #[test]
    fn sends_crash_reports_to_those_who_asked() {
        let server = Server::new("crash");
        server.append("");
        fs::create_dir_all(server.dir.join("crash-reports")).unwrap();
        let mut wants = Sub::start(&server, 0, true);
        let mut not = Sub::start(&server, 0, false);
        thread::sleep(Duration::from_millis(50));
        fs::write(
            server
                .dir
                .join("crash-reports/crash-2026-11-14_01.00.00-server.txt"),
            "boom",
        )
        .unwrap();
        server.append("after the crash\n");
        wants.until("the crash", |s| {
            s.got.iter().any(|f| f["event"].get("crash").is_some())
        });
        not.until("the line", |s| s.lines("lines") == ["after the crash"]);
        assert!(not.got.iter().all(|f| f["event"].get("crash").is_none()));
        let crash = wants
            .got
            .iter()
            .find_map(|f| f["event"]["crash"].as_str())
            .unwrap()
            .to_string();
        assert_eq!(crash, "crash-reports/crash-2026-11-14_01.00.00-server.txt");
        let _ = wants.stop();
        let _ = not.stop();
    }

    #[test]
    fn shares_one_follower_and_stops_it_after_the_last() {
        let server = Server::new("shared");
        server.append("a\n");
        let mut one = Sub::start(&server, 1024, false);
        let mut two = Sub::start(&server, 1024, false);
        one.until("seed", |s| !s.lines("seed").is_empty());
        two.until("seed", |s| !s.lines("seed").is_empty());
        assert_eq!(follower_count(&server), 1);
        let follower = Arc::clone(lock(registry()).get(&server.dir).unwrap());
        assert_eq!(lock(&follower.state).subs.len(), 2);
        let _ = one.stop();
        assert_eq!(follower_count(&server), 1);
        let _ = two.stop();
        assert_eq!(follower_count(&server), 0);
        assert!(lock(&follower.state).stopping);
    }

    #[test]
    fn never_follows_a_symlink() {
        let server = Server::new("link");
        let secret = server.dir.join("secret");
        fs::write(&secret, "root only\n").unwrap();
        fs::create_dir_all(server.dir.join("logs")).unwrap();
        std::os::unix::fs::symlink(&secret, server.log()).unwrap();
        assert!(open_log(&server.dir).is_none());
        // A hard link to someone else's file has two links.
        fs::remove_file(server.log()).unwrap();
        fs::hard_link(&secret, server.log()).unwrap();
        assert!(open_log(&server.dir).is_none());
        // Nor a logs folder that's a link.
        fs::remove_dir_all(server.dir.join("logs")).unwrap();
        let elsewhere = Server::new("elsewhere");
        elsewhere.append("not yours\n");
        std::os::unix::fs::symlink(elsewhere.dir.join("logs"), server.dir.join("logs")).unwrap();
        assert!(open_log(&server.dir).is_none());
        assert!(open_log(&elsewhere.dir).is_some());
    }

    #[test]
    fn refuses_a_missing_server() {
        let server = Server::new("missing");
        let gone = server.dir.join("nope");
        let err = follow(gone, 0, false).err().unwrap();
        assert_eq!(err.code, ErrorCode::NotFound);
        assert_eq!(err.message, "no server called nope");
    }
}
