# Testing 0.2.0

Thanks for testing. This release covers looking after a server day to day: settings, players, files, logs, backups, moving worlds in and out, and closing SSH. Please keep using a **throwaway VPS**. You can upgrade the 0.1.0 install or start fresh.

Allow about an hour. Each section stands on its own, so it's fine to spread it over a few sittings.

## 1. Settings

- [ ] **Settings** tab: change the MOTD and max players, then save. You're told a restart is needed; restart and check the new MOTD in your server list.
- [ ] Change the memory, then restart. The server comes back up.
- [ ] Try a port another server already uses. It's refused with a clear message.

## 2. Players

- [ ] **Players** tab while you're connected: you're listed as online. Try **Kick** (you can rejoin).
- [ ] Turn the whitelist on, add yourself, and check a friend (or a second account) can't join until added.
- [ ] **Make operator**, then **Remove operator**. Try **Ban** and **Unban** on a friend or a made-up name.

## 3. Files and logs

- [ ] **Files** tab: open `server.properties`, edit something harmless, save, and check the change stuck.
- [ ] Upload a small file, make a new folder, rename something, and delete it again.
- [ ] **Logs** tab: today's log and older ones are listed. Open an old one and download it.

## 4. Backups

- [ ] **Backups** tab: **Back up now** with the server running. Players stay connected, and the backup appears with its size.
- [ ] Build something recognisable in game, then restore the backup from before it. You're asked for your passkey, the server restarts, and the build is gone.
- [ ] A "safety" backup from just before the restore is listed, in case you want the build back.
- [ ] Set a schedule (every hour is quickest to check) and come back later: scheduled backups appear, and older ones are thinned out as the retention settings say.
- [ ] Download a backup. It's a `.tar.zst` file.

## 5. Sharing a world

- [ ] Under **World exports** on the Backups tab, **Export now**. Download the zip and open it in single player on your own machine.
- [ ] **Share** it with a link that works for an hour. The link downloads in a private window without signing in.
- [ ] Revoke the link: it stops working at once.

## 6. Importing a server

- [ ] **New server**, then **Import server**. Upload the world zip from step 5 (or a world from your own computer). It's recognised as a world with its Minecraft version.
- [ ] Give it a name and create it. It starts on the next free port, and your build is there.
- [ ] If you have a whole vanilla or Fabric server folder zipped up, try that too. Its `server.properties`, whitelist and ops come across.
- [ ] Delete a server, then import it back from **Archive to import**.
- [ ] A Paper or Forge server is refused politely (Flytower runs vanilla and Fabric for now).

## 7. SSH

- [ ] **System** page: **Close SSH**. Check `ssh` to the VPS now times out.
- [ ] **Open SSH** for 15 minutes. You can connect, and after 15 minutes it closes again by itself, even if the VPS reboots in between.

## Not in 0.2.0 yet

YAML server specs, mods and datapacks from Modrinth and Vanilla Tweaks, Paper servers, per-server hostnames, self-update, off-site backups and plugins. These are planned for 0.3.0 to 0.6.0.

## Reporting feedback

Open an issue with the **[Feedback](https://github.com/MattA-Official/mc-panel/issues/new?template=feedback.yml)** template. One issue per problem or idea is easiest. Screenshots help, and for anything that broke, include the output of:

```sh
journalctl -u flytower-panel -u flytower-agent -n 200 --no-pager
```

(That one needs SSH, which section 7 lets you open for a while. If you'd rather not, a screenshot of the error is plenty.)
