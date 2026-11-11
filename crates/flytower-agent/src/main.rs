//! `flytower-agent`: listens on the agent socket and answers the panel. Configured by the same
//! environment variables as the TypeScript agent.

use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::Arc;
use std::time::Duration;

use flytower_agent::dispatch::dispatch;
use flytower_agent::events::{Journal, UnitEvents};
use flytower_agent::exec::{Exec, RealExec};
use flytower_agent::fetch::Curl;
use flytower_agent::handlers::{Context, handle, server, ssh, system_clock, update};
use flytower_agent::release::RELEASE_KEY;
use flytower_agent::server::{ListenOptions, bind, group_id, serve, user_id};
use flytower_agent::units::Paths;
use flytower_agent::{caddy, folders};

fn env(name: &str, fallback: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| fallback.to_string())
}

/// bin/flytower-agent writes this beside the socket before starting the Rust agent. If it's
/// still there on the next start, that start failed, and the wrapper falls back to Bun.
fn clear_start_marker(socket: &Path) {
    let marker = socket
        .parent()
        .unwrap_or(Path::new("/"))
        .join("agent-rust-starting");
    match std::fs::remove_file(&marker) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
            eprintln!("flytower-agent: can't remove {}: {e}", marker.display());
        }
        _ => {}
    }
}

fn main() -> ExitCode {
    if !rustix::process::geteuid().is_root() {
        eprintln!("flytower-agent must run as root");
        return ExitCode::FAILURE;
    }
    let exec: Arc<dyn Exec> = Arc::new(RealExec::default());
    let events = UnitEvents::new(Arc::new(Journal::default()), Duration::from_secs(5));
    events.start();
    let ctx = Context {
        version: env("FLYTOWER_VERSION", "0.0.0-dev"),
        exec: Arc::clone(&exec),
        now: system_clock(),
        fetch: Arc::new(Curl {
            exec: Arc::clone(&exec),
        }),
        arch: std::env::consts::ARCH.into(),
        events: Some(events),
        paths: Paths::from_env(),
        panel_group: env("FLYTOWER_PANEL_GROUP", "flytower"),
        releases_url: env("FLYTOWER_RELEASES_URL", update::RELEASES),
        release_key: RELEASE_KEY.into(),
        updating: Arc::default(),
    };
    let group = ctx.panel_group.clone();
    let gid = match group_id(&group, Path::new("/etc/group")) {
        Ok(gid) => gid,
        Err(e) => {
            eprintln!("flytower-agent: {e}");
            return ExitCode::FAILURE;
        }
    };
    let panel_user = env("FLYTOWER_PANEL_USER", "flytower");
    let uid = match user_id(&panel_user, Path::new("/etc/passwd")) {
        Ok(uid) => uid,
        Err(e) => {
            eprintln!("flytower-agent: {e}");
            return ExitCode::FAILURE;
        }
    };
    let opts = ListenOptions {
        socket_path: PathBuf::from(&ctx.paths.socket),
        group: Some(gid),
    };
    let listener = match bind(&opts) {
        Ok(l) => l,
        Err(e) => {
            eprintln!(
                "flytower-agent: can't listen on {}: {e}",
                opts.socket_path.display()
            );
            return ExitCode::FAILURE;
        }
    };
    println!("flytower-agent {} (rust) listening", ctx.version);
    // Tell bin/flytower-agent this start worked, so it keeps choosing Rust after a restart.
    clear_start_marker(&opts.socket_path);
    // Before anything reads or writes state: the folders, and what older releases left.
    if let Err(e) = folders::prepare(&ctx) {
        eprintln!("preparing the agent's folders failed: {}", e.message);
    }
    // An emergency SSH opening must end on time even if the agent restarted in between.
    if let Err(e) = ssh::restore(&ctx) {
        eprintln!("restoring the SSH timer failed: {}", e.message);
    }
    match server::refresh_template(&ctx) {
        Ok(true) => println!("updated the server unit template"),
        Ok(false) => {}
        Err(e) => eprintln!("updating the server unit template failed: {}", e.message),
    }
    match update::refresh_agent_unit(&ctx) {
        Ok(true) => println!("pointed the agent unit at bin/flytower-agent"),
        Ok(false) => {}
        Err(e) => eprintln!("updating the agent unit failed: {}", e.message),
    }
    match caddy::refresh_caddyfile(&ctx) {
        Ok(true) => println!("added server hostnames to the Caddyfile"),
        Ok(false) => {}
        Err(e) => eprintln!("updating the Caddyfile failed: {e}"),
    }
    serve(&listener, Some(uid), move |line| {
        // stdout goes to the journal; one JSON line per request.
        dispatch(line, |p| handle(&p, &ctx), |audit| println!("{audit}"))
    });
    ExitCode::SUCCESS
}
