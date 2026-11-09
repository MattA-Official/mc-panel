# Testing 1.1.0

1.1 is about hearing when something needs attention, and fixing more of it without you. Each feature is tested on its own pull request build first; this page collects the checks.

## Installing a pull request's test build

Every pull request is built and signed like a release, under the tag `pr-<number>`. Install it on a **spare VPS** (or upgrade one you're testing on) with:

```sh
curl -fsSL https://github.com/MattA-Official/mc-panel/releases/download/pr-<number>/install.sh \
  | sudo bash -s -- --pr <number> --domain panel.example.com
```

It installs over what's there and keeps your data and sign-in, like any re-run of the installer. **System** then shows a version like `1.1.0-pr.70.3`. Test builds are never offered as updates, and **Go back to** on the System page returns to the release you had before. A test build is deleted when its pull request closes.

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
