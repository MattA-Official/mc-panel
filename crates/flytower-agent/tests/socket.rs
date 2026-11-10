//! Talks to the agent over a real Unix socket, as the panel does.

use std::io::{BufRead, BufReader, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::UnixStream;
use std::thread;

use flytower_agent::dispatch::dispatch;
use flytower_agent::envelope::MAX_LINE_BYTES;
use flytower_agent::exec::RealExec;
use flytower_agent::handlers::{Context, handle};
use flytower_agent::server::{ListenOptions, bind, serve};
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

    let ctx = Context {
        version: "1.2.0-test".into(),
        exec: Box::new(RealExec::default()),
        events: None,
    };
    thread::spawn(move || {
        serve(&listener, None, move |line| {
            dispatch(line, |p| handle(&p, &ctx), drop)
        });
    });

    let mut stream = UnixStream::connect(&opts.socket_path).unwrap();
    // Two requests in one write, the second split across writes.
    stream
        .write_all(b"{\"id\":\"a\",\"verb\":\"ping\",\"params\":{}}\n{\"id\":\"b\",\"verb\":\"ssh.status\",")
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
        (Some("b"), Some("failed"))
    );

    // An overlong line drops the connection.
    stream.write_all(&vec![b'x'; MAX_LINE_BYTES + 1]).unwrap();
    assert_eq!(read(), "");

    std::fs::remove_dir_all(dir).unwrap();
}
