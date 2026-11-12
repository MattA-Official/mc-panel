//! Talks to the agent over a real Unix socket, as the panel does.

use std::io::{BufRead, BufReader, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::UnixStream;
use std::sync::Arc;
use std::thread;

use flytower_agent::dispatch::dispatch;
use flytower_agent::envelope::MAX_LINE_BYTES;
use flytower_agent::envelope::Response;
use flytower_agent::exec::{Exec, RealExec};
use flytower_agent::fetch::Curl;
use flytower_agent::handlers::{Context, handle, system_clock};
use flytower_agent::server::{ListenOptions, bind, serve, serve_at_most};
use flytower_agent::units::Paths;
use serde_json::{Value, json};

#[test]
fn answers_in_order_over_a_socket() {
    let dir = std::env::temp_dir().join(format!("flytower-agent-socket-{}", std::process::id()));
    let opts = ListenOptions {
        socket_path: dir.join("agent.sock"),
        group: None,
    };
    let listener = bind(&opts).unwrap();
    let mode = std::fs::metadata(&opts.socket_path)
        .unwrap()
        .permissions()
        .mode();
    assert_eq!(mode & 0o777, 0o660);

    let exec: Arc<dyn Exec> = Arc::new(RealExec::default());
    let ctx = Context {
        version: "1.2.0-test".into(),
        exec: Arc::clone(&exec),
        now: system_clock(),
        fetch: Arc::new(Curl {
            exec: Arc::clone(&exec),
        }),
        arch: std::env::consts::ARCH.into(),
        events: None,
        paths: Paths::under(&dir),
        panel_group: "flytower".into(),
        releases_url: String::new(),
        release_key: String::new(),
        updating: Arc::default(),
    };
    thread::spawn(move || {
        serve(&listener, None, move |line| {
            dispatch(line, |p| handle(&p, &ctx), drop)
        });
    });

    let mut stream = UnixStream::connect(&opts.socket_path).unwrap();
    // Two requests in one write, the second split across writes.
    stream
        .write_all(b"{\"id\":\"a\",\"verb\":\"ping\",\"params\":{}}\n{\"id\":\"b\",\"verb\":\"service.start\",")
        .unwrap();
    stream.write_all(b"\"params\":{}}\n").unwrap();
    let mut reader = BufReader::new(stream.try_clone().unwrap());
    let mut read = || {
        let mut line = String::new();
        reader.read_line(&mut line).unwrap();
        line
    };
    let first: Value = serde_json::from_str(&read()).unwrap();
    assert_eq!(
        first,
        json!({ "id": "a", "ok": true, "result": { "agentVersion": "1.2.0-test", "protocol": 1 } })
    );
    let second: Value = serde_json::from_str(&read()).unwrap();
    assert_eq!(
        (second["id"].as_str(), second["error"]["code"].as_str()),
        (Some("b"), Some("invalid_params"))
    );

    // An overlong line drops the connection.
    stream.write_all(&vec![b'x'; MAX_LINE_BYTES + 1]).unwrap();
    assert_eq!(read(), "");

    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn turns_away_connections_over_the_limit_and_frees_their_slots() {
    let dir = std::env::temp_dir().join(format!("flytower-agent-cap-{}", std::process::id()));
    let opts = ListenOptions {
        socket_path: dir.join("agent.sock"),
        group: None,
    };
    let listener = bind(&opts).unwrap();
    thread::spawn(move || {
        serve_at_most(&listener, None, 2, |_| Response::ok("x", json!({})));
    });
    let ask = |stream: &mut UnixStream| {
        let _ = stream.write_all(b"{}\n");
        let mut line = String::new();
        BufReader::new(stream.try_clone().unwrap())
            .read_line(&mut line)
            .unwrap();
        serde_json::from_str::<Value>(&line).unwrap()
    };
    let mut first = UnixStream::connect(&opts.socket_path).unwrap();
    let mut second = UnixStream::connect(&opts.socket_path).unwrap();
    assert_eq!(ask(&mut first)["ok"], true);
    assert_eq!(ask(&mut second)["ok"], true);
    // A third is told the agent is busy, then closed.
    let mut third = UnixStream::connect(&opts.socket_path).unwrap();
    let mut line = String::new();
    BufReader::new(third.try_clone().unwrap())
        .read_line(&mut line)
        .unwrap();
    let busy: Value = serde_json::from_str(&line).unwrap();
    assert!(busy["error"]["message"].as_str().unwrap().contains("busy"));
    let _ = third.write_all(b"{}\n");
    // Closing one frees its slot.
    drop(first);
    let mut freed = None;
    for _ in 0..50 {
        let mut again = UnixStream::connect(&opts.socket_path).unwrap();
        if ask(&mut again)["ok"] == true {
            freed = Some(again);
            break;
        }
        thread::sleep(std::time::Duration::from_millis(20));
    }
    assert!(freed.is_some());
    drop(second);
    std::fs::remove_dir_all(dir).unwrap();
}
