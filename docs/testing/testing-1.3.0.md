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

You need a panel with a domain, a Discord server you can add apps to (a test one is best), and a Fabric or Paper server with its public page on. See [Discord app](../discord.md).

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

You need a server that has been started at least once, with some world explored. Any loader works; try a vanilla one too. See [Web map](../map.md).

- [ ] **World** tab, **Web map**: **Draw a web map** is off. Switch it on. The card says "Drawing the map now…" straight away, then "Last drawn …" with how many regions were drawn and how long it took, without reloading the page.
- [ ] **Activity** shows "Turned on <server>'s web map".
- [ ] **Open map**: the map opens in a new tab and looks like the world (water, beaches, forests, snow). It isn't "Drawn with simpler colours".
- [ ] Drag, scroll, pinch on a phone, double-click and **+**/**−** all move and zoom. Zoomed right out, the whole explored world shows; zoomed right in, blocks are crisp squares.
- [ ] The coordinates at the bottom left match the game's F3 screen for the same spot.
- [ ] Copy the address while looking somewhere, open it in another tab: it opens at the same spot and zoom.
- [ ] Pick **Nether**: the Nether shows below its roof, not the bedrock ceiling.
- [ ] Join the server: within a few seconds you appear on the map with your head and name, and in the list at the bottom right. Clicking your name jumps to you, switching dimension if you're in the Nether. Walk around: the marker follows.
- [ ] Build or dig something visible, then run `save-all` in the console. About half a minute later the card shows a new drawing with one or two regions drawn. Within a minute the open map shows the change without reloading.
- [ ] **Draw now** draws straight away; **Redraw everything** draws every region again.
- [ ] **Show players** off: the markers and list disappear within a few seconds.
- [ ] Sign out and open the map's address: you're sent to sign in. Signed in as someone who can't see the server: "Not found".
- [ ] Turn the public page on and **Anyone can open it** on: the card shows the address with a copy button. In a private window the map opens without signing in, and the browser's storage shows no cookie for it. The public page has **Open the map**, and `/status` in Discord has a **Map** link.
- [ ] With a hostname set, `https://<hostname>/map` opens the map.
- [ ] Turn the public page off: the map needs signing in again, and the page and Discord no longer link it.
- [ ] **Disk use** shows a **Web map** line.
- [ ] Reset the world (**World**, **Reset**). Start the server and let it save: the map shows the new world, and none of the old one.
- [ ] Turn the map off: the card says it's off, the map's address gives "Not found", and the **Web map** disk line is empty after the next measurement.
- [ ] Note how long the first drawing took and the size on the **Web map** disk line, and add them to the pull request.
