# Testing 1.4.0

1.4 is about power tools: quicker ways to get around and get things done. Each feature is tested on its own pull request build first; this page collects the checks.

## Installing a pull request's test build

Every pull request is built and signed like a release, under the tag `pr-<number>`. Install it on a **spare VPS** (or upgrade one you're testing on) with:

```sh
curl -fsSL https://github.com/MattA-Official/mc-panel/releases/download/pr-<number>/install.sh \
  | sudo bash -s -- --pr <number> --domain panel.example.com
```

It installs over what's there and keeps your data and sign-in. Test builds are never offered as updates, and **Go back to** on **System**, **Updates** returns to the release you had before.

## Right-click menus: servers overview

You need two servers, one running and one stopped.

- [ ] Right-click the running server's card: a menu with **Open console**, **Open in new tab**, **Copy link**, **Restart**, **Stop**, **Copy address**, **Back up now**, **Go to**, **Clone…** and **Delete…** (in red). The last line says Shift + right-click gives the browser menu.
- [ ] The stopped server's card shows **Start** instead of Restart and Stop.
- [ ] **Restart** and **Stop** ask first, with the server's name. **Start** starts it straight away.
- [ ] **Back up now** opens the server's Backups with the "Back up now" box. **Clone…** and **Delete…** open Settings with their usual forms, and nothing is deleted until you type the name.
- [ ] **Go to** lists the server's tabs and each one opens.
- [ ] When a server has content updates waiting, **Review updates** appears and opens Content.
- [ ] Every card has a **⋯** button with the same items.
- [ ] **Shift + right-click** shows the browser's own menu. So does right-clicking after selecting text on the card, and on empty space between cards.
- [ ] Tab to a card and press the **Menu** key or **Shift + F10**: the menu opens by the card. Arrows move, **Escape** closes it and the card keeps focus.
- [ ] On a phone, press and hold a card for half a second: the actions open as a sheet from the bottom, and the card doesn't open underneath. Scrolling the page never opens it.
- [ ] Signed in as a Viewer: no power, backup, clone or delete items.
- [ ] **Your account**, **This browser**: turn off **Use Flytower's right-click menus**. Right-click now shows the browser menu in this browser only; the ⋯ buttons still work. Another browser still has the menus.

## Right-click menus: Files, Backups and Content

- [ ] **Files**: right-click a file for **Edit**, **Download**, **Rename**, **Copy path** and **Delete**; a folder has no Edit or Download. They match the row's ⋯ menu. Right-clicking inside the file editor still gives the browser menu.
- [ ] **Backups**: right-click a backup for **Download**, **Retry off-site copy** (only when the copy failed), **Restore**, keeping it forever and **Delete**, the same as its ⋯ menu. Restore and Delete still ask first.
- [ ] **Content**: each item has a ⋯ button. Right-click or ⋯ gives **Update to …** (only when there's an update), **Open project page** (Modrinth and Vanilla Tweaks), **Copy version** and **Remove…**. Remove shows the usual plan before anything changes. Items another one needs have no Remove.
- [ ] Focus a row's name and press the **Menu** key: its menu opens there.
- [ ] On a phone, press and hold a row: the sheet opens. **Download** from the sheet downloads the file.

## Command palette

- [ ] Press **Ctrl + K** (**⌘K** on a Mac) on any page, including while typing in a field: the palette opens. **Escape** closes it. The sidebar's **Search** button opens it too, also on a phone.
- [ ] Before typing: your servers come first, the one you're on at the top, then the ones you opened lately. On a server page, its tabs and actions follow ("Survival › Backups", "Survival › Restart"), then the panel's pages.
- [ ] Type part of a server's name: it's first, and Enter opens its console.
- [ ] Type "survival backups" (with your server's name): Enter opens that tab. "survival restart" asks before restarting, as the button does. "back" finds Back up now and Backups on every server.
- [ ] Pages are findable: Activity, System, Updates, Notifications, New server, Import, From YAML, Your account.
- [ ] Help pages still show once you type, below servers and pages.
- [ ] Signed in as a Viewer: no Start, Stop, Back up now, Clone or Delete, and no New server.

## System-wide disk use

You need a test VPS on this build with at least one server. Test with the Bun agent first, then again with the Rust one (`echo rust > /etc/flytower/agent`, then `systemctl restart flytower-agent`). See [Disk space](../disk.md).

- [ ] **System**, **Overview**, **Disk**: after a minute (or **Measure now**), the grey part of the bar is split into **Java runtimes**, **Flytower**, **System logs**, **Package cache and temp files** and **Operating system and everything else**, each in its own shade of grey. Servers keep their colours.
- [ ] Each part has a row under the servers, with its size. Hovering over the bar and the legend show the same sizes.
- [ ] Compare with the machine over SSH: `sudo du -sxh /opt/flytower/runtimes /var/log /var/cache/apt` should be close to Java runtimes, System logs and most of Package cache (give or take what was written since).
- [ ] The parts and the servers add up to the used space at the top; nothing is negative, and **Operating system and everything else** is a sensible size (usually 1 to 3 GB).
- [ ] If `/tmp` is a tmpfs (`findmnt /tmp`), it doesn't count towards anything.
- [ ] **Clean up** shows on System logs, Package cache and Flytower, and each row says how much can be freed (for System logs, how big the journal is). Signed in as someone who can't manage Flytower, there's no button.
- [ ] **System logs**, **Clean up**: pick 100 MB. The dialog says how much it should free. Press **Shrink the journal**: you're asked for your passkey, then a toast says how much was freed. `journalctl --disk-usage` agrees. The System logs row is smaller after a few seconds.
- [ ] **Package cache**, **Clean up**: run `sudo apt-get update && sudo apt-get install --download-only cowsay` first so there's something to clear. The dialog shows it, and afterwards `/var/cache/apt/archives` has no `.deb` files.
- [ ] **Flytower**, **Clean up** after a couple of updates (or install two PR builds): it lists what it would free. Afterwards `ls /opt/flytower/releases` shows only the running version and the one **Go back to** offers, and **Go back to** still works.
- [ ] While an update is running, removing old versions is refused with "an update is already running".
- [ ] **Activity** shows each clean-up, such as "Shrank the system journal to 100 MB, freeing 412.3 MB", under **Flytower, notifications, branding and Discord**.
- [ ] Stop the agent (`sudo systemctl stop flytower-agent`) and press **Measure now**: servers are still measured, and the rest goes back to one **System and other files** part. Start it again and measure: the parts come back.
- [ ] A disk warning sent before this update isn't sent again after it.
