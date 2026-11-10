//! Disk use for Flytower: how many bytes a set of files and folders take on disk.
//!
//! This matches the panel's TypeScript walk (`apps/panel/server/disk.ts`) exactly:
//!
//! - Sizes are the space files really take (allocated blocks × 512), so sparse region files
//!   count for what they use, not their length.
//! - Symlinks are never followed and count for nothing.
//! - A file with several hard links is counted once, across every path in one call.
//! - A folder counts its own blocks as well as what's in it.
//! - A path that doesn't exist counts as zero. A path or folder that can't be read is
//!   counted in `unreadable` instead of failing the walk, so the total is a floor.
//!
//! Each path is walked by several threads at once, and paths are walked one after another,
//! so which path a shared hard link counts towards doesn't depend on timing.

use std::collections::HashSet;
use std::fs::{self, Metadata};
use std::io::ErrorKind;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Condvar, Mutex};
use std::thread;

/// What one path takes on disk.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Measured {
    /// Bytes on disk.
    pub bytes: u64,
    /// Files and folders that couldn't be read, so `bytes` is a floor.
    pub unreadable: u64,
}

/// How to walk.
#[derive(Debug, Clone, Copy)]
pub struct Options {
    /// Threads per path. At least one.
    pub threads: usize,
    /// Don't cross into other filesystems, like `du -x`. Mount points are skipped entirely.
    pub one_file_system: bool,
}

impl Default for Options {
    fn default() -> Self {
        let cpus = thread::available_parallelism().map_or(1, std::num::NonZero::get);
        // Leave room for the Minecraft servers on the same machine.
        Self {
            threads: cpus.clamp(1, 4),
            one_file_system: false,
        }
    }
}

/// Inodes already counted, so hard links count once.
type Seen = Mutex<HashSet<(u64, u64)>>;

/// Measures each path in turn. Results are in the same order as `paths`.
pub fn measure_all<P: AsRef<Path>>(paths: &[P], opts: Options) -> Vec<Measured> {
    let seen = Seen::default();
    paths
        .iter()
        .map(|p| measure(p.as_ref(), opts, &seen))
        .collect()
}

fn on_disk(m: &Metadata) -> u64 {
    m.blocks() * 512
}

/// A file's bytes, unless it's another link to an inode already counted.
fn file_bytes(m: &Metadata, seen: &Seen) -> u64 {
    if m.nlink() > 1 {
        let mut seen = seen
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if !seen.insert((m.dev(), m.ino())) {
            return 0;
        }
    }
    on_disk(m)
}

fn measure(path: &Path, opts: Options, seen: &Seen) -> Measured {
    let meta = match fs::symlink_metadata(path) {
        Ok(m) => m,
        Err(e) if e.kind() == ErrorKind::NotFound => return Measured::default(),
        Err(_) => {
            return Measured {
                bytes: 0,
                unreadable: 1,
            };
        }
    };
    if meta.file_type().is_symlink() {
        return Measured::default();
    }
    if !meta.is_dir() {
        return Measured {
            bytes: file_bytes(&meta, seen),
            unreadable: 0,
        };
    }
    let walk = Walk {
        queue: Mutex::new(Queue {
            dirs: vec![path.to_path_buf()],
            busy: 0,
        }),
        changed: Condvar::new(),
        bytes: AtomicU64::new(on_disk(&meta)),
        unreadable: AtomicU64::new(0),
        seen,
        root_dev: meta.dev(),
        one_file_system: opts.one_file_system,
    };
    thread::scope(|s| {
        for _ in 0..opts.threads.max(1) {
            s.spawn(|| walk.work());
        }
    });
    Measured {
        bytes: walk.bytes.into_inner(),
        unreadable: walk.unreadable.into_inner(),
    }
}

struct Queue {
    /// Folders waiting to be read.
    dirs: Vec<PathBuf>,
    /// Threads reading a folder right now, which may add more.
    busy: usize,
}

struct Walk<'a> {
    queue: Mutex<Queue>,
    changed: Condvar,
    bytes: AtomicU64,
    unreadable: AtomicU64,
    seen: &'a Seen,
    root_dev: u64,
    one_file_system: bool,
}

impl Walk<'_> {
    fn work(&self) {
        while let Some(dir) = self.next() {
            let found = self.read(&dir);
            let mut q = self.lock();
            q.dirs.extend(found);
            q.busy -= 1;
            drop(q);
            self.changed.notify_all();
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Queue> {
        self.queue
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// The next folder to read, or `None` once every folder has been read.
    fn next(&self) -> Option<PathBuf> {
        let mut q = self.lock();
        loop {
            if let Some(dir) = q.dirs.pop() {
                q.busy += 1;
                return Some(dir);
            }
            if q.busy == 0 {
                return None;
            }
            q = self
                .changed
                .wait(q)
                .unwrap_or_else(std::sync::PoisonError::into_inner);
        }
    }

    /// Counts what's in `dir` and returns the folders inside it.
    fn read(&self, dir: &Path) -> Vec<PathBuf> {
        let mut found = Vec::new();
        let Ok(entries) = fs::read_dir(dir) else {
            self.unreadable.fetch_add(1, Ordering::Relaxed);
            return found;
        };
        let mut bytes = 0;
        for entry in entries {
            let Ok(entry) = entry else {
                self.unreadable.fetch_add(1, Ordering::Relaxed);
                continue;
            };
            // Doesn't follow symlinks.
            let meta = match entry.metadata() {
                Ok(m) => m,
                // Deleted since the folder was read.
                Err(e) if e.kind() == ErrorKind::NotFound => continue,
                Err(_) => {
                    self.unreadable.fetch_add(1, Ordering::Relaxed);
                    continue;
                }
            };
            let kind = meta.file_type();
            if kind.is_symlink() {
                continue;
            }
            if kind.is_dir() {
                if self.one_file_system && meta.dev() != self.root_dev {
                    continue;
                }
                bytes += on_disk(&meta);
                found.push(entry.path());
            } else {
                bytes += file_bytes(&meta, self.seen);
            }
        }
        self.bytes.fetch_add(bytes, Ordering::Relaxed);
        found
    }
}
