# Troubleshooting

## The panel doesn't load

- Check the domain points at the machine: `dig +short panel.example.com`.
- Check ports 80 and 443 are open in your provider's firewall, as well as on the machine (the installer opens them with ufw).
- Right after installing, Caddy may still be getting the certificate. Give it a minute after DNS resolves.

## Logs

You'll need a shell on the machine: SSH (open it for a while from **System**, **SSH**), or your provider's web console.

```sh
journalctl -u flytower-panel -u flytower-agent -n 200 --no-pager   # the panel and agent
journalctl -u flytower-mc@survival -n 200 --no-pager               # one server
journalctl -u 'flytower-update-*' --no-pager                        # updates
```

A server's own logs are also on its **Logs** tab, and in `/srv/flytower/servers/<name>/logs`.

## A server won't start

- Its **Console** and **Logs** tabs show Minecraft's own error. The usual causes are a mod or plugin that doesn't suit the version, or a broken config file.
- Remove the content you added last (or restore the backup taken before it), then start it again.
- Out of memory: lower other servers' memory or raise this one's within the budget.
- If it crashed, the **Console** tab's banner links to the crash report, and **Logs**, **Crashes** has the log from just before it. After three crashes in ten minutes it's left stopped; **Start** tries again. See [Crashes](crashes.md).

## SSH

The installer leaves SSH open. Once the panel works and you have a passkey, close it from **System**, **SSH**. You can open it again for a set time (15 minutes to 24 hours). It closes by itself when the time is up, even across reboots.

If the panel itself is broken and SSH is closed, use your VPS provider's web console.

## Backing up the panel

Server backups don't include the panel's own database. To keep a copy of it (your passkeys, settings, history and off-site storage details), copy both of these somewhere safe:

- `/var/lib/flytower/flytower.db`
- `/etc/flytower/panel.env`. It holds the app secret, which off-site storage keys are encrypted with.

To restore them on a new machine: install Flytower, stop the panel (`systemctl stop flytower-panel`), put both files back (owned by `flytower`), and start it.

## Where things are

| Path                            | What                                     |
| ------------------------------- | ---------------------------------------- |
| `/opt/flytower/current`         | The installed release (with its own Bun) |
| `/etc/flytower`                 | Configuration and the app secret         |
| `/var/lib/flytower/flytower.db` | The panel's database                     |
| `/var/lib/flytower/backups`     | Backups, one folder per server           |
| `/srv/flytower/servers/<name>`  | Server folders                           |
| `/etc/caddy/Caddyfile`          | HTTPS, written by the installer          |

## Reporting a problem

Open an issue on [GitHub](https://github.com/MattA-Official/mc-panel/issues/new?template=feedback.yml), with what you did, what happened, and the logs above if you can.
