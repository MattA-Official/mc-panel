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

## Keyboard shortcuts

Click somewhere blank on the page first so no field has focus.

- [ ] **?** opens a sheet listing every shortcut. Escape closes it.
- [ ] **G** then **S**, **A** or **Y** go to Servers, Activity and System from any page. On a server, **G** then **C**, **P**, **N**, **W**, **F**, **T** and **M** go to Console, Players, Content, World, Files, Settings and YAML; **G B** goes to World (backups). Off a server page these do nothing.
- [ ] On any server tab, **L** (or **G L**) opens the Logs pop-up; Escape closes it.
- [ ] **[** and **]** go to the previous and next server on the same tab, wrapping round.
- [ ] On Servers, **J** highlights the first card and **J**/**K** (or the arrow keys) move along. **Enter** opens the server; **.** opens its menu.
- [ ] On Files, **J**/**K** move through the rows, **Enter** opens a file in the editor (or a folder), and **Shift + Delete** asks to delete it. On Backups and Content, **Enter** or **.** opens the row's menu.
- [ ] **/** on the console of a running server puts the cursor in the command line.
- [ ] **Ctrl + S** (⌘S on a Mac) saves Settings (even with the cursor in a field), and on YAML starts **Review**.
- [ ] Typing in any field, the console or the YAML editor never triggers a shortcut (try typing "gs" or "?").
- [ ] With a dialog or menu open, letters do nothing behind it.
- [ ] Ctrl + K: on a server, its tab rows show their shortcuts (Backups G B). The palette lists **Keyboard shortcuts**.
- [ ] **Your account → This browser → Use single-key shortcuts** off: letters, **?**, **/**, **[** and **]** do nothing, but Ctrl + K and Ctrl + S still work. Another browser is unaffected. Turn it back on.

## Console autocomplete

On a running Fabric server, open the **Console**.

- [ ] The first time a console opens for a Minecraft version, vanilla commands appear after 10 to 30 seconds (the panel runs the game's own command report once and keeps it). Until then, and on later visits straight away, commands from `help` complete.
- [ ] Type `gi`: **give** is suggested, with `give <targets> <item> [<count>]` under the list.
- [ ] `give ` suggests online players and `@p`, `@r`, `@s`, `@a`. `give <you> dia` suggests diamond items, and a greyed-out ending shows in the box.
- [ ] **Tab** fills in the highlighted suggestion; Tab again moves to the next, **Shift+Tab** back. **→** takes the greyed-out ending. **Escape** closes the list.
- [ ] **Up** and **Down** move in the list while it's open, and walk your command history when it's closed. Walking history doesn't open the list.
- [ ] `effect give @a ` lists effects, `gamemode ` the four game modes, `execute as @a run tp ` completes again after `run`.
- [ ] A mod command (`spark`, `chunky`) completes by name and shows its usage.
- [ ] A player who joins shows up in player suggestions without reloading. After a restart with a new mod, its command appears.
- [ ] On a phone, suggestions are a row of buttons above the box, and tapping one fills it in.
- [ ] Signed in as a Viewer: no command box and no suggestions.
