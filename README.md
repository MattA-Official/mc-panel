# Flytower

A self-hosted web panel for running Minecraft servers. Install it once on a fresh VPS, then create, configure and run any number of servers from the browser. Sign-in is by passkey, and you never need SSH again.

> Status: 0.1.0 pre-release for testing. Not ready for real worlds yet.

**Install:** see [docs/install.md](docs/install.md). **Testing a release:** see [docs/testing-0.1.0.md](docs/testing-0.1.0.md).

## What it is

- **One install, then the browser.** The installer sets up the panel only. Servers, Java runtimes, mods and datapacks are all managed from the panel.
- **Specs, not scripts.** Each server is a YAML spec. You can edit it as a form or paste the YAML, then apply it.
- **Trusted sources, no lock-in.** Mojang, Fabric, Modrinth and Vanilla Tweaks are built in. Every server folder is an ordinary server folder that still runs without Flytower.
- **Many servers per box.** Each server gets its own user, folder, memory limit, port and hostname.

## Layout

| Path                 | What                                                                    |
| -------------------- | ----------------------------------------------------------------------- |
| `apps/panel`         | Nuxt web app (UI and API), runs unprivileged                            |
| `packages/agent`     | Root helper that performs a fixed list of operations over a Unix socket |
| `packages/protocol`  | Shared message schemas between the panel and the agent                  |
| `packages/providers` | Where Minecraft and loaders come from (Mojang, Fabric)                  |
| `packages/rcon`      | Minecraft RCON client                                                   |
| `installer/`         | One-line installer for a fresh Ubuntu or Debian VPS                     |
| `scripts/`           | Release packaging and notes                                             |
| `tests/e2e/`         | Installer and browser smoke test (Bun.WebView, systemd container)       |

## Development

Requires [Bun](https://bun.sh) 1.4 or later.

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

Roadmap, milestones and issues are tracked on GitHub.
