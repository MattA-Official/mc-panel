//! Just enough of the zip format to read files out of the Minecraft client jar.
//!
//! Only stored and deflated entries, no zip64 and no encryption: the jar uses none of them.
//! Sizes are checked against the archive so a bad file can't make us allocate much.

use std::collections::HashMap;
use std::fmt;
use std::io::Read;

use flate2::read::DeflateDecoder;

/// Biggest single entry we'll read. The client jar's largest texture is well under this.
const MAX_ENTRY: u64 = 32 << 20;

/// Why the jar couldn't be read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Error(pub String);

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for Error {}

#[derive(Debug, Clone, Copy)]
struct Entry {
    method: u16,
    packed: usize,
    unpacked: u64,
    header: usize,
}

/// A zip archive in memory, indexed by file name.
pub struct Jar {
    data: Vec<u8>,
    entries: HashMap<String, Entry>,
}

fn u16_at(d: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_le_bytes(d.get(at..at + 2)?.try_into().ok()?))
}

fn u32_at(d: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(d.get(at..at + 4)?.try_into().ok()?))
}

fn size(n: u32) -> usize {
    usize::try_from(n).unwrap_or(usize::MAX)
}

impl Jar {
    /// Indexes an archive.
    ///
    /// # Errors
    ///
    /// When it isn't a zip file we can read.
    pub fn new(data: Vec<u8>) -> Result<Jar, Error> {
        let bad = |why: &str| Error(format!("not a jar we can read: {why}"));
        // The end record sits in the last 22 bytes plus up to 64 KiB of comment.
        let from = data.len().saturating_sub(22 + 0xffff);
        let end = (from..data.len().saturating_sub(21))
            .rev()
            .find(|&i| u32_at(&data, i) == Some(0x0605_4b50))
            .ok_or_else(|| bad("no end record"))?;
        let count = u16_at(&data, end + 10).ok_or_else(|| bad("short end record"))?;
        let mut at = size(u32_at(&data, end + 16).ok_or_else(|| bad("short end record"))?);
        let mut entries = HashMap::with_capacity(count.into());
        for _ in 0..count {
            let field = |off: usize| u32_at(&data, at + off).ok_or_else(|| bad("short directory"));
            if field(0)? != 0x0201_4b50 {
                return Err(bad("broken directory"));
            }
            let short = |off: usize| {
                u16_at(&data, at + off)
                    .map(usize::from)
                    .ok_or_else(|| bad("short directory"))
            };
            let method = u16_at(&data, at + 10).ok_or_else(|| bad("short directory"))?;
            let packed = size(field(20)?);
            let unpacked = u64::from(field(24)?);
            let (name_len, extra, comment) = (short(28)?, short(30)?, short(32)?);
            let header = size(field(42)?);
            let name = data
                .get(at + 46..at + 46 + name_len)
                .ok_or_else(|| bad("short directory"))?;
            let name = String::from_utf8_lossy(name).into_owned();
            entries.insert(
                name,
                Entry {
                    method,
                    packed,
                    unpacked,
                    header,
                },
            );
            at += 46 + name_len + extra + comment;
        }
        Ok(Jar { data, entries })
    }

    /// Names of every file, in no order.
    pub fn names(&self) -> impl Iterator<Item = &str> {
        self.entries.keys().map(String::as_str)
    }

    /// A file's contents, or `None` when it's missing or can't be read.
    #[must_use]
    pub fn read(&self, name: &str) -> Option<Vec<u8>> {
        let e = self.entries.get(name)?;
        if e.unpacked > MAX_ENTRY {
            return None;
        }
        let local = self.data.get(e.header..e.header + 30)?;
        if u32_at(local, 0)? != 0x0403_4b50 {
            return None;
        }
        let skip = 30 + usize::from(u16_at(local, 26)?) + usize::from(u16_at(local, 28)?);
        let start = e.header + skip;
        let packed = self.data.get(start..start.checked_add(e.packed)?)?;
        match e.method {
            0 => Some(packed.to_vec()),
            8 => {
                let mut out = Vec::new();
                DeflateDecoder::new(packed)
                    .take(MAX_ENTRY)
                    .read_to_end(&mut out)
                    .ok()?;
                Some(out)
            }
            _ => None,
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use flate2::Compression;
    use flate2::write::DeflateEncoder;
    use std::io::Write;

    /// Builds a zip with deflated entries, for tests here and in the palette builder.
    pub(crate) fn zip(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut out = Vec::new();
        let mut dir = Vec::new();
        for (name, body) in files {
            let mut e = DeflateEncoder::new(Vec::new(), Compression::fast());
            e.write_all(body).unwrap();
            let packed = e.finish().unwrap();
            let header = u32::try_from(out.len()).unwrap();
            let n = u16::try_from(name.len()).unwrap();
            let (plen, ulen) = (
                u32::try_from(packed.len()).unwrap(),
                u32::try_from(body.len()).unwrap(),
            );
            out.extend(0x0403_4b50u32.to_le_bytes());
            out.extend([20, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
            out.extend(plen.to_le_bytes());
            out.extend(ulen.to_le_bytes());
            out.extend(n.to_le_bytes());
            out.extend([0, 0]);
            out.extend(name.as_bytes());
            out.extend(&packed);
            dir.extend(0x0201_4b50u32.to_le_bytes());
            dir.extend([20, 0, 20, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
            dir.extend(plen.to_le_bytes());
            dir.extend(ulen.to_le_bytes());
            dir.extend(n.to_le_bytes());
            dir.extend([0; 12]);
            dir.extend(header.to_le_bytes());
            dir.extend(name.as_bytes());
        }
        let dir_at = u32::try_from(out.len()).unwrap();
        let count = u16::try_from(files.len()).unwrap();
        let dir_len = u32::try_from(dir.len()).unwrap();
        out.extend(dir);
        out.extend(0x0605_4b50u32.to_le_bytes());
        out.extend([0, 0, 0, 0]);
        out.extend(count.to_le_bytes());
        out.extend(count.to_le_bytes());
        out.extend(dir_len.to_le_bytes());
        out.extend(dir_at.to_le_bytes());
        out.extend([0, 0]);
        out
    }

    #[test]
    fn reads_deflated_entries() {
        let jar = Jar::new(zip(&[("a.txt", b"hello hello hello"), ("b/c.json", b"{}")])).unwrap();
        assert_eq!(
            jar.read("a.txt").as_deref(),
            Some(&b"hello hello hello"[..])
        );
        assert_eq!(jar.read("b/c.json").as_deref(), Some(&b"{}"[..]));
        assert_eq!(jar.read("nope"), None);
        let mut names: Vec<&str> = jar.names().collect();
        names.sort_unstable();
        assert_eq!(names, ["a.txt", "b/c.json"]);
    }

    #[test]
    fn refuses_things_that_are_not_zips() {
        assert!(Jar::new(b"not a zip at all".to_vec()).is_err());
        assert!(Jar::new(Vec::new()).is_err());
        let mut broken = zip(&[("a", b"x")]);
        let at = broken.len() - 6;
        broken[at..at + 4].copy_from_slice(&5u32.to_le_bytes());
        assert!(Jar::new(broken).is_err());
    }
}
