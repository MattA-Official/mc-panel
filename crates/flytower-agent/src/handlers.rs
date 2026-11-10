//! What each verb does. Only `ping` is ported so far; the rest answer `failed` with
//! "not ported yet" until their stage lands, so the Rust agent can be run against a real panel
//! without pretending to do work it can't.

use serde_json::{Value, json};

use crate::envelope::{AgentError, ErrorCode, PROTOCOL_VERSION};
use crate::verbs::Params;

/// Settings the handlers need, from the same environment variables as the TypeScript agent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Context {
    pub version: String,
}

/// Runs one checked request.
///
/// # Errors
/// An [`AgentError`] that becomes the error response.
pub fn handle(params: &Params, ctx: &Context) -> Result<Value, AgentError> {
    match params {
        Params::Ping => Ok(json!({ "agentVersion": ctx.version, "protocol": PROTOCOL_VERSION })),
        _ => Err(AgentError::new(
            ErrorCode::Failed,
            "not ported to the Rust agent yet; use the TypeScript agent",
        )),
    }
}
