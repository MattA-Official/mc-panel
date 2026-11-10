# Testing 0.4.0

Thanks for testing. This release is about running several servers on one machine: an address for each, help with DNS, a memory budget so the machine isn't overcommitted, cloning servers, and copying worlds between them. Please keep using a **throwaway VPS**, ideally one with a domain you can add DNS records to. You can upgrade the 0.3.0 install or start fresh.

Allow about 45 minutes.

## 1. Memory budget

- [ ] The **Servers** page shows how much memory your servers have been given, out of what the machine has room for. **System** shows the same, server by server.
- [ ] In **New server**, the memory slider stops at what's free.
- [ ] Try to give a server more than is free (Settings, Resources, or `memory:` in YAML). It's refused, and the message says the most it could have and what the other servers use.
- [ ] Lower a server's memory: the free amount goes up straight away.

## 2. Addresses and DNS

- [ ] **Settings**, **Address**: give a server a hostname on your domain, like `survival.yourdomain`. The server cards and the server header now show it, with a copy button.
- [ ] Under it, **DNS records** lists exactly what to create: an A record, and an SRV record if the server isn't on port 25565. Create them with your DNS provider (on Cloudflare, set them to **DNS only**, grey cloud).
- [ ] **Check again** after a few minutes. Each record shows **Right**.
- [ ] Connect in Minecraft with just the hostname, no port, even for a server on another port.
- [ ] Point a record somewhere else on purpose. It shows **Wrong** and where it points now.
- [ ] Give a second server the same hostname. It's refused.
- [ ] Set `hostname:` in the YAML tab instead, and clear it with `hostname: null`.

## 3. Cloning

- [ ] **Settings**, **Clone**: clone a running server with its world. Players on the original stay connected. The copy starts on the next free port with the same mods, datapacks and settings, and your builds are there.
- [ ] Clone again with **Copy the world too** off. The copy has the same mods and datapacks but a fresh world.
- [ ] The copies show up in the memory budget.

## 4. Copying a world between servers

- [ ] **World** tab on one server, **Copy a world in**: pick another server. You're asked for your passkey, a backup is taken, and the server restarts on the other server's world.
- [ ] This server's own Vanilla Tweaks or Modrinth datapacks are still installed afterwards.
- [ ] Restore the "Before copying in …" backup from the Backups tab. The original world is back.

## Not in 0.4.0 yet

Self-update, signed releases, metrics history and the audit log page (0.5.0), then Paper, plugins and off-site backups (0.6.0).

## Reporting feedback

Open an issue with the **[Feedback](https://github.com/MattA-Official/mc-panel/issues/new?template=feedback.yml)** template. One issue per problem or idea is easiest. For DNS problems, a screenshot of the DNS records section and of your provider's records helps most. For anything that broke, include the output of:

```sh
journalctl -u flytower-panel -u flytower-agent -n 200 --no-pager
```

(That one needs SSH, which you can open for a while from the **System** page. If you'd rather not, a screenshot of the error is plenty.)
