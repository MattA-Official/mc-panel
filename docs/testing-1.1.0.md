# Testing 1.1.0

1.1 is about hearing when something needs attention, and fixing more of it without you. Each feature is tested on its own pull request build first; this page collects the checks.

## Installing a pull request's test build

Every pull request is built and signed like a release, under the tag `pr-<number>`. Install it on a **spare VPS** (or upgrade one you're testing on) with:

```sh
curl -fsSL https://github.com/MattA-Official/mc-panel/releases/download/pr-<number>/install.sh \
  | sudo bash -s -- --pr <number> --domain panel.example.com
```

It installs over what's there and keeps your data and sign-in, like any re-run of the installer. **System** then shows a version like `1.1.0-pr.70.3`. Test builds are never offered as updates, and **Go back to** on **System**, **Updates** returns to the release you had before. A test build is deleted when its pull request closes.

## 1. Notifications

You need a Discord server where you can make a webhook, and optionally the [ntfy](https://ntfy.sh) app on your phone. See [Notifications](notifications.md) for the setup steps.

- [ ] **System**, **Notifications**, **Add channel**: Discord, paste a webhook URL. **Send test** posts an embed in the channel that links back to the panel.
- [ ] A made-up Discord address (or a deleted webhook) gives a clear error on **Send test**.
- [ ] **Add** asks for your passkey (unless you confirmed one in the last five minutes). The channel is listed with a masked address, and **Activity** shows it was added.
- [ ] Tick **A server started** and **A server stopped**, then stop and start a server, including quickly one after the other. "Server stopping" arrives as soon as you press Stop, and "Server started" as soon as the console says `Done`, each named after the server. It works the same with the panel closed, or when the server is stopped from the console with `stop`.
- [ ] Tick **A server restarted from the panel** and press **Restart**. "Server restarting" arrives straight away and "Server restarted" once it's back, with no separate stop and start messages.
- [ ] Tick **A player joined** and **A player left**, then join and leave the server. The messages arrive straight away. A player name with underscores shows correctly, nobody gets pinged, and typing "Steve joined the game" in chat sends nothing.
- [ ] Break a backup on purpose, if you can (for example, a server whose folder you've made unreadable, or a nearly full disk), and check the "backup failed" message, then "Backups are working again" after a good one. A second failure within 30 minutes isn't sent again.
- [ ] Optional: an ntfy channel (`https://ntfy.sh/<a long random topic>`). **Send test** arrives on your phone, and tapping it opens the panel.
- [ ] Optional: a JSON webhook to something like [webhook.site](https://webhook.site), with a generated signing secret. The body matches [the docs](notifications.md#json-webhook) and has an `X-Flytower-Signature` header.
- [ ] **Edit** a channel: change its events or servers without retyping the address. The send button on the list still works.
- [ ] **Remove** asks for your passkey and the channel stops getting messages.
- [ ] Point a channel at a broken address (edit it with a deleted webhook URL), stop a server, and see the error shown under the channel on System. Fix it and **Send test** clears the error.

## 2. Crash detection

You need a test server you don't mind crashing. SSH in (System, **SSH access**) for the first few checks, or use the console tricks below. See [Crashes](crashes.md).

- [ ] Kill the server's Java process: `sudo pkill -KILL -u mc-<name>`. Within a couple of seconds the badge reads **Restarting after a crash**, and the Console tab shows a banner: "Crashed at …", "It was killed by SIGKILL. It will be restarted in a moment."
- [ ] About 15 seconds later it starts again by itself. The badge goes back to **Running**, the banner stays (now saying it was restarted), and a red dot marks it on the servers list.
- [ ] A "Server crashed" notification arrives (if a channel has it ticked), then "Server is back up".
- [ ] **Activity** lists "<name> crashed. It was killed by SIGKILL." by **Flytower**.
- [ ] **Logs**, **Crashes** lists the crash, then "Back to normal". **The log before it** shows the last lines of the old log.
- [ ] A real Minecraft crash report, if you can cause one: for example, upload a Fabric mod built for a different Minecraft version into `mods/` with the Files tab and start the server. The banner's cause becomes "Minecraft crashed: …" and **Open crash report** opens the file in the Files tab. (This also checks how 26.3 names its crash reports. Remove the mod afterwards.)
- [ ] Close the banner with its ✕. It stays closed after a reload, and the red dot goes.
- [ ] **Crash loop**: kill it three times in a row, each time once it's back up. After the third, it stays stopped, the badge reads **Crash-looping**, a "Server keeps crashing" notification arrives, and the banner says to start it again once fixed. **Start** works first time, and "Server is running again" follows.
- [ ] **Stop**, **Restart**, applying a change from the Content tab and a backup restore never count as crashes.
- [ ] Typing `stop` in the console stops the server normally, with no crash recorded and no automatic restart.
- [ ] **Not responding**: freeze the server with `sudo pkill -STOP -u mc-<name>` (this pauses Java without stopping it). After five minutes the badge reads **Not responding** and a notification arrives. `sudo pkill -CONT -u mc-<name>` brings it back, and within a minute it's **Running** again with a "responding again" notification.
- [ ] Turn on **Settings**, **Crashes**, **Restart it when it stops responding**, freeze it again, and check it's restarted once after five minutes, and that Activity says so. The YAML tab now shows `recovery: restartWhenUnresponsive: true`.
- [ ] After updating an existing install to this build, `systemctl cat flytower-mc@<name>` shows `StartLimitBurst=3` without the servers having been restarted by the update.

## Reporting feedback

Open an issue with the **[Feedback](https://github.com/MattA-Official/mc-panel/issues/new?template=feedback.yml)** template, or comment on the pull request you're testing.

## UI pass

Check these on a computer and on a phone.

- [ ] **Servers** on a phone: every card fits the screen, with its status and memory showing.
- [ ] A server with a hostname: the **Address** card on **Console** shows the hostname, the same as the header.
- [ ] Dates and times look the same on every page (Logs, Files, Backups, Activity, passkeys), in your own locale.
- [ ] **System**, **Updates**: release notes show as headings, lists and links, not Markdown.
- [ ] **Content** with mods in the spec that aren't installed: the notice names them and reads naturally.
- [ ] Every server tab is the same width, and card headings look the same everywhere.
- [ ] Disabled buttons (for example **Create server** before the EULA is ticked) look grey, not a duller amber.
- [ ] On a phone, the server header shows the full name (or "…"), the status sits next to the tab menu, and **Power** offers Start, Restart or Stop. The tab menu lists every tab.
- [ ] **Settings**: change something and a bar with **Discard** and **Save** stays at the bottom while you scroll.
- [ ] **System** has five sections: Overview, Updates, Off-site storage, Notifications, and Account and security. Links from notifications and from a server's **Backups** tab land on the right one.
- [ ] **World** now holds **Export world**, next to Copy and Reset.

## Backups with files Flytower can't read

On a server running spark (or any server, using the steps below):

- [ ] Start a spark profile in the console with `spark profiler start`, then **Back up now** while it runs. The backup finishes, and its job says nothing about skipped files: spark's `config/spark/tmp` folder is left out. Stop the profile with `spark profiler stop`.
- [ ] SSH in and make a file only the server can read: `sudo -u mc-<name> sh -c 'echo x > /srv/flytower/servers/<name>/private.txt && chmod 600 /srv/flytower/servers/<name>/private.txt'`. **Back up now** finishes, and its job ends with "Left out 1 file Flytower couldn't read: private.txt (Permission denied)." Delete the file afterwards.
- [ ] A file ending in `.tmp` anywhere in the server folder isn't in the backup (download it and look, or restore it on a test server).
