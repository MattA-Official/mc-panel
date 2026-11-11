//! What each verb does, one module per area, matching `packages/agent/src/handlers`. Every
//! verb in the protocol is handled here.

pub mod disk;
pub(crate) mod files;
pub mod runtime;
pub mod server;
pub mod service;
pub mod ssh;
#[cfg(test)]
pub mod testing;
pub mod update;

use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use std::time::{Duration, SystemTime};

use serde_json::{Value, json};

use crate::envelope::{AgentError, PROTOCOL_VERSION};
use crate::events::UnitEvents;
use crate::exec::Exec;
use crate::fetch::Fetch;
use crate::units::Paths;
use crate::verbs::Params;

/// What time it is. Tests set their own.
pub type Clock = Arc<dyn Fn() -> SystemTime + Send + Sync>;

#[must_use]
pub fn system_clock() -> Clock {
    Arc::new(SystemTime::now)
}

/// Everything a handler may touch, from the same environment variables as the TypeScript
/// agent. Tests swap `exec` for a fake.
pub struct Context {
    pub version: String,
    pub exec: Arc<dyn Exec>,
    pub now: Clock,
    /// Downloads; `curl` in production.
    pub fetch: Arc<dyn Fetch>,
    /// The CPU, as Rust names it: `x86_64` or `aarch64`.
    pub arch: String,
    /// Unit changes from the journal; `None` makes `service.wait` tell the panel to poll.
    pub events: Option<Arc<UnitEvents>>,
    pub paths: Paths,
    /// The panel's group, which may use the agent and shares server folders.
    pub panel_group: String,
    /// Where releases are downloaded from: `<url>/<tag>/<file>`.
    pub releases_url: String,
    /// The key releases are signed with, as a PEM `PUBLIC KEY`; tests use their own.
    pub release_key: String,
    /// Set while an update, a rollback or a clean-up of old releases runs.
    pub updating: Arc<AtomicBool>,
}

/// Runs one checked request.
///
/// # Errors
/// An [`AgentError`] that becomes the error response.
pub fn handle(params: &Params, ctx: &Context) -> Result<Value, AgentError> {
    match params {
        Params::Ping => Ok(json!({ "agentVersion": ctx.version, "protocol": PROTOCOL_VERSION })),
        Params::ServiceStatus(p) => service::status(&p.server, ctx),
        Params::ServiceUsage(p) => Ok(service::usage(&p.servers, ctx)),
        Params::ServiceWait(p) => Ok(match &ctx.events {
            Some(events) => {
                let timeout = Duration::from_millis(u64::try_from(p.timeout_ms).unwrap_or(0));
                events.wait(&p.servers, p.after.as_deref(), timeout)
            }
            None => service::not_following(&p.servers),
        }),
        Params::ServiceStart(p) => service::action("start", &p.server, ctx),
        Params::ServiceStop(p) => service::action("stop", &p.server, ctx),
        Params::ServiceRestart(p) => service::action("restart", &p.server, ctx),
        Params::ServerCreate(p) => server::create(&p.name, p.port, p.memory_mb, p.java_major, ctx),
        Params::ServerConfigure(p) => {
            server::configure(&p.name, p.memory_mb, p.port, p.java_major, ctx)
        }
        Params::ServerPermissions(p) => server::permissions(&p.name, ctx),
        Params::ServerDelete(p) => server::remove(&p.name, ctx),
        Params::RuntimeInstall(p) => runtime::install(p.major, ctx),
        Params::SshStatus => Ok(ssh::status(ctx)),
        Params::SshSet(p) => ssh::set(p.open, p.minutes, ctx),
        Params::UpdateStatus => Ok(update::status(ctx)),
        Params::UpdateInstall(p) => update::install(&p.version, ctx),
        Params::UpdateRollback(p) => update::rollback(&p.version, ctx),
        Params::DiskUsage(p) => Ok(disk::usage(&p.servers, p.system, ctx)),
        Params::DiskVacuumJournal(p) => disk::vacuum_journal(p.max_mb, ctx),
        Params::DiskCleanApt => disk::clean_apt(ctx),
        Params::DiskPruneFlytower => disk::prune_flytower(ctx),
    }
}
