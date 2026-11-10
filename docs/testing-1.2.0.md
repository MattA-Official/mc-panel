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

## MOTD editor

On any server, in **Settings**, **Game settings**. Have Minecraft open on the multiplayer screen with the server added, to compare.

- [ ] **Message of the day** shows two lines and a preview of the server's entry in the multiplayer list. An MOTD written before (plain, or with `§` codes typed by hand) opens already formatted, and opening the tab alone doesn't mark anything unsaved.
- [ ] Select a word and pick a colour from the colour menu, then bold, italic, underline, strikethrough and obfuscated. The word changes in the line and the preview straight away; obfuscated text keeps changing in the preview. Pressing a format again on the same word turns it off, and **Clear formatting** takes everything off the selection.
- [ ] With nothing selected, press **Bold** (or pick a colour) and type: the new text is bold, and moving the cursor away forgets it.
- [ ] Paste `§dpink` into a line: it arrives as pink text, not as the codes.
- [ ] Turn on **Show codes**. Both lines show the raw `§` text, the toolbar buttons insert codes at the cursor, and turning it off reads your edits back in, formatted.
- [ ] Type a first line that's too long. The preview wraps it as the game does, and a warning says how many pixels too wide it is and what gets cut off.
- [ ] Save and restart the server. The multiplayer list shows the same two lines, colours and formatting as the preview (the font and the default icon differ, since Mojang's aren't shipped).
- [ ] `server.properties` (Files tab) has the MOTD on one line, with `\n` between the two lines and `§` for each `§`. Reload Settings: the editor reads it back unchanged.
- [ ] The **YAML** tab shows the same `motd:` string, and a server made **From YAML** with a two-line `motd` gets both lines.
- [ ] On a phone, the toolbar wraps, the preview shrinks to fit, and selecting text then tapping a button still applies to the selection.
- [ ] The browser's console shows no content security policy errors.
