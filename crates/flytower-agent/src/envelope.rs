//! The message envelope, matching `packages/protocol/src/envelope.ts`: one JSON object per
//! line, `{id, verb, params}` in and `{id, ok, result | error}` out.

use serde::Serialize;
use serde_json::{Map, Value};

pub const PROTOCOL_VERSION: u32 = 1;

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
#[derive(Debug, Clone, PartialEq)]
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

/// One response line.
#[derive(Debug, Clone, PartialEq, Serialize)]
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

#[derive(Debug, Clone, PartialEq, Serialize)]
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
    pub fn is_ok(&self) -> bool {
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
