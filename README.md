# Flytower

A self-hosted web panel for running Minecraft servers. Install it once on a fresh VPS, then create, configure and look after any number of servers from the browser. You sign in with a passkey, and you never need SSH again.

**Latest:** 1.0.1 on the Stable channel, and 1.1.0-beta.6 on the Beta channel. **Install:** [docs/install.md](docs/install.md). **Everything else:** [the documentation](docs/README.md).

## What it is

- **One install, then the browser.** The installer sets up the panel only. Servers, Java runtimes, mods and datapacks are all managed from the panel.
- **Specs, not scripts.** Each server is a YAML spec. Edit it as a form or as YAML, then apply it.
- **Trusted sources, no lock-in.** Mojang, Fabric, PaperMC, Modrinth, Hangar and Vanilla Tweaks are built in. Every server folder is an ordinary server folder that still runs without Flytower.
- **Many servers per box.** Each server gets its own user, folder, memory limit, port and hostname.
- **Safe by design.** The panel never runs as root. A small root helper does a fixed list of jobs, and every release is signed and checked before it's installed.

## Features

- **Servers and content:** vanilla, Fabric and Paper servers; mods, plugins and datapacks from Modrinth, Hangar and Vanilla Tweaks, or your own files; a live console, players, whitelist and operators.
- **Backups:** scheduled backups with retention, restores, and off-site copies to S3-compatible storage.
- **Self-updates:** signed updates from the panel on a Stable or Beta channel, rolled back automatically if they fail, with **Go back to** for the previous version.
- **Activity and performance:** a log of who changed what, and performance history for each server.

New in 1.1.0 (on the Beta channel now):

- **Notifications** to Discord, ntfy or a JSON webhook for crashes, failed backups, a filling disk, updates and players joining. [More](docs/notifications.md)
- **Crash detection:** crash reports kept and shown in the panel, automatic restarts, crash loops stopped, and servers that stop responding noticed. [More](docs/crashes.md)
- **Scheduled tasks:** restarts with an in-game countdown, console commands and announcements, in each server's own time zone. [More](docs/schedules.md)
- **Update badges** for Flytower, mods, plugins, datapacks, Minecraft and Java. Nothing installs by itself. [More](docs/updating.md)
- **Disk use:** where the space has gone, warnings at 85% and 95%, and backups skipped rather than fill the disk. [More](docs/disk.md)
- **Hidden secrets:** secrets in `server.properties` never appear in specs, the Settings form or clones.

Coming soon in 1.2.0 (merged on `main`, not yet released):

- **Branding:** your own name, accent colour, font, logo and favicon across the panel, sign-in page, Discord and in-game messages. [More](docs/branding.md)
- **Player heads** on the Players tab, fetched from Mojang by the panel itself and kept on disk.
- **Past worlds:** keep the old world when you reset one, to download, share or turn into a new server. [More](docs/backups.md#past-worlds)

## Install

On a fresh Ubuntu 24.04+ or Debian 12+ server, with a domain pointing at it:

```sh
curl -fsSL https://github.com/MattA-Official/mc-panel/releases/latest/download/install.sh \
  | sudo bash -s -- --domain panel.example.com
```

The installer prints a one-time setup token. Open your domain, enter it, and create your passkey. You can also install on Hetzner Cloud with no SSH at all, through cloud-config. See [Installing Flytower](docs/install.md) for both.

**Stable or Beta.** The installer installs the newest stable release by default. Add `--beta` for the newest release including betas, or `--version <x.y.z>` for a specific one. Once installed, choose the update channel under **System → Updates**. See [Stable or Beta](docs/updating.md#stable-or-beta).

**Testing a pull request.** `--pr <number>` installs the signed test build of that pull request. It's for test boxes, not real servers. Each release's testing notes are in `docs/testing/testing-<version>.md`.

## Development

Flytower uses [Bun](https://bun.sh) 1.4 or later for everything: runtime, package manager, scripts and tests. There's no Node.js and no npm.

```sh
bun install
bun test
bun run lint
bun run typecheck
```

To work on the panel without root or systemd, run the fake agent next to the dev server. It simulates services, logs and RCON:

```sh
bun run --filter @flytower/agent dev   # terminal 1
bun run --filter @flytower/panel dev   # terminal 2, then open http://localhost:3000 (setup token: dev-setup-token)
```

Commit and pull request titles use Conventional Commits (`feat:`, `fix:`, `docs:` and so on), because release notes are built from them.

### Layout

| Path                 | What                                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------- |
| `apps/panel`         | Nuxt web app (UI and API), runs unprivileged                                                  |
| `packages/agent`     | Root helper that performs a fixed list of operations over a Unix socket                       |
| `packages/protocol`  | Shared message schemas between the panel and the agent                                        |
| `packages/providers` | Where servers and content come from (Mojang, Fabric, Paper, Modrinth, Hangar, Vanilla Tweaks) |
| `packages/rcon`      | Minecraft RCON client                                                                         |
| `installer/`         | One-line installer for a fresh Ubuntu or Debian VPS                                           |
| `scripts/`           | Release packaging and notes                                                                   |
| `tests/e2e/`         | Installer and browser end-to-end test (Bun.WebView, systemd container)                        |
| `docs/`              | User documentation and testing notes                                                          |

## Documentation and roadmap

- [Documentation](docs/README.md): installing, running servers, and looking after the machine.
- [Milestones](https://github.com/MattA-Official/mc-panel/milestones): what's planned for each release.
- [Issues](https://github.com/MattA-Official/mc-panel/issues): bugs and feature requests.
- [Releases](https://github.com/MattA-Official/mc-panel/releases): signed builds and release notes.

## Licence

Flytower is free software under the [GNU Affero General Public License v3.0](LICENSE). You can use, change and share it. If you run a changed version for other people over a network, you must offer them its source.
