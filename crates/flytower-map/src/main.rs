//! `flytower-map render --world DIR --out DIR [options]` draws a world's tiles and prints one
//! line of JSON saying what it did. `flytower-map dimensions --world DIR` lists what it would
//! draw. See the library docs for the output folder.

use std::ffi::OsString;
use std::fmt::Write as _;
use std::io::Write as _;
use std::path::PathBuf;
use std::process::ExitCode;
use std::time::Instant;

use flytower_map::palette::Palette;
use flytower_map::render::{self, Options};
use flytower_map::{manifest, quote, world};

const USAGE: &str = "\
usage: flytower-map render --world DIR --out DIR [--palette FILE] [--dimension ID]...
                           [--full] [--threads N] [--levels N]
       flytower-map dimensions --world DIR";

/// The output format. Bump it if a field changes meaning.
const FORMAT: u32 = 1;

#[derive(Default)]
struct Args {
    command: String,
    world: Option<PathBuf>,
    out: Option<PathBuf>,
    palette: Option<PathBuf>,
    only: Vec<String>,
    opts: Options,
}

fn parse(args: impl IntoIterator<Item = OsString>) -> Result<Args, String> {
    let mut parsed = Args::default();
    let mut args = args.into_iter();
    parsed.command = match args.next().and_then(|a| a.into_string().ok()) {
        Some(c) if c == "render" || c == "dimensions" => c,
        Some(c) => return Err(format!("unknown command {c}")),
        None => return Err("give a command".into()),
    };
    while let Some(arg) = args.next() {
        let flag = arg.to_str().unwrap_or("");
        let mut value = || args.next().ok_or(format!("{flag} needs a value"));
        match flag {
            "--world" => parsed.world = Some(value()?.into()),
            "--out" => parsed.out = Some(value()?.into()),
            "--palette" => parsed.palette = Some(value()?.into()),
            "--dimension" => parsed.only.push(value()?.to_string_lossy().into_owned()),
            "--full" => parsed.opts.full = true,
            "--threads" => match value()?.to_str().and_then(|n| n.parse().ok()) {
                Some(n @ 1..=64) => parsed.opts.threads = n,
                _ => return Err("--threads takes a number from 1 to 64".into()),
            },
            "--levels" => match value()?.to_str().and_then(|n| n.parse().ok()) {
                Some(n @ 0..=10) => parsed.opts.levels = n,
                _ => return Err("--levels takes a number from 0 to 10".into()),
            },
            _ => return Err(format!("unknown option {}", arg.to_string_lossy())),
        }
    }
    if parsed.world.is_none() {
        return Err("give --world".into());
    }
    if parsed.command == "render" && parsed.out.is_none() {
        return Err("give --out".into());
    }
    Ok(parsed)
}

fn main() -> ExitCode {
    let args: Vec<OsString> = std::env::args_os().skip(1).collect();
    match args.first().and_then(|a| a.to_str()) {
        Some("--help" | "-h") => {
            println!("{USAGE}");
            return ExitCode::SUCCESS;
        }
        Some("--version" | "-V") => {
            println!("flytower-map {}", env!("CARGO_PKG_VERSION"));
            return ExitCode::SUCCESS;
        }
        _ => {}
    }
    let args = match parse(args) {
        Ok(args) => args,
        Err(e) => {
            eprintln!("flytower-map: {e}\n{USAGE}");
            return ExitCode::from(2);
        }
    };
    match run(&args) {
        Ok(json) => {
            if std::io::stdout().write_all(json.as_bytes()).is_err() {
                return ExitCode::FAILURE;
            }
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("flytower-map: {e}");
            ExitCode::FAILURE
        }
    }
}

fn run(args: &Args) -> Result<String, String> {
    let world_dir = args.world.as_deref().unwrap_or(std::path::Path::new("."));
    if !world_dir.is_dir() {
        return Err(format!("{} isn't a folder", world_dir.display()));
    }
    let dims = world::dimensions(world_dir);
    let mut json = format!("{{\"version\":{FORMAT},");
    if args.command == "dimensions" {
        json.push_str("\"dimensions\":[");
        for (i, d) in dims.iter().enumerate() {
            let comma = if i == 0 { "" } else { "," };
            let _ = write!(
                json,
                "{comma}{{\"id\":{},\"regions\":{}}}",
                quote(&d.id),
                quote(&d.regions.to_string_lossy())
            );
        }
        json.push_str("]}\n");
        return Ok(json);
    }

    for id in &args.only {
        if !dims.iter().any(|d| &d.id == id) {
            return Err(format!("this world has no dimension {id}"));
        }
    }
    let palette = match &args.palette {
        Some(path) => {
            let text =
                std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
            Palette::parse(&text).map_err(|e| format!("{}: {e}", path.display()))?
        }
        None => Palette::builtin(),
    };
    let out = args.out.as_deref().unwrap_or(std::path::Path::new("."));
    let started = Instant::now();
    json.push_str("\"dimensions\":[");
    let chosen = dims
        .iter()
        .filter(|d| args.only.is_empty() || args.only.contains(&d.id));
    for (i, dim) in chosen.enumerate() {
        let r = render::render(dim, out, &palette, args.opts)
            .map_err(|e| format!("{}: {e}", dim.id))?;
        let comma = if i == 0 { "" } else { "," };
        let first_error = r.first_error.as_deref().map_or("null".into(), quote);
        let _ = write!(
            json,
            "{comma}{{\"id\":{},\"regions\":{},\"drawn\":{},\"unchanged\":{},\"removed\":{},\"chunks\":{},\"errors\":{},\"firstError\":{first_error}}}",
            quote(&r.id),
            r.regions,
            r.drawn,
            r.unchanged,
            r.removed,
            r.chunks,
            r.errors
        );
    }
    render::write_atomic(
        &out.join("maps.json"),
        manifest(out, &dims, args.opts.levels).as_bytes(),
    )
    .map_err(|e| format!("maps.json: {e}"))?;
    let _ = writeln!(json, "],\"ms\":{}}}", started.elapsed().as_millis());
    Ok(json)
}
