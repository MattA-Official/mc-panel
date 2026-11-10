---
section: Looking after the machine
order: 21
since: '1.1.0'
panelRoute:
  - '/system'
---

# Disk space

A full disk is one of the few things that can corrupt a Minecraft world: if the server can't finish writing a save, the region file it was writing can be left half done. Flytower shows where the space has gone and warns you well before it runs out.

## Where the space has gone

**System**, **Overview**, **Disk** shows one bar for the disk that holds your servers. Each server has its own colour, then imports and archives, then everything else on the machine (the system, Java, Flytower itself), then free space. Hover over a part of the bar to see its size.

The table under it lists each server's total and its largest part, with links to its details and its backups. A server's total includes its backups and world exports, since those are kept for it.

Each server's **Settings** tab has a **Disk use** card that splits the server into:

| Part                     | What's in it                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| World                    | Every folder starting with `world`, and the folder named by `level-name` in `server.properties` |
| Backups                  | This server's backups, kept in `/var/lib/flytower/backups/<name>`                               |
| World exports            | Zips made with **World**, **Export world**                                                      |
| Logs and crash reports   | `logs` and `crash-reports`                                                                      |
| Mods, plugins and config | `mods`, `plugins` and `config`                                                                  |
| Web map                  | The server's [web map](map.md), kept in `/var/lib/flytower/maps/servers/<name>`                 |
| Other                    | Everything else, such as the server jar and its libraries                                       |

Sizes are what files really take up on the disk. Symbolic links aren't followed, and a file linked twice is counted once.

## When it's measured

Walking a big world takes a while, so Flytower measures in the background, one server at a time, and pages show the last result:

- straight after anything that changes a server's files: a backup, restore, world reset, world copy, export, import, or applying a spec;
- every hour, to catch everything else (the world growing as people explore, logs piling up);
- when you press **Measure now** on System.

The last result is kept, so the figures are there straight away after Flytower restarts. If Flytower can't read some of a server's files (Java's temporary files, for example), the figures say so, since the real total is a little higher.

How full the disk is, as a whole, is checked every minute along with the rest of the machine's metrics.

## Warnings

| How full  | What happens                                                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 85%       | System shows a warning, and a [notification](notifications.md) goes out if a channel has **The disk is nearly full** ticked.                |
| 95%       | A red banner shows on every page. Scheduled backups are skipped, a second notification goes out, and **Back up now** asks before it starts. |
| Below 80% | A "back to normal" notification goes out.                                                                                                   |

A scheduled backup that's skipped doesn't start at all, so it can't fill the disk halfway through. It shows in the job list as "Skipped: the disk is 96% full…", and channels with **A backup failed** ticked hear about it. Backups carry on as normal once there's room. You can still back up by hand: Flytower warns you first, since the backup itself needs space.

## Freeing up space

Old backups and world exports are the usual culprits.

- Lower how many backups each server keeps (**Backups**, **Schedule**), or delete old ones. Backups you took yourself are never deleted automatically.
- Delete world exports you've already downloaded (**World**, **Export world**).
- Deleted servers are kept as archives in `/var/lib/flytower/archive` so they can be brought back. Delete the ones you're sure about over [SSH](troubleshooting.md).
- With [off-site copies](backups.md#off-site-copies) set up, you can keep fewer backups on the machine.
