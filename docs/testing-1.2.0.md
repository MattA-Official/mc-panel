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
