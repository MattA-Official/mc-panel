# Backups

Everything here is on a server's **Backups** tab.

## Taking backups

- **Back up now**, with a note if you like. If the server is running, it pauses saving for a moment so the world on disk is consistent. Players stay connected.
- **Schedule**: every 6 or 12 hours, daily, weekly, or your own cron expression, in your time zone.
- Flytower also takes a **safety** backup before anything risky: applying a plan that touches mods or the world, restoring, resetting the world, or copying another world in.

Backups are `.tar.zst` archives of the whole server folder. They live in `/var/lib/flytower/backups/<server>`, and you can download them.

## How many are kept

Scheduled backups are thinned out by the **keep** settings. By default Flytower keeps the newest 6, plus the newest from each of the last 7 days and the last 4 weeks. The three newest safety backups are kept. Backups you take yourself are never deleted automatically.

## Restoring

Choose **Restore** on a backup. Flytower asks for your passkey, takes a safety backup of how things are now, stops the server, puts the backup back, and starts it again. Changed your mind? Restore the safety backup.

## Off-site copies

A backup on the same machine won't help if the machine is lost. Flytower can copy backups to any S3-compatible storage, such as Backblaze B2, Cloudflare R2, Wasabi or Amazon S3.

1. Create a bucket with your provider, and an access key that can read, write and delete in it. With R2 and B2, a key limited to that one bucket is best.
2. **System**, **Off-site storage**, **Add storage**. Enter the endpoint (for example `https://s3.eu-central-003.backblazeb2.com`), region, bucket, an optional folder prefix, and the key. **Test** writes, reads back and deletes a small file.
3. On each server's Backups tab, choose the storage under **Off-site copies**, or set `backups.offsite` in its [YAML](spec.md#backups). Existing backups are copied, and new ones follow within a minute or two.

Each backup shows a cloud icon once its copy is safe. Failed uploads retry by themselves (after 1, 5 and 30 minutes), and **Retry off-site copy** tries again straight away. Deleting a backup, or retention removing it, deletes its copy too. Copies are stored under `<prefix>/<server>/<file>`.

If a backup's local file is lost, the backup shows **Off-site only**, and restoring it downloads it first.

The secret key is encrypted with the panel's app secret (in `/etc/flytower/panel.env`) and is never shown again after you save it.

## Sharing a world

**World exports** makes a zip of just the world, ready for single player. **Share** gives a link anyone can download it from, without signing in, for as long as you choose. Revoke a link to stop it working.
