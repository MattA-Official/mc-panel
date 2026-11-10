# Testing 1.2.0

1.2 is about people and sharing. Each feature is tested on its own pull request build first; this page collects the checks.

## Installing a pull request's test build

Every pull request is built and signed like a release, under the tag `pr-<number>`. Install it on a **spare VPS** (or upgrade one you're testing on) with:

```sh
curl -fsSL https://github.com/MattA-Official/mc-panel/releases/download/pr-<number>/install.sh \
  | sudo bash -s -- --pr <number> --domain panel.example.com
```

It installs over what's there and keeps your data and sign-in, like any re-run of the installer. **System** then shows a version like `1.2.0-pr.111.1`. Test builds are never offered as updates, and **Go back to** on **System**, **Updates** returns to the release you had before. A test build is deleted when its pull request closes.

## Player heads

On any server where you can join with a real (online-mode) account, and ideally a second account or a friend.

- [ ] **Players**: everyone on **Online now**, **Whitelist**, **Operators** and **Banned** has their face (with the hat layer) next to their name, sharp at 24px, not blurry.
- [ ] Reload the tab. The heads appear straight away, and the panel's journal (`journalctl -u flytower`) shows no new requests failing. On the box, `/var/lib/flytower/skins/profiles/` has one file per player and `textures/` one PNG per skin.
- [ ] Change your skin at minecraft.net. The panel keeps the old one for up to a day, then shows the new one. (To see it sooner, delete your file in `profiles/`.)
- [ ] Whitelist a name that has never played and has no Mojang account, or set `online-mode=false` and join: they get the default Steve or Alex head, with no errors.
- [ ] Block Mojang for a moment (for example `sudo iptables -A OUTPUT -d sessionserver.mojang.com -j REJECT`, removed afterwards with `-D`) and delete a `profiles/` file: that player shows a default head and nothing breaks. Players already cached still show their own skin.
- [ ] An old-style skin (Notch's, for example: whitelist `Notch`) shows his face, not a black square.
- [ ] The browser's console shows no content security policy errors on the Players tab.

## Client-only mods

On a Fabric test server. See [Client-only mods](content.md#client-only-mods).

- [ ] **Content**, **Add content**, **Mods**: search `voxy`. Nothing client-only shows (Voxy itself is missing) until you turn on **Show client-only**; then Voxy appears with a **Client-only** badge.
- [ ] The switch isn't there on **Datapacks**, or on **Plugins** with **Hangar** picked.
- [ ] **Add** Voxy. The plan shows an amber warning, "Modrinth marks Voxy as client-only. It's installed because you asked for it; remove it if the server won't start.", and **Apply** isn't greyed out. Apply it: Voxy is listed on the Content tab like any other mod.
- [ ] `flytower.lock.json` (in **Files**) lists Voxy.
- [ ] In the **YAML** tab, the item is a plain `- modrinth: voxy`; **Review changes** with no edits shows the same warning and nothing to change.
- [ ] Remove Voxy from the Content tab. The plan removes it with no warning.
- [ ] Update checks: pin an older Voxy in the YAML (`version:` with an older version number from Modrinth), apply, then reload the Content tab: Voxy shows the newer version as available.
- [ ] The server still starts with Voxy installed. (If a client-only mod does stop a server starting, that's the mod, not Flytower: the warning tells people to remove it.)
