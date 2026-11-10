# Testing 1.4.0

1.4 is about power tools: quicker ways to get around and get things done. Each feature is tested on its own pull request build first; this page collects the checks.

## Installing a pull request's test build

Every pull request is built and signed like a release, under the tag `pr-<number>`. Install it on a **spare VPS** (or upgrade one you're testing on) with:

```sh
curl -fsSL https://github.com/MattA-Official/mc-panel/releases/download/pr-<number>/install.sh \
  | sudo bash -s -- --pr <number> --domain panel.example.com
```

It installs over what's there and keeps your data and sign-in. Test builds are never offered as updates, and **Go back to** on **System**, **Updates** returns to the release you had before.

## System-wide disk use

You need a test VPS on this build with at least one server. Test with the Bun agent first, then again with the Rust one (`echo rust > /etc/flytower/agent`, then `systemctl restart flytower-agent`). See [Disk space](../disk.md).

- [ ] **System**, **Overview**, **Disk**: after a minute (or **Measure now**), the grey part of the bar is split into **Java runtimes**, **Flytower**, **System logs**, **Package cache and temp files** and **Operating system and everything else**, each in its own shade of grey. Servers keep their colours.
- [ ] Each part has a row under the servers, with its size. Hovering over the bar and the legend show the same sizes.
- [ ] Compare with the machine over SSH: `sudo du -sxh /opt/flytower/runtimes /var/log /var/cache/apt` should be close to Java runtimes, System logs and most of Package cache (give or take what was written since).
- [ ] The parts and the servers add up to the used space at the top; nothing is negative, and **Operating system and everything else** is a sensible size (usually 1 to 3 GB).
- [ ] If `/tmp` is a tmpfs (`findmnt /tmp`), it doesn't count towards anything.
- [ ] **Clean up** shows on System logs, Package cache and Flytower, and each row says how much can be freed. Signed in as someone who can't manage Flytower, there's no button.
- [ ] **System logs**, **Clean up**: pick 100 MB. The dialog says how much it should free. Press **Shrink the journal**: you're asked for your passkey, then a toast says how much was freed. `journalctl --disk-usage` agrees. The System logs row is smaller after a few seconds.
- [ ] **Package cache**, **Clean up**: run `sudo apt-get update && sudo apt-get install --download-only cowsay` first so there's something to clear. The dialog shows it, and afterwards `/var/cache/apt/archives` has no `.deb` files.
- [ ] **Flytower**, **Clean up** after a couple of updates (or install two PR builds): it lists what it would free. Afterwards `ls /opt/flytower/releases` shows only the running version and the one **Go back to** offers, and **Go back to** still works.
- [ ] While an update is running, removing old versions is refused with "an update is already running".
- [ ] **Activity** shows each clean-up, such as "Shrank the system journal to 100 MB, freeing 412.3 MB", under **Flytower, notifications, branding and Discord**.
- [ ] Stop the agent (`sudo systemctl stop flytower-agent`) and press **Measure now**: servers are still measured, and the rest goes back to one **System and other files** part. Start it again and measure: the parts come back.
- [ ] A disk warning sent before this update isn't sent again after it.
