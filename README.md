# Flytower

A self-hosted web panel for running Minecraft servers. Install it once on a fresh VPS, then create, configure and run any number of servers from the browser. Sign-in is by passkey, and you never need SSH again.

> Status: early development, heading for 0.1.0. Not ready for real worlds yet.

## What it is

- **One install, then the browser.** The installer sets up the panel only. Servers, Java runtimes, mods and datapacks are all managed from the panel.
- **Specs, not scripts.** Each server is a YAML spec. You can edit it as a form or paste the YAML, then apply it.
- **Trusted sources, no lock-in.** Mojang, Fabric, Modrinth and Vanilla Tweaks are built in. Every server folder is an ordinary server folder that still runs without Flytower.
- **Many servers per box.** Each server gets its own user, folder, memory limit, port and hostname.

## Layout

| Path                | What                                                                    |
| ------------------- | ----------------------------------------------------------------------- |
| `apps/panel`        | Nuxt web app (UI and API), runs unprivileged (coming in 0.1.0)          |
| `packages/agent`    | Root helper that performs a fixed list of operations over a Unix socket |
| `packages/protocol` | Shared message schemas between the panel and the agent                  |
| `installer/`        | One-line installer for a fresh Ubuntu VPS (coming in 0.1.0)             |

## Development

Requires [Bun](https://bun.sh) 1.4 or later.

```sh
bun install
bun test
bun run lint
bun run typecheck
```

Roadmap, milestones and issues are tracked on GitHub.
