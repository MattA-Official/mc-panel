//! `flytower-du [--threads N] [--one-file-system] [--] PATH...`
//!
//! Prints one line of JSON: `{"version":1,"results":[{"bytes":…,"unreadable":…},…]}`, with
//! the results in the same order as the paths. See the library docs for what's counted.

use std::ffi::OsString;
use std::fmt::Write as _;
use std::io::Write as _;
use std::process::ExitCode;

use flytower_du::{Options, measure_all};

const USAGE: &str = "usage: flytower-du [--threads N] [--one-file-system] [--] PATH...";

/// The output format. Bump it if a field changes meaning.
const FORMAT: u32 = 1;

fn parse(args: impl IntoIterator<Item = OsString>) -> Result<(Options, Vec<OsString>), String> {
    let mut opts = Options::default();
    let mut paths = Vec::new();
    let mut args = args.into_iter();
    while let Some(arg) = args.next() {
        match arg.to_str() {
            Some("--") => {
                paths.extend(args);
                break;
            }
            Some("-x" | "--one-file-system") => opts.one_file_system = true,
            Some("--threads") => {
                let n = args.next().and_then(|n| n.to_str()?.parse::<usize>().ok());
                match n {
                    Some(n @ 1..=64) => opts.threads = n,
                    _ => return Err("--threads takes a number from 1 to 64".into()),
                }
            }
            Some(flag) if flag.starts_with('-') => return Err(format!("unknown option {flag}")),
            _ => paths.push(arg),
        }
    }
    if paths.is_empty() {
        return Err("give at least one path".into());
    }
    Ok((opts, paths))
}

fn main() -> ExitCode {
    let args: Vec<OsString> = std::env::args_os().skip(1).collect();
    match args.first().and_then(|a| a.to_str()) {
        Some("--help" | "-h") => {
            println!("{USAGE}");
            return ExitCode::SUCCESS;
        }
        Some("--version" | "-V") => {
            println!("flytower-du {}", env!("CARGO_PKG_VERSION"));
            return ExitCode::SUCCESS;
        }
        _ => {}
    }
    let (opts, paths) = match parse(args) {
        Ok(parsed) => parsed,
        Err(e) => {
            eprintln!("flytower-du: {e}\n{USAGE}");
            return ExitCode::from(2);
        }
    };
    let mut out = format!("{{\"version\":{FORMAT},\"results\":[");
    for (i, m) in measure_all(&paths, opts).iter().enumerate() {
        let comma = if i == 0 { "" } else { "," };
        let _ = write!(
            out,
            "{comma}{{\"bytes\":{},\"unreadable\":{}}}",
            m.bytes, m.unreadable
        );
    }
    out.push_str("]}\n");
    if std::io::stdout().write_all(out.as_bytes()).is_err() {
        return ExitCode::FAILURE;
    }
    ExitCode::SUCCESS
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(a: &[&str]) -> Vec<OsString> {
        a.iter().map(OsString::from).collect()
    }

    #[test]
    fn parses_paths_and_options() {
        let (opts, paths) = parse(args(&["--threads", "2", "-x", "/a", "--", "--b"])).unwrap();
        assert_eq!(opts.threads, 2);
        assert!(opts.one_file_system);
        assert_eq!(paths, args(&["/a", "--b"]));
    }

    #[test]
    fn refuses_bad_input() {
        assert!(parse(args(&[])).is_err());
        assert!(parse(args(&["--threads", "0", "/a"])).is_err());
        assert!(parse(args(&["--threads", "lots", "/a"])).is_err());
        assert!(parse(args(&["--follow-symlinks", "/a"])).is_err());
    }
}
