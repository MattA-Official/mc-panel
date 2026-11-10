# Testing the Rust agent

The agent is the small helper that runs as root and does the jobs the panel can't: starting and stopping servers, creating their users and folders, the firewall, Java and updates. Releases now carry a Rust version of it beside the Bun one. It speaks the same protocol, so the panel can't tell which is running. It's **off by default**. Please try it on a **spare VPS**.

## Switching it on and off

On the VPS, as root:

```sh
echo rust > /etc/flytower/agent
systemctl restart flytower-agent
journalctl -u flytower-agent -n 5
```

The journal says `flytower-agent <version> (rust) listening`. To go back, delete the file and restart:

```sh
rm /etc/flytower/agent
systemctl restart flytower-agent
```

The choice survives updates. A release without the Rust agent ignores it and starts the Bun one.

## Checks

With the Rust agent on:

- [ ] **System**: the agent shows as connected, with the same version as the panel.
- [ ] **Start**, **Stop** and **Restart** a server. The status changes straight away, with no refresh.
- [ ] Stop the server from SSH (`systemctl stop flytower-mc@<name>`). The panel notices within a few seconds.
- [ ] Create a new server on a Java version you haven't used yet. Java downloads and the server starts.
- [ ] Change a server's memory and port in **Settings**, then restart it. Both take effect.
- [ ] **System**, **SSH**: open SSH for 5 minutes, check you can connect, then let it close by itself. Restart the agent while it's open and check it still closes on time.
- [ ] Delete a test server. Its folder is archived under `/var/lib/flytower/archive`.
- [ ] **System**, **Updates**: update to a newer build, then use **Go back to**. Both work, and the agent stays on Rust afterwards.
- [ ] Switch back to Bun, and check everything above still works with nothing left over.

If anything goes wrong, switch back to Bun and send `journalctl -u flytower-agent -n 100`.
