//! Turns one request line into one response, like `packages/agent/src/dispatch.ts`. Never
//! panics on input: every failure becomes an error response, and every request is written to
//! the audit log.

use std::time::{Instant, SystemTime};

use serde_json::{Value, json};

use crate::envelope::{AgentError, ErrorCode, Request, Response};
use crate::verbs::{Params, check_result};

/// One audit log entry, as the JSON line the TypeScript agent writes.
#[must_use]
pub fn audit_line(at: SystemTime, id: &str, verb: &str, res: &Response, ms: u128) -> String {
    let mut entry = json!({
        "at": crate::time::iso(at),
        "id": id,
        "verb": verb,
        "outcome": if res.is_ok() { "ok" } else { "error" },
    });
    if let Response::Err { error, .. } = res {
        entry["code"] = json!(error.code);
    }
    entry["ms"] = json!(ms);
    json!({ "audit": entry }).to_string()
}

/// Handles `line` with `handler`, and passes the audit line to `log`.
pub fn dispatch(
    line: &str,
    handler: impl FnOnce(Params) -> Result<Value, AgentError>,
    log: impl FnOnce(String),
) -> Response {
    let at = SystemTime::now();
    let started = Instant::now();
    let mut id = "unknown".to_string();
    let mut verb = "unknown".to_string();
    let res = run(line, handler, &mut id, &mut verb);
    log(audit_line(
        at,
        &id,
        &verb,
        &res,
        started.elapsed().as_millis(),
    ));
    res
}

fn run(
    line: &str,
    handler: impl FnOnce(Params) -> Result<Value, AgentError>,
    id: &mut String,
    verb: &mut String,
) -> Response {
    let fail = |id: &str, code, message: &str| Response::err(id, &AgentError::new(code, message));

    let Ok(raw) = serde_json::from_str::<Value>(line) else {
        return fail(id, ErrorCode::BadRequest, "not valid JSON");
    };
    let Some(req) = Request::parse(&raw) else {
        return fail(id, ErrorCode::BadRequest, "not a valid request envelope");
    };
    id.clone_from(&req.id);
    verb.clone_from(&req.verb);

    // Like `params ?? {}`.
    let params = if req.params.is_null() {
        json!({})
    } else {
        req.params
    };
    let params = match Params::parse(&req.verb, &params) {
        Ok(Some(p)) => p,
        Ok(None) => {
            let quoted = Value::String(req.verb.clone()).to_string();
            return fail(
                id,
                ErrorCode::UnknownVerb,
                &format!("unknown verb {quoted}"),
            );
        }
        Err(message) => return fail(id, ErrorCode::InvalidParams, &message),
    };

    match handler(params) {
        Ok(result) => {
            if check_result(&req.verb, &result).is_err() {
                return fail(
                    id,
                    ErrorCode::Internal,
                    "handler returned an invalid result",
                );
            }
            Response::ok(id.as_str(), result)
        }
        Err(err) => Response::err(id.as_str(), &err),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(
        line: &str,
        handler: impl FnOnce(Params) -> Result<Value, AgentError>,
    ) -> (Value, Value) {
        let mut audit = String::new();
        let res = dispatch(line, handler, |l| audit = l);
        let res: Value = serde_json::from_str(&res.encode()).unwrap();
        (res, serde_json::from_str(&audit).unwrap())
    }

    #[expect(clippy::unnecessary_wraps, reason = "matches the handler type")]
    fn pong(_: Params) -> Result<Value, AgentError> {
        Ok(json!({ "agentVersion": "1.2.0", "protocol": 1 }))
    }

    #[test]
    fn answers_and_audits() {
        let (res, audit) = call(r#"{"id":"7","verb":"ping","params":{}}"#, pong);
        assert_eq!(
            res,
            json!({ "id": "7", "ok": true, "result": { "agentVersion": "1.2.0", "protocol": 1 } })
        );
        let a = &audit["audit"];
        assert_eq!(
            (a["id"].as_str(), a["verb"].as_str(), a["outcome"].as_str()),
            (Some("7"), Some("ping"), Some("ok"))
        );
        assert!(a.get("code").is_none());
        assert!(a["at"].as_str().unwrap().ends_with('Z'));
        assert!(a["ms"].is_u64());
    }

    #[test]
    fn null_params_mean_none() {
        let (res, _) = call(r#"{"id":"1","verb":"ping","params":null}"#, pong);
        assert_eq!(res["ok"], true);
    }

    #[test]
    fn refuses_bad_input() {
        let cases = [
            ("not json", "bad_request", "unknown"),
            (r#"{"id":"1","verb":"ping"}"#, "bad_request", "unknown"),
            (
                r#"{"id":"1","verb":"rm -rf","params":{}}"#,
                "unknown_verb",
                "1",
            ),
            (
                r#"{"id":"1","verb":"service.start","params":{"server":"../x"}}"#,
                "invalid_params",
                "1",
            ),
        ];
        for (line, code, id) in cases {
            let (res, audit) = call(line, |_| panic!("handler must not run for {line}"));
            assert_eq!(res["ok"], false, "{line}");
            assert_eq!(res["error"]["code"], code, "{line}");
            assert_eq!(res["id"], id, "{line}");
            assert_eq!(audit["audit"]["code"], code, "{line}");
        }
    }

    #[test]
    fn checks_results() {
        let (res, _) = call(r#"{"id":"1","verb":"ping","params":{}}"#, |_| {
            Ok(json!({ "protocol": "one" }))
        });
        assert_eq!(res["error"]["code"], "internal");
    }

    #[test]
    fn passes_handler_errors_on() {
        let (res, audit) = call(
            r#"{"id":"1","verb":"service.stop","params":{"server":"lobby"}}"#,
            |_| Err(AgentError::new(ErrorCode::NotFound, "no such server")),
        );
        assert_eq!(
            res["error"],
            json!({ "code": "not_found", "message": "no such server" })
        );
        assert_eq!(audit["audit"]["outcome"], "error");
    }
}
