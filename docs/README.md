# Flytower documentation

Flytower is a web panel for running Minecraft servers on your own VPS. You install it once, then create and look after servers from the browser. You sign in with a passkey.

## Getting started

- [Installing Flytower](install.md): what you need, the installer, and its options.
- [Your first server](first-server.md): creating, starting and joining a server.
- [Your account, passkeys and recovery codes](account.md): signing in, extra devices, your name and appearance, and what to do if you lose them.
- [People and roles](people.md): inviting people as Admins, Operators or Viewers, for one server or all of them.

## Running servers

- [Mods, plugins and datapacks](content.md): Modrinth, Hangar, Vanilla Tweaks, and your own files.
- [Backups](backups.md): schedules, retention, restoring, off-site copies, and past worlds.
- [Addresses and DNS](addresses.md): giving each server its own hostname.
- [Public status page](status-page.md): a page anyone can open, with the address, whether it's up and who's on.
- [Web map](map.md): a live map of the world in the browser, made by squaremap.
- [Scheduled tasks](schedules.md): restarts with an in-game countdown, console commands and announcements.
- [Crashes](crashes.md): crash reports, crash loops, and servers that stop responding.
- [Notifications](notifications.md): Discord, ntfy and JSON webhooks for crashes, failed backups, a filling disk, updates and players.
- [Discord app](discord.md): slash commands like `/status` and `/players` in your Discord server.
- [Server YAML reference](spec.md): every field of a server spec.

## Looking after the machine

- [Branding](branding.md): your own name, colours, font, logo and favicon.
- [Disk space](disk.md): where the space has gone, warnings at 85% and 95%, and freeing some up.
- [Updating Flytower](updating.md): self-update, going back, update badges, and upgrading old installs.
- [Troubleshooting](troubleshooting.md): logs, SSH, and getting the panel itself back.

## How it fits together

- The **panel** (`flytower-panel`) is the web app. It runs as the unprivileged `flytower` user and listens only on `127.0.0.1:3000`. Caddy puts it on HTTPS.
- The **agent** (`flytower-agent`) is a small root helper. It does a fixed list of jobs over a Unix socket: creating server users and folders, managing systemd units, installing Java, opening ports, and updating Flytower.
- Each **server** runs as its own user (`mc-<name>`) from `/srv/flytower/servers/<name>`, under systemd (`flytower-mc@<name>`), with a fixed memory limit. Its folder is an ordinary Minecraft server folder that still runs without Flytower.
