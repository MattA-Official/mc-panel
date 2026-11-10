//! Downloads, through `curl` (which the installer already requires), so the agent carries no
//! TLS stack of its own and nothing here needs a C compiler to cross-build. Everything that
//! matters for safety (checksums, and for releases the signature) is checked in Rust after.

use std::fs::File;
use std::io::Read;
use std::path::Path;
use std::sync::Arc;

use sha2::{Digest, Sha256};

use crate::envelope::{AgentError, ErrorCode};
use crate::exec::Exec;

pub const USER_AGENT: &str = "flytower-agent (+https://github.com/MattA-Official/mc-panel)";

pub trait Fetch: Send + Sync {
    /// The body of a small text response, such as JSON or SHA256SUMS.
    ///
    /// # Errors
    /// A message saying why, including a non-2xx status.
    fn text(&self, url: &str) -> Result<String, String>;
    /// Saves a response body to `dest`.
    ///
    /// # Errors
    /// A message saying why, including a non-2xx status.
    fn save(&self, url: &str, dest: &Path) -> Result<(), String>;
}

/// The real thing: `curl`, HTTPS only, following redirects (GitHub's downloads redirect).
pub struct Curl {
    pub exec: Arc<dyn Exec>,
}

const BASE: [&str; 8] = [
    "--fail",
    "--silent",
    "--show-error",
    "--location",
    "--proto",
    "=https",
    "--max-time",
    "600",
];

impl Curl {
    fn run(&self, url: &str, extra: &[&str]) -> Result<String, String> {
        let mut args: Vec<&str> = BASE.to_vec();
        args.extend(["--user-agent", USER_AGENT]);
        args.extend(extra);
        args.push("--");
        args.push(url);
        let r = self.exec.run("curl", &args);
        if r.code == 0 {
            Ok(r.stdout)
        } else {
            Err(r.stderr.trim().to_string())
        }
    }
}

impl Fetch for Curl {
    fn text(&self, url: &str) -> Result<String, String> {
        self.run(url, &["--header", "accept: application/json, text/plain"])
    }

    fn save(&self, url: &str, dest: &Path) -> Result<(), String> {
        let dest = dest.to_str().ok_or("download path isn't UTF-8")?;
        self.run(url, &["--output", dest]).map(drop)
    }
}

/// The SHA-256 of a file, in lowercase hex.
///
/// # Errors
/// If the file can't be read.
pub fn sha256_file(path: &Path) -> std::io::Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    let mut hex = String::with_capacity(64);
    for b in hasher.finalize() {
        use std::fmt::Write as _;
        let _ = write!(hex, "{b:02x}");
    }
    Ok(hex)
}

fn is_sha256(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

/// Downloads `url` to `dest` and checks its SHA-256; deletes the file if it doesn't match.
///
/// # Errors
/// `failed` with the reason.
pub fn download_verified(
    fetch: &dyn Fetch,
    url: &str,
    dest: &Path,
    sha256: &str,
) -> Result<(), AgentError> {
    let fail = |m: String| AgentError::new(ErrorCode::Failed, m);
    if !is_sha256(sha256) {
        return Err(fail("upstream gave no usable checksum".into()));
    }
    fetch
        .save(url, dest)
        .map_err(|e| fail(format!("download of {url} failed: {e}")))?;
    let got = sha256_file(dest).map_err(|e| fail(format!("can't read {}: {e}", dest.display())))?;
    if got != sha256.to_ascii_lowercase() {
        let _ = std::fs::remove_file(dest);
        return Err(fail(format!("checksum mismatch for {url}")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::handlers::testing::{Fake, TempRoot};

    #[test]
    fn hashes_files() {
        let root = TempRoot::new("sha");
        let file = Path::new(&root.paths.state).with_extension("txt");
        std::fs::write(&file, "abc").unwrap();
        assert_eq!(
            sha256_file(&file).unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn curl_is_https_only_and_never_reads_options_from_the_url() {
        let fake = Fake::new(vec![]);
        let curl = Curl {
            exec: Arc::new(fake.clone()),
        };
        curl.save("https://x.example/a", Path::new("/tmp/a"))
            .unwrap();
        let ran = fake.ran();
        assert!(ran[0].starts_with("curl --fail --silent --show-error --location --proto =https"));
        assert!(ran[0].ends_with("--output /tmp/a -- https://x.example/a"));
    }
}
