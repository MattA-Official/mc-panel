# Testing 1.3.0

1.3 is about the community around a server. Each feature is tested on its own pull request build first; this page collects the checks.

## Installing a pull request's test build

Every pull request is built and signed like a release, under the tag `pr-<number>`. Install it on a **spare VPS** (or upgrade one you're testing on) with:

```sh
curl -fsSL https://github.com/MattA-Official/mc-panel/releases/download/pr-<number>/install.sh \
  | sudo bash -s -- --pr <number> --domain panel.example.com
```

It installs over what's there and keeps your data and sign-in. Test builds are never offered as updates, and **Go back to** on **System**, **Updates** returns to the release you had before.

## Discord app

You need a panel with a domain, a Discord server you can add apps to (a test one is best), and a Fabric or Paper server with its public page on. See [Discord app](discord.md).

- [ ] In the [Developer Portal](https://discord.com/developers/applications), make a New Application, then on **Bot** press **Reset Token** and copy it.
- [ ] **System**, **Integrations**: paste a made-up token. It's refused without asking for your passkey. Paste a real token with one character changed: Discord refuses it, and nothing is saved.
- [ ] Paste the real token and press **Connect**. After the passkey check the card says **Connected** with the app's name, ID, the endpoint and `/players` and `/status`. The portal's **General Information** shows the same endpoint in **Interactions Endpoint URL**.
- [ ] **Activity** shows "Connected the Discord app …".
- [ ] **Add to a Discord server**: pick your test server. Only "Create commands" is asked for.
- [ ] In Discord, type `/status`. The `server` option suggests only servers with their public page on. With a server picked you get an embed with its state, address, players and version, and its icon if it has one. Without one, every shared server.
- [ ] `/players` while someone is on lists them. Set the public page to **Count only**: `/players` gives the count. **Nothing**: "doesn't share who's on".
- [ ] Turn a server's public page off: it's no longer suggested, and typing its name gives "There's no server called …", seen only by you.
- [ ] Stop the server: `/status` says Offline straight away. Start it: Starting, then Online once players can join.
- [ ] `curl -X POST https://<panel>/api/discord/interactions -d '{}'` gets a 401.
- [ ] In the portal, change the endpoint URL to something else and save, then press **Test connection** in Flytower: the card says **Endpoint not set**. **Try the endpoint again** puts it back.
- [ ] **Disconnect**: after the passkey check the card is back to empty, the commands disappear from Discord (it may take a minute, or reopen Discord), and the portal's endpoint is empty.

## Web map

You need a Fabric or Paper server with an explored world, and for the last checks its public page on (and a hostname, if you have one). See [Web map](map.md).

- [ ] **World**, **Web map** on a vanilla server says it needs Fabric or Paper.
- [ ] On Fabric, **Add squaremap**: the plan adds squaremap (and Fabric API if it's missing) and restarts the server.
- [ ] `squaremap/config.yml` has `internal-webserver: enabled: false`, and `ss -ltn` shows nothing new listening (squaremap's default is 8080).
- [ ] **Open map** opens `/s/<name>/map/` in a new tab. Join the game: you appear on the map within a few seconds and move as you walk.
- [ ] **Draw**, Overworld: the console shows squaremap's progress and the explored world fills in. **Stop** stops it.
- [ ] Turn off **Show players**: the console shows squaremap reloading and you disappear from the map.
- [ ] In a private window, `/s/<name>/map/` goes to sign-in, and `/s/<name>/map/tiles/players.json` is "Not found".
- [ ] Turn on **Anyone can open it** (with the public page on): the card shows the address with a copy button, the map opens in a private window without a cookie, the status page has **Open the map**, and `/status` in Discord has a **Map** link. `https://<hostname>/map` opens it too.
- [ ] Turn the public page off: the map is private again, and the status page and Discord lose the link.
- [ ] Take a backup: it has no `squaremap/web/tiles`. **Settings**, **Disk use** has a **Web map** line.
- [ ] Reset the world: the old map is gone, and the new world appears as it's explored.
- [ ] On Paper, the same with the files under `plugins/squaremap`.
