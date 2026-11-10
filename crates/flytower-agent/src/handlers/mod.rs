//! What each verb does. Ported verbs live in the modules below; the rest answer `failed` with
//! "not ported yet" until their stage lands, so the Rust agent can be run against a real panel
//! without pretending to do work it can't.

pub mod service;

use serde_json::{Value, json};

use crate::envelope::{AgentError, ErrorCode, PROTOCOL_VERSION};
use crate::exec::Exec;
use crate::verbs::Params;

/// Everything a handler may touch, from the same environment variables as the TypeScript
/// agent. Tests swap `exec` for a fake.
pub struct Context {
    pub version: String,
    pub exec: Box<dyn Exec>,
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
        Params::ServiceWait(p) => Ok(service::wait(&p.servers)),
        Params::ServiceStart(p) => service::action("start", &p.server, ctx),
        Params::ServiceStop(p) => service::action("stop", &p.server, ctx),
        Params::ServiceRestart(p) => service::action("restart", &p.server, ctx),
        _ => Err(AgentError::new(
            ErrorCode::Failed,
            "not ported to the Rust agent yet; use the TypeScript agent",
        )),
    }
}
