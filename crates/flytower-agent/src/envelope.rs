//! The message envelope, matching `packages/protocol/src/envelope.ts`: one JSON object per
//! line, `{id, verb, params}` in and `{id, ok, result | error}` out.
//!
//! Protocol 2 adds subscriptions on the same connection: `{id, subscribe, params}` opens one,
//! the agent answers like any request, then sends `{id, event}` frames (and `{id, skipped}`
//! when the panel fell behind) until `{id, end, reason}`. `{id, cancel}` stops one early, and
//! `{ping}` keeps a connection with live subscriptions from looking dead.

use serde::Serialize;
use serde_json::{Map, Value};

/// What `ping` reports. Kept at 1 so panels that check it still work; `agent.hello` lists
/// every version this agent speaks.
pub const PROTOCOL_VERSION: u32 = 1;

/// The protocol versions this agent speaks, for `agent.hello`.
pub const PROTOCOL_VERSIONS: [u32; 2] = [1, 2];

/// Longest single message the agent will read, in bytes. Requests are tiny; this bounds memory.
pub const MAX_LINE_BYTES: usize = 64 * 1024;

/// Why a request failed. Serialises as the same strings as the TypeScript `ErrorCode`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    /// Not valid JSON, or not a valid envelope.
    BadRequest,
    UnknownVerb,
    InvalidParams,
    /// The caller isn't the panel.
    Forbidden,
    /// For example, the server already exists.
    Conflict,
    NotFound,
    /// The operation ran and failed.
    Failed,
    Internal,
}

impl ErrorCode {
    pub const ALL: [&str; 8] = [
        "bad_request",
        "unknown_verb",
        "invalid_params",
        "forbidden",
        "conflict",
        "not_found",
        "failed",
        "internal",
    ];
}

/// An error a handler returns, which becomes an error response.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentError {
    pub code: ErrorCode,
    pub message: String,
}

impl AgentError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

/// A request that passed the envelope checks. `params` is checked per verb later.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Request {
    pub id: String,
    pub verb: String,
    pub params: Value,
}

fn short_string(v: Option<&Value>) -> Option<String> {
    match v {
        Some(Value::String(s)) if (1..=64).contains(&s.chars().count()) => Some(s.clone()),
        _ => None,
    }
}

impl Request {
    /// Checks the envelope like the strict Zod `Request`: exactly `id`, `verb` and `params`,
    /// with `id` and `verb` 1 to 64 characters.
    #[must_use]
    pub fn parse(value: &Value) -> Option<Self> {
        let obj = value.as_object()?;
        if obj.len() != 3 || !obj.contains_key("params") {
            return None;
        }
        Some(Self {
            id: short_string(obj.get("id"))?,
            verb: short_string(obj.get("verb"))?,
            params: obj["params"].clone(),
        })
    }
}

/// A request to open a subscription: exactly `id`, `subscribe` (the verb) and `params`.
#[derive(Debug, Clone, PartialEq)]
pub struct Subscribe {
    pub id: String,
    pub verb: String,
    pub params: Value,
}

impl Subscribe {
    /// Checks the envelope like the strict Zod `Subscribe`.
    #[must_use]
    pub fn parse(value: &Value) -> Option<Self> {
        let obj = value.as_object()?;
        if obj.len() != 3 || !obj.contains_key("params") {
            return None;
        }
        Some(Self {
            id: short_string(obj.get("id"))?,
            verb: short_string(obj.get("subscribe"))?,
            params: obj["params"].clone(),
        })
    }
}

/// The id of a `{id, cancel: true}` message, if that's what `value` is.
#[must_use]
pub fn parse_cancel(value: &Value) -> Option<String> {
    let obj = value.as_object()?;
    (obj.len() == 2 && obj.get("cancel") == Some(&Value::Bool(true)))
        .then(|| short_string(obj.get("id")))
        .flatten()
}

/// Why a subscription ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EndReason {
    /// It had nothing more to send, such as a followed server being deleted.
    Finished,
    /// The panel cancelled it.
    Cancelled,
    /// It broke; `message` says how.
    Failed,
}

impl EndReason {
    pub const ALL: [&str; 3] = ["finished", "cancelled", "failed"];
}

/// How a subscription ended, as its stream returns it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct End {
    pub reason: EndReason,
    pub message: Option<String>,
}

impl End {
    #[must_use]
    pub fn new(reason: EndReason) -> Self {
        Self {
            reason,
            message: None,
        }
    }

    #[must_use]
    pub fn failed(message: impl Into<String>) -> Self {
        Self {
            reason: EndReason::Failed,
            message: Some(message.into()),
        }
    }
}

/// A line the agent sends after answering a subscribe. Each is one JSON object.
#[derive(Debug, Clone, PartialEq)]
pub enum Frame {
    Event { id: String, event: Value },
    Skipped { id: String, skipped: u64 },
    End { id: String, end: End },
    Ping,
}

impl Frame {
    /// The line to write: the JSON and a newline.
    #[must_use]
    pub fn encode(&self) -> String {
        let value = match self {
            Self::Event { id, event } => serde_json::json!({ "id": id, "event": event }),
            Self::Skipped { id, skipped } => serde_json::json!({ "id": id, "skipped": skipped }),
            Self::End { id, end } => {
                let mut v = serde_json::json!({ "id": id, "end": true, "reason": end.reason });
                if let Some(m) = &end.message {
                    v["message"] = Value::String(m.clone());
                }
                v
            }
            Self::Ping => serde_json::json!({ "ping": true }),
        };
        let mut line = value.to_string();
        line.push('\n');
        line
    }
}

/// True if `value` is a frame the TypeScript `Frame` schema accepts (a response or one of the
/// subscription frames). Used with the shared fixtures.
pub fn is_valid_frame(value: &Value) -> bool {
    if is_valid_response(value) {
        return true;
    }
    let Some(obj) = value.as_object() else {
        return false;
    };
    let id = matches!(obj.get("id"), Some(Value::String(_)));
    let keys: Vec<&str> = obj.keys().map(String::as_str).collect();
    let only = |allowed: &[&str]| keys.iter().all(|k| allowed.contains(k));
    if obj.contains_key("event") {
        return id && only(&["id", "event"]);
    }
    if let Some(n) = obj.get("skipped") {
        return id && only(&["id", "skipped"]) && n.as_u64().is_some_and(|n| n >= 1);
    }
    if obj.contains_key("end") {
        return id
            && only(&["id", "end", "reason", "message"])
            && obj.get("end") == Some(&Value::Bool(true))
            && matches!(obj.get("reason"), Some(Value::String(r)) if EndReason::ALL.contains(&r.as_str()))
            && obj.get("message").is_none_or(Value::is_string);
    }
    obj.len() == 1 && obj.get("ping") == Some(&Value::Bool(true))
}

/// One response line.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(untagged)]
pub enum Response {
    Ok {
        id: String,
        ok: True,
        result: Value,
    },
    Err {
        id: String,
        ok: False,
        error: ErrorBody,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ErrorBody {
    pub code: ErrorCode,
    pub message: String,
}

/// Serialises as `true`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct True;
impl Serialize for True {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_bool(true)
    }
}

/// Serialises as `false`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct False;
impl Serialize for False {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_bool(false)
    }
}

impl Response {
    pub fn ok(id: impl Into<String>, result: Value) -> Self {
        Self::Ok {
            id: id.into(),
            ok: True,
            result,
        }
    }

    pub fn err(id: impl Into<String>, error: &AgentError) -> Self {
        Self::Err {
            id: id.into(),
            ok: False,
            error: ErrorBody {
                code: error.code,
                message: error.message.clone(),
            },
        }
    }

    #[must_use]
    pub const fn is_ok(&self) -> bool {
        matches!(self, Self::Ok { .. })
    }

    /// The line to write: the JSON and a newline.
    #[must_use]
    pub fn encode(&self) -> String {
        let mut line = serde_json::to_string(self).unwrap_or_else(|_| {
            r#"{"id":"unknown","ok":false,"error":{"code":"internal","message":"unencodable"}}"#
                .into()
        });
        line.push('\n');
        line
    }
}

/// True if `value` is a response the TypeScript `Response` schema accepts. Used to check this
/// crate against the shared fixtures, and by clients written in Rust.
pub fn is_valid_response(value: &Value) -> bool {
    let Some(obj) = value.as_object() else {
        return false;
    };
    if !matches!(obj.get("id"), Some(Value::String(_))) {
        return false;
    }
    match obj.get("ok") {
        Some(Value::Bool(true)) => obj.contains_key("result"),
        Some(Value::Bool(false)) => obj
            .get("error")
            .and_then(Value::as_object)
            .is_some_and(|e: &Map<String, Value>| {
                matches!(e.get("code"), Some(Value::String(c)) if ErrorCode::ALL.contains(&c.as_str()))
                    && matches!(e.get("message"), Some(Value::String(_)))
            }),
        _ => false,
    }
}
