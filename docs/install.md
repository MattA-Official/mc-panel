---
section: Getting started
order: 2
---

# Installing Flytower

Flytower installs on a fresh **Ubuntu 24.04+** or **Debian 12+** server (amd64 or arm64). The installer sets up the panel only. Java and Minecraft are installed later, from the panel, when you create a server.

You need:

- A VPS with at least 4 GB of RAM (8 GB if you want more than one server running).
- A domain name you can add a DNS record to, for the panel itself (for example `panel.example.com`). Passkeys only work over HTTPS on a real name, and Flytower gets the certificate for you.

## Option A: Hetzner Cloud, no SSH at all

1. **Pick a setup token.** Any long random string, for example from a password manager. You'll type it into the panel once.
2. In the Hetzner Cloud console, create a server:
   - **Image:** Ubuntu 24.04
   - **Type:** CPX21 or larger (CPX31 for a few servers)
   - **Networking:** keep a public IPv4
   - **Cloud config:** paste this, with your domain and token:

     ```yaml
     #cloud-config
     runcmd:
       - curl -fsSL https://github.com/MattA-Official/mc-panel/releases/latest/download/install.sh | bash -s -- --domain panel.example.com --setup-token YOUR-SETUP-TOKEN
     ```

3. Once the server shows its IPv4 address, add a DNS **A record** for your panel domain pointing at it. If your DNS is on Cloudflare, leave it **DNS only** (grey cloud).
4. Wait two or three minutes, then open `https://panel.example.com`. If the certificate isn't ready yet, give it another minute: Caddy keeps retrying once DNS resolves.
5. Open the setup link the installer prints (or enter the setup token), create your passkey, and save your recovery codes.

## Option B: an existing server over SSH

```sh
curl -fsSL https://github.com/MattA-Official/mc-panel/releases/latest/download/install.sh \
  | sudo bash -s -- --domain panel.example.com
```

The installer prints a setup link and a setup token at the end. Open the link to go straight to creating your passkey, or open the panel and type the token if the link won't open where you are (on another device, say). Either works once, within 24 hours. Lost them before finishing setup? Run the same command again for new ones.

## What the installer does

- Unpacks the release (which includes its own Bun runtime) into `/opt/flytower/releases/<version>` and points `/opt/flytower/current` at it.
- Creates a `flytower` system user for the panel. The panel never runs as root; a small root helper (`flytower-agent`) does the handful of things that need it.
- Installs Caddy for HTTPS, and opens ports 22, 80 and 443 with ufw. Minecraft ports are opened per server as you create them.
- Stores data in `/var/lib/flytower`, configuration in `/etc/flytower`, and servers in `/srv/flytower/servers/<name>`.

Running the installer again is safe. It upgrades in place and keeps your data, secret and servers.

The installer checks the release's signature before installing anything, and prints "Release signature checked" when it matches. Releases before 1.0 are marked as pre-releases on GitHub, so the `latest` links above skip them. To install one, use the versioned link from its release notes.

### Options

| Option                 | Meaning                                                                    |
| ---------------------- | -------------------------------------------------------------------------- |
| `--domain <host>`      | The panel's address. Required.                                             |
| `--version <x.y.z>`    | Install a specific release. Defaults to the newest.                        |
| `--setup-token <text>` | Use this setup token instead of generating one.                            |
| `--tarball <file>`     | Install from a release tarball already on the machine.                     |
| `--pr <number>`        | Install the signed test build of that pull request. For testing only.      |
| `--no-caddy`           | Skip Caddy if you run your own HTTPS proxy (point it at `127.0.0.1:3000`). |
| `--no-firewall`        | Leave ufw alone.                                                           |

## Troubleshooting

- **The page doesn't load:** check DNS points at the server (`dig +short panel.example.com`), and that ports 80 and 443 are allowed in any provider firewall.
- **Logs:** `journalctl -u flytower-panel -u flytower-agent -n 100`, and `journalctl -u flytower-mc@<name>` for a server.

More in [Troubleshooting](troubleshooting.md). Next: [your first server](first-server.md).
