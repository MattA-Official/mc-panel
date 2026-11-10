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

On a Fabric test server. See [Client-only mods](../content.md#client-only-mods).

- [ ] **Content**, **Add content**, **Mods**: search `voxy`. Nothing client-only shows (Voxy itself is missing) until you turn on **Show client-only**; then Voxy appears with a **Client-only** badge.
- [ ] The switch isn't there on **Datapacks**, or on **Plugins** with **Hangar** picked.
- [ ] **Add** Voxy. The plan shows an amber warning, "Modrinth marks Voxy as client-only. It's installed because you asked for it; remove it if the server won't start.", and **Apply** isn't greyed out. Apply it: Voxy is listed on the Content tab like any other mod.
- [ ] `flytower.lock.json` (in **Files**) lists Voxy.
- [ ] In the **YAML** tab, the item is a plain `- modrinth: voxy`; **Review changes** with no edits shows the same warning and nothing to change.
- [ ] Remove Voxy from the Content tab. The plan removes it with no warning.
- [ ] Update checks: pin an older Voxy in the YAML (`version:` with an older version number from Modrinth), apply, then reload the Content tab: Voxy shows the newer version as available.
- [ ] The server still starts with Voxy installed. (If a client-only mod does stop a server starting, that's the mod, not Flytower: the warning tells people to remove it.)

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

On **System**, **Branding**. See [Branding](../branding.md). Have an SVG and a PNG logo to hand; your society's will do.

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
- [ ] Register a new passkey (**Your account**, your name at the bottom of the sidebar): the browser's prompt names your panel. Old passkeys still sign in.
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

## Server icon

On any server, in **Settings**, **Game settings**, with Minecraft open on the multiplayer screen.

- [ ] **Upload** a JPEG photo that isn't square. The crop dialog starts on the largest centred square; dragging moves it, the slider zooms in, and the 64×64 result and the list preview follow straight away.
- [ ] **Save icon**. The icon shows next to **Server icon**, and **Activity** says the icon was changed. Restart the server: the multiplayer list shows the same icon.
- [ ] The **Files** tab shows `server-icon.png`. Download it: it's 64×64, and a tool such as `exiftool` or `pngcheck -t` shows no text or metadata, even if the picture you uploaded had some.
- [ ] Try a PNG with transparency, and a WebP. Both work, and transparency is kept.
- [ ] Picking a GIF, an SVG or a file over 10 MB gives a clear message and opens nothing.
- [ ] **Change** replaces the icon, and the page shows the new one at once (no stale cached picture).
- [ ] **Remove** takes it away; after a restart the list shows the default icon again.
- [ ] Clone a server that has an icon: the clone has it too.
- [ ] On a phone, the crop dialog fits the screen and dragging the picture works with a finger.

## Public status page

On a running server, ideally one you can join with a real account and a friend's.

- [ ] **Settings**, **Public page**: switch it on, write a two-line description, leave **How many are online**, and **Save**. The card shows the page's address.
- [ ] Open the address in a private window (signed out). It shows the server's name, icon (if it has one), MOTD in the game's colours, your description on two lines, **Online**, the address with a working **Copy** button, and the version.
- [ ] Join the server: within 30 seconds the page says "1 of 20 players online" with no names. Leave: it says nobody's on.
- [ ] Switch to **Names and heads** and save. Your head and name appear; a second player joining appears too, and disappears when they leave.
- [ ] **Nothing** hides the players section. Unticking the version hides it.
- [ ] Restart the server: the page shows **Starting**, then **Online** with nobody on. Stop it: **Offline**.
- [ ] Restart the panel (`sudo systemctl restart flytower-panel`) while someone is on: the page still lists them.
- [ ] Switch the page off. The address now says "Nothing here", the same as `/s/does-not-exist`.
- [ ] Paste the address into a Discord message: the preview shows the server's name and description (and your logo, if you uploaded one).
- [ ] Turn on branding colours and a logo: the page uses them, in light and dark mode. On a phone it fits without scrolling sideways.
- [ ] **YAML**: the spec shows a `public:` block; change `players: names` to `count` and apply. The plan lists **Public page** and the page follows.
- [ ] The browser's console shows no content security policy errors on the page.

### Modpack for players

On a Fabric server with a few Modrinth mods (Fabric API, Lithium, and ideally one Modrinth marks as server-only), with the public page on.

- [ ] **Settings**, **Public page**: **What players get** lists the server's mods that run on players' computers. **Left out** names any server-only mod or non-Modrinth file, with why.
- [ ] Add `iris` and `complementary-reimagined` as extras and save. The list gains Iris, the shader pack and Sodium "(needed by Iris)".
- [ ] Open the page signed out: **Download the modpack** gives `<server name>.mrpack`. Open it in the Modrinth app (or Prism: Add Instance, Import). It creates an instance at the server's Minecraft and Fabric versions with those mods, and the shader pack under Shader packs.
- [ ] Launch the instance and join the server: no missing-mod errors.
- [ ] Add a mod to the server from the Content tab and apply. Reload the card: the new mod is listed, and a fresh download includes it.
- [ ] Switch off **Offer a modpack for players**: the page's modpack section disappears and `/api/public/servers/<name>/pack.mrpack` is a 404.
- [ ] A Paper server's card doesn't offer a modpack.

### On the server's own address

On a server with a hostname whose A record points at the VPS, on a box where the installer has been re-run with this build.

- [ ] `/etc/caddy/Caddyfile` has the `on_demand_tls` block and an `https://` site, and `systemctl status caddy` is happy.
- [ ] With the public page on, open `https://<hostname>`: it goes to `/s/<name>` with a valid certificate (the first load may take a few seconds while Caddy gets it). The page works, including the modpack download.
- [ ] `https://<hostname>/login` and `https://<hostname>/servers/<name>` say "Not found". The panel's own domain still works as before.
- [ ] Turn the public page off: `https://<hostname>` is "Not found". `curl -s -o /dev/null -w '%{http_code}' 'http://127.0.0.1:3000/api/public/tls-ask?domain=<hostname>'` on the box gives 404, and 200 once it's back on.
- [ ] `https://made-up-name.<your domain>` (if you have a wildcard record) never gets a certificate: the browser shows a TLS error, and Caddy's log (`journalctl -u caddy`) says the ask was refused.

## People and roles

1. **Setup link**: on a fresh install, open the setup link the installer prints. You go straight to creating your passkey, and the address bar no longer shows the token. Also try typing the token on `/setup` instead.
2. Go to **Access** in the sidebar. It has **People** and **Roles** tabs, and you're listed under People as Owner on all servers.
3. Choose **Invite someone**, pick **Operator** on one server, and make the link (your passkey is asked for). Open it in a private window or on another device. You see who invited you and as what. Pick a name, create a passkey, save the codes.
4. As the new person: that server shows, others don't. Start and stop and the console work. Files is hidden, Settings says **View only**, System shows only Overview, and Access isn't in the sidebar.
5. As the Owner, change them to **Viewer**. Without reloading, their next click can't reach the console.
6. Remove them. Their next click signs them out.
7. Try making yourself an Admin while you're the only Owner. It's refused.
8. Make an invite and cancel it. The link then says it can't be used. An old link (over 7 days) or a used one says the same.
9. **Activity**, **Sign-ins and access** lists each invite, join, change and removal.
10. Existing install updated from an earlier beta: you're the Owner, and everything works as before.

### Custom roles and what people see

1. On **Access**, open the **Roles** tab and choose **New role**. Call it Moderator and tick **Read the console and logs** and **Manage players**. See the server is ticked and can't be unticked.
2. Invite someone as **Viewer** on one server and join as them. Check that:
   - **New server** doesn't show.
   - Opening the server lands on **Players**, with no Console, Logs or Files tabs and no Start or Stop.
   - **Settings** says **View only**, and nothing can be changed.
   - **System** shows only Overview, and **Access** isn't in the sidebar.
3. As the Owner, change them to **Moderator** on that server. Switch back to their tab: Console and Logs appear, with no box for typing commands.
4. Try deleting Moderator while they have it. It's refused. Give them another role, then delete it.

### Your account

1. Click your name at the bottom of the sidebar. **Your account** shows Profile, your passkeys and recovery codes, and Signed-in devices. **System** no longer has Account and security, and SSH is its own section there. Old links to `/system/account`, `/system/people` and `/people` still land in the right place.
2. Change your name. The sidebar, Access and Activity show the new name.
3. Under **Appearance**, pick **Light**, then sign in on another browser: it's light there too. The sun and moon button in the sidebar saves your choice as well.
4. Sign in on a second browser, then choose **Sign out everywhere else** on the first. The second is signed out on its next click; the first stays signed in.
