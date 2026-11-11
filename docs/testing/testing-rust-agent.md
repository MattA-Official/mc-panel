# Testing the Rust agent

The agent is the small helper that runs as root and does the jobs the panel can't: starting and stopping servers, creating their users and folders, the firewall, Java and updates. From 1.4.0 the Rust version is the **default**, and the Bun one stays in each release as a fallback for at least one more release. They speak the same protocol, so the panel can't tell which is running.

## Which one is running

On the VPS, as root:

```sh
journalctl -u flytower-agent -n 5
```

The Rust agent says `flytower-agent <version> (rust) listening`. The Bun one says `flytower-agent <version> listening`.

## Choosing Bun

To use the Bun agent instead, as root:

```sh
echo bun > /etc/flytower/agent
systemctl restart flytower-agent
```

Delete the file and restart to go back to Rust. The choice survives updates, and it covers the updater too: with Bun chosen, updates and **Go back to** are run by the Bun updater. `echo rust` from earlier releases still means Rust. A release without the Rust versions uses the Bun ones whatever the file says.

## If the Rust agent won't start

Before starting the Rust agent, `bin/flytower-agent` leaves a marker at `/run/flytower/agent-rust-starting`, and the Rust agent deletes it once it's listening. If the Rust agent stops before that, systemd restarts the agent two seconds later, the marker is still there, and Bun starts instead. The journal says:

```
flytower-agent: the Rust agent didn't start last time, so using the Bun agent. ...
```

While that marker is there, the updater uses Bun too. It stays on Bun until the next reboot (the marker lives in `/run`) or the next update (the marker names the release it was for). To try Rust again straight away, `rm /run/flytower/agent-rust-starting` and restart `flytower-agent`.

This only covers a failed start. A Rust agent that crashes after it's listening is restarted as Rust, like the Bun one always has been.

## Checks

With the Rust agent (the default):

- [ ] After installing or updating, the journal shows the Rust agent listening, with no `/etc/flytower/agent` file.
- [ ] **System**: the agent shows as connected, with the same version as the panel.
- [ ] **Start**, **Stop** and **Restart** a server. The status changes straight away, with no refresh.
- [ ] Stop the server from SSH (`systemctl stop flytower-mc@<name>`). The panel notices within a few seconds.
- [ ] Create a new server on a Java version you haven't used yet. Java downloads and the server starts.
- [ ] Change a server's memory and port in **Settings**, then restart it. Both take effect.
- [ ] **System**, **SSH**: open SSH for 5 minutes, check you can connect, then let it close by itself. Restart the agent while it's open and check it still closes on time.
- [ ] Delete a test server. Its folder is archived under `/var/lib/flytower/archive`.
- [ ] **System**, **Updates**: update to a newer build, then use **Go back to**. Both work, the agent stays on Rust afterwards, and `journalctl -u 'flytower-update-*'` shows the updater's result as one JSON line.
- [ ] Fallback: `cp /opt/flytower/current/bin/flytower-agent-rust /root/` then `echo 'exit 1' > /opt/flytower/current/bin/flytower-agent-rust` and restart `flytower-agent`. Within a few seconds the journal shows the fallback message and the Bun agent listening, and the panel still works. Put the binary back (`cp /root/flytower-agent-rust /opt/flytower/current/bin/`), delete the marker, restart, and it's Rust again.
- [ ] Choose Bun as above, and check everything still works with nothing left over.

If anything goes wrong, choose Bun and send `journalctl -u flytower-agent -n 100`.
