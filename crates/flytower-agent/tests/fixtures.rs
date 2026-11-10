//! Replays the shared protocol fixtures (`protocol/fixtures`), which the TypeScript tests also
//! replay against the Zod schemas, so both agents accept and refuse exactly the same messages.

use std::collections::BTreeSet;
use std::path::PathBuf;

use flytower_agent::envelope::{Request, is_valid_response};
use flytower_agent::verbs::{Params, VERBS, check_result};
use serde_json::Value;

fn fixtures(name: &str) -> Vec<Value> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../protocol/fixtures")
        .join(name);
    std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("{}: {e}", path.display()))
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| serde_json::from_str(l).expect("fixture lines are JSON"))
        .collect()
}

fn label(f: &Value) -> String {
    format!(
        "{} {} {}",
        f["verb"].as_str().unwrap_or(""),
        f["kind"],
        f["note"].as_str().unwrap_or("")
    )
}

#[test]
fn envelope() {
    let lines = fixtures("envelope.jsonl");
    assert!(!lines.is_empty());
    for f in lines {
        let valid = f["valid"].as_bool().unwrap();
        let got = match f["kind"].as_str().unwrap() {
            "request" => Request::parse(&f["value"]).is_some(),
            "response" => is_valid_response(&f["value"]),
            other => panic!("unknown kind {other}"),
        };
        assert_eq!(got, valid, "{}", label(&f));
    }
}

#[test]
fn verbs() {
    let mut seen = BTreeSet::new();
    for f in fixtures("verbs.jsonl") {
        let verb = f["verb"].as_str().unwrap();
        let valid = f["valid"].as_bool().unwrap();
        let kind = f["kind"].as_str().unwrap();
        let got = match kind {
            "params" => match Params::parse(verb, &f["value"]) {
                Ok(Some(_)) => true,
                Ok(None) => panic!("unknown verb {verb}"),
                Err(_) => false,
            },
            "result" => check_result(verb, &f["value"]).is_ok(),
            other => panic!("unknown kind {other}"),
        };
        assert_eq!(got, valid, "{}", label(&f));
        if valid {
            seen.insert((verb.to_string(), kind.to_string()));
        }
    }
    for verb in VERBS {
        for kind in ["params", "result"] {
            assert!(
                seen.contains(&(verb.to_string(), kind.to_string())),
                "no valid {kind} line for {verb}"
            );
        }
    }
}
