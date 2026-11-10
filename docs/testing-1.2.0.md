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

## Past worlds

On a server with a world you don't mind resetting, ideally with a datapack or two installed.

- [ ] **World**, **Reset the world**. The dialog ticks **Keep the old world as a past world** and suggests a name like "Survival world, November 2026". Change it to "2025–26 world", tick **Keep the final backup forever**, and reset.
- [ ] The job shows a **Keeping the old world** step, and ends with "The old one is kept as "2025–26 world" in Past worlds". The new world generates, and the datapacks are still installed.
- [ ] **Past worlds** on the World tab lists it with its size. **Download** gives `2025–26 world.zip`; unzip it into your `saves` folder and open it in single player. It's the old world, datapacks working.
- [ ] **Share** it for 1 hour. The link downloads the same zip in a private window. **Turn off** stops the link.
- [ ] **Rename** it. The new name shows straight away and is used for the next download.
- [ ] **Backups**: the safety backup "Before resetting the world (2025–26 world)" has a **Kept** badge. Take a few manual backups and change something that takes safety backups (apply a YAML change touching mods) four times: the kept one stays. **Stop keeping forever** on it, then trigger another safety backup: it's pruned.
- [ ] **Start a server from it** (in the past world's **⋯** menu) opens Import with the world unpacked. Pick Fabric and the same Minecraft version, create it, and join: it's the old world.
- [ ] **Import**, **A past world** lists the same world with the server it came from.
- [ ] Reset again with **Keep the old world** unticked: nothing is added to Past worlds, and the job says the old one is in Backups.
- [ ] Fill the disk until the world won't fit twice (or test on a small VPS), then reset with a past world: the reset fails saying there isn't room, the server comes back up, and the old world is untouched.
- [ ] Delete a server that has a past world. **Import**, **A past world** still lists it.

## Branding

On **System**, **Branding**. See [Branding](branding.md). Have an SVG and a PNG logo to hand; your society's will do.

- [ ] Before changing anything, the panel looks exactly as it did: amber, Big Shoulders, the batten logo, no "Powered by" line.
- [ ] Change the name and pick a colour (try your real brand colour, then something awkward like a pale yellow or a dark navy). The shade strip and the light and dark previews update as you type, each showing a contrast ratio of 4.5:1 or more.
- [ ] **Save** asks for your passkey (unless you confirmed one in the last five minutes). The whole panel changes straight away, with no reload: buttons, links, the selected menu item, the tab title and the name in the menu. **Activity** shows the change.
- [ ] Switch between light and dark mode (the button by your name). Buttons and links are easy to read in both.
- [ ] Reload the page: it opens in your colours, with no flash of amber first.
- [ ] Pick each font. Titles and server names change, and Fraunces and Space Grotesk aren't forced into capitals. Body text stays the same.
- [ ] Upload an SVG logo. It shows in the menu and on the form. Upload a PNG favicon; the browser tab's icon changes. **Remove** each and the Flytower ones come back (the logo is the favicon while there's no favicon).
- [ ] Try to upload a JPEG, a PNG over 1024 pixels wide, and an SVG saved with a `<!DOCTYPE …>` line. Each is refused with a reason.
- [ ] Optional, for the security-minded: upload an SVG containing `<script>alert(1)</script>` and an `onload="alert(1)"`. It's accepted, nothing pops up, and opening the logo's address on its own shows the image with the script gone.
- [ ] Sign out. The sign-in page shows your name and logo, and "Powered by Flytower" underneath. Turn the switch off on the form and it goes from there and from under the menu.
- [ ] With another tab open on the panel, save a change in the first. The other tab changes by itself.
- [ ] Discord: **Send test** on a Discord channel. The message comes from your name (and your logo, if it's a PNG), and the footer has your name.
- [ ] In-game: add an **Announcement** on a server's **Schedules** tab and **Run now**. It appears in your accent colour, not gold. A restart's countdown does too.
- [ ] Register a new passkey (**System**, **Account and security**): the browser's prompt names your panel. Old passkeys still sign in.
- [ ] **Reset to Flytower** asks first, then puts everything back.
- [ ] The browser's console shows no content security policy errors on any page.

## MOTD editor

On any server, in **Settings**, **Game settings**. Have Minecraft open on the multiplayer screen with the server added, to compare.

- [ ] **Message of the day** is one box with two rows (Enter starts the second line; a third is refused), with a preview of the server's entry in the multiplayer list. An MOTD written before (plain, or with `§` codes typed by hand) opens already formatted, and opening the tab alone doesn't mark anything unsaved.
- [ ] Select a word and pick a colour from the colour menu, then bold, italic, underline, strikethrough and obfuscated. The word changes in the line and the preview straight away; obfuscated text keeps changing in the preview. Pressing a format again on the same word turns it off, and **Clear formatting** takes everything off the selection.
- [ ] With nothing selected, press **Bold** (or pick a colour) and type: the new text is bold, and moving the cursor away forgets it.
- [ ] Paste `§dpink` into the box: it arrives as pink text, not as the codes.
- [ ] Turn on **Show codes**. The box shows the raw `§` text, the toolbar buttons insert codes at the cursor, and turning it off reads your edits back in, formatted.
- [ ] Type a first line that's too long. The preview wraps it as the game does, and a warning says how many pixels too wide it is and what gets cut off.
- [ ] Save and restart the server. The multiplayer list shows the same two lines, colours and formatting as the preview (the font and the default icon differ, since Mojang's aren't shipped).
- [ ] `server.properties` (Files tab) has the MOTD on one line, with `\n` between the two lines and `§` for each `§`. Reload Settings: the editor reads it back unchanged.
- [ ] The **YAML** tab shows the same `motd:` string, and a server made **From YAML** with a two-line `motd` gets both lines.
- [ ] On a phone, the toolbar wraps, the preview shrinks to fit, and selecting text then tapping a button still applies to the selection.
- [ ] The browser's console shows no content security policy errors.
