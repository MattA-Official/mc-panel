//! `flytower-agent`: listens on the agent socket and answers the panel. Configured by the same
//! environment variables as the TypeScript agent.

use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::Arc;
use std::time::Duration;

use flytower_agent::dispatch::dispatch;
use flytower_agent::events::{Journal, UnitEvents};
use flytower_agent::exec::RealExec;
use flytower_agent::handlers::{Context, handle, server};
use flytower_agent::server::{ListenOptions, bind, group_id, serve};
use flytower_agent::units::Paths;

fn env(name: &str, fallback: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| fallback.to_string())
}

fn main() -> ExitCode {
    if !rustix::process::geteuid().is_root() {
        eprintln!("flytower-agent must run as root");
        return ExitCode::FAILURE;
    }
    let events = UnitEvents::new(Arc::new(Journal::default()), Duration::from_secs(5));
    events.start();
    let ctx = Context {
        version: env("FLYTOWER_VERSION", "0.0.0-dev"),
        exec: Box::new(RealExec::default()),
        events: Some(events),
        paths: Paths::from_env(),
        panel_group: env("FLYTOWER_PANEL_GROUP", "flytower"),
    };
    let group = ctx.panel_group.clone();
    let gid = match group_id(&group, Path::new("/etc/group")) {
        Ok(gid) => gid,
        Err(e) => {
            eprintln!("flytower-agent: {e}");
            return ExitCode::FAILURE;
        }
    };
    let opts = ListenOptions {
        socket_path: PathBuf::from(env("FLYTOWER_AGENT_SOCKET", "/run/flytower/agent.sock")),
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
    match server::refresh_template(&ctx) {
        Ok(true) => println!("updated the server unit template"),
        Ok(false) => {}
        Err(e) => eprintln!("updating the server unit template failed: {}", e.message),
    }
    serve(&listener, Some(gid), move |line| {
        // stdout goes to the journal; one JSON line per request.
        dispatch(line, |p| handle(&p, &ctx), |audit| println!("{audit}"))
    });
    ExitCode::SUCCESS
}
