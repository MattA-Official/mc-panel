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

## Game chat to Discord

You need a Discord channel you can add webhooks to and a running Fabric or Paper server. Player faces need the panel to have a domain. See [Game chat in a channel](discord.md#game-chat-in-a-channel).

- [ ] In Discord, the channel's settings, **Integrations**, **Webhooks**, **New Webhook**, **Copy Webhook URL**.
- [ ] Server, **Settings**, **Discord chat**: paste `https://example.com/hook` and press **Turn on**. It's refused as not a Discord webhook.
- [ ] Paste the real URL and press **Send a test**: "Flytower will post … chat here." arrives in the channel.
- [ ] Press **Turn on**. After the passkey check the card says **On** and shows only the webhook's ID. **Activity** shows "Started posting … chat to Discord".
- [ ] Join the server: "**you** joined the game" appears in the channel within a second, with your face.
- [ ] Say something: it appears under your name with your face. Say `**bold** @everyone <@1> # big https://example.com`: it shows exactly as typed, nobody is pinged, and the link works without a preview.
- [ ] `/me waves` appears in italics.
- [ ] Send ten lines quickly (or paste them): they all arrive, joined into fewer messages, in order.
- [ ] Turn **Chat** off and save: chat stops, joins and leaves still post. Turn **Joins and leaves** off: they stop too.
- [ ] Delete the webhook in Discord, then say something: the card says **Stopped** with Discord's reason. Paste a new webhook and save: chat posts again.
- [ ] **Turn off**: nothing more is posted, and the card is back to empty.
