# Testing 0.3.0

Thanks for testing. This release is about what runs on a server: mods and datapacks from Modrinth and Vanilla Tweaks, describing a whole server in YAML, changing Minecraft versions, and pre-generating or resetting the world. Please keep using a **throwaway VPS**. You can upgrade the 0.2.0 install or start fresh.

Allow about an hour. Each section stands on its own.

Everything that changes a server now shows you a **plan** first: what will be added, updated or removed, how much will be downloaded, and whether it needs a restart. Nothing happens until you press **Apply**, and anything that touches mods or the world takes a backup first.

## 1. Mods and datapacks (Content tab)

- [ ] On a Fabric server, **Content** tab, **Add content**: search Modrinth for Lithium and add it. The plan shows Lithium; apply it. The server restarts and Lithium is listed as installed.
- [ ] Add something with dependencies, like Chunky or a mod that needs Fabric API. The plan lists the dependency with "Needed by …". Remove the mod later and its dependency goes too.
- [ ] Add a datapack from Modrinth (Terralith, say). It lands in the world's `datapacks` folder.
- [ ] **Vanilla Tweaks**: tick a couple of datapacks (and a crafting tweak if you like), review and apply. In game, `/datapack list` shows them.
- [ ] Drop a mod `.jar` into `mods/` through the **Files** tab. The Content tab lists it as added by hand and leaves it alone.
- [ ] On a vanilla server, mods aren't offered, but datapacks are.

## 2. Updates

- [ ] **Check for updates** on the Content tab. If anything is newer, update one item and check its version changed. Items never update unless you ask.

## 3. YAML

- [ ] **YAML** tab: the whole server is shown as YAML. Change the MOTD and memory there, **Review changes**, then apply.
- [ ] Make a mistake on purpose (say `memory: lots`). The line is marked and the message says what's wrong. You can't apply until it's fixed.
- [ ] **Download** the YAML, then **New server**, **From YAML**: paste it with a new `name:` and port. You get a copy with the same mods and settings.
- [ ] If you use VS Code with the YAML extension, open the downloaded file. You get autocomplete and checking from the schema line at the top.

## 4. Changing version or loader

- [ ] **Settings** tab, **Version** card: switch a vanilla server to Fabric. The plan shows the loader change and takes a backup first. After applying, the console shows Fabric starting.
- [ ] If a newer Minecraft version than your server's is out, upgrade to it. The plan shows the new version, any Java change, and mods moving to builds for the new version. Anything without a build is named, and the plan won't apply until you remove it.
- [ ] Try going back to an older version (edit `minecraft:` in the YAML tab). It's refused, pointing you at your backups instead.

## 5. World

- [ ] **World** tab on a Fabric server: **Add Chunky** (it brings Fabric API). Start the server.
- [ ] **Pre-generate** a radius of 1000 around spawn. Progress, ETA and speed update every few seconds. Players can stay on.
- [ ] **Pause**, then **Continue paused**, then **Cancel**.
- [ ] Restart the server during a pre-generation, then **Continue paused**. It carries on from where it was.
- [ ] **Reset world** with a new random seed. You're asked for your passkey, a backup is taken, and the server starts on a fresh world. Your Vanilla Tweaks datapacks are still installed.
- [ ] Restore the "Before resetting the world" backup from the Backups tab. The old world is back.

## Not in 0.3.0 yet

Per-server hostnames and DNS, cloning servers, self-update, Paper and plugins, and off-site backups. These are planned for 0.4.0 to 0.6.0.

## Reporting feedback

Open an issue with the **[Feedback](https://github.com/MattA-Official/mc-panel/issues/new?template=feedback.yml)** template. One issue per problem or idea is easiest. Screenshots help, especially of a plan that looked wrong. For anything that broke, include the output of:

```sh
journalctl -u flytower-panel -u flytower-agent -n 200 --no-pager
```

(That one needs SSH, which you can open for a while from the **System** page. If you'd rather not, a screenshot of the error is plenty.)
