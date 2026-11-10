//! `flytower-updater <version> [--manual]`: switches Flytower to an installed release and
//! back again if it isn't healthy. The agent starts it as a transient systemd unit, through
//! the release's `bin/flytower-updater` wrapper.

use std::path::PathBuf;
use std::process::ExitCode;
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use flytower_agent::exec::{Exec, RealExec};
use flytower_agent::updater::{Updater, curl_health};
use flytower_agent::verbs::{UpdateState, is_version};

fn env(name: &str, fallback: &str) -> PathBuf {
    std::env::var(name)
        .unwrap_or_else(|_| fallback.to_string())
        .into()
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some(to) = args.first().filter(|v| is_version(v)) else {
        eprintln!("usage: flytower-updater <version> [--manual]");
        return ExitCode::from(2);
    };
    let exec: Arc<dyn Exec> = Arc::new(RealExec::default());
    let updater = Updater {
        prefix: env("FLYTOWER_PREFIX", "/opt/flytower"),
        panel_data: env("FLYTOWER_PANEL_DATA", "/var/lib/flytower"),
        config: env("FLYTOWER_CONFIG_DIR", "/etc/flytower"),
        systemd: env("FLYTOWER_SYSTEMD_DIR", "/etc/systemd/system"),
        state: env("FLYTOWER_AGENT_STATE_DIR", "/var/lib/flytower/agent"),
        health: curl_health(Arc::clone(&exec)),
        exec,
        sleep: Arc::new(std::thread::sleep),
        now: Arc::new(SystemTime::now),
        health_timeout: Duration::from_mins(2),
    };
    let record = updater.run_update(to, args.get(1).is_some_and(|f| f == "--manual"));
    println!("{}", serde_json::to_string(&record).unwrap_or_default());
    if record.state == UpdateState::Succeeded {
        ExitCode::SUCCESS
    } else {
        ExitCode::FAILURE
    }
}
