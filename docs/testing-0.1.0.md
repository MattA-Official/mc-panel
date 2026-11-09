# Testing 0.1.0

Thanks for testing. This release is the skeleton: install, sign in with a passkey, create a server, start it and use its console. Please use a **throwaway VPS** and a **new world**. Don't point it at a world you care about yet.

Allow about 30 minutes.

## 1. Install

Follow [Option A in the install guide](install.md#option-a-hetzner-cloud-no-ssh-at-all), using a spare subdomain for the panel.

- [ ] The panel loads over HTTPS at your domain.
- [ ] A wrong setup token is refused; the right one moves you on.
- [ ] Creating a passkey works on your device (Touch ID, Windows Hello, phone, or a security key).
- [ ] You're shown 10 recovery codes and asked to type one back.

## 2. Create a server

- [ ] **New server:** name it, pick **Fabric** and the newest Minecraft version, leave memory at the default, tick the EULA, and create it.
- [ ] The progress list ticks through every step and ends with "Curtain up". The first server takes a few minutes because Java is downloaded.
- [ ] **Go to server:** the console shows the server starting and ends with `Done (…)! For help, type "help"`.
- [ ] Connect from Minecraft using the address on the server page (or the server's IP).
- [ ] In the console, try `list`, `say hello`, and `op <your name>`. Up and down arrows bring back earlier commands.

## 3. Day-to-day

- [ ] **Stop**, then **Start**. The status badge follows along without refreshing.
- [ ] **Restart** while you're connected: you're disconnected, and can rejoin a minute later.
- [ ] Create a second server (try **Vanilla** this time). It gets the next port, 25566.
- [ ] Reboot the VPS from the Hetzner console. Both servers come back on their own, and the panel works again.

## 4. Signing in

- [ ] Sign out, then sign back in with your passkey.
- [ ] On another browser or device, choose **Use a recovery code** instead. You're asked to add a passkey for that device before anything else.
- [ ] The same recovery code doesn't work a second time.

## Not in 0.1.0 yet

Deleting servers, editing settings and `server.properties`, players and whitelists, mods and datapacks, YAML specs, backups, a file manager, importing an existing server, closing SSH, and per-server hostnames. These are planned for 0.2.0 to 0.4.0.

## Reporting feedback

Open an issue with the **[Feedback](https://github.com/MattA-Official/mc-panel/issues/new?template=feedback.yml)** template. One issue per problem or idea is easiest. Screenshots help, and for anything that broke, include the output of:

```sh
journalctl -u flytower-panel -u flytower-agent -n 200 --no-pager
```

(That one needs SSH. If you'd rather not, a screenshot of the error is plenty.)
