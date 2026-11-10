---
section: Running servers
order: 12
---

# Addresses and DNS

By default players connect to your VPS's IP address, with a port for every server after the first. A **hostname** per server lets them type `survival.example.com` instead, with no port.

## Setting one

A server's **Settings**, **Address**: enter the hostname, such as `survival.example.com`. You can also set it with `hostname:` in the [YAML](spec.md). Two servers can't share one.

## DNS records

Under the address, **DNS records** lists exactly what to create with your DNS provider:

- An **A record** (and **AAAA** if the machine has IPv6) pointing the hostname at the VPS.
- An **SRV record** (`_minecraft._tcp.<hostname>`), when the server isn't on port 25565. This tells Minecraft which port to use, so players don't need to type it.

On Cloudflare, set the records to **DNS only** (grey cloud). Minecraft traffic can't go through Cloudflare's proxy.

**Check again** looks the records up and marks each one **Right**, **Missing** or **Wrong** (with where it points now). DNS changes can take a few minutes to show.

## The panel's own address

The panel's domain is set when you install (`--domain`). Caddy gets and renews its certificate. To move the panel to another domain, re-run the installer with the new `--domain`. Your passkeys belong to the old domain, so sign in with a [recovery code](account.md) once on the new one, then add a passkey.
