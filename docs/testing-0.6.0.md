# Testing 0.6.0

Thanks for testing. This release adds Paper servers, plugins from Modrinth and Hangar, and off-site backups to S3-compatible storage. Please keep using a **throwaway VPS**. If you're already on 0.5.0, update from the **System** page, which also tests the updater.

Allow about 45 minutes. For section 3 you'll need a bucket somewhere: Backblaze B2, Cloudflare R2, Wasabi and AWS S3 all work, and each has a free tier or trial.

## 1. Paper

- [ ] **New server**: choose **Paper** as the loader and the newest Minecraft version. It shows the Paper build it will use.
- [ ] Start it and join. In the console, `version` says Paper with the same build.
- [ ] On **Version**, try switching a Fabric server that has mods to Paper. The plan refuses and names the mods, since Paper can't run them. Remove them first (datapacks can stay) and it goes through.
- [ ] Import a Spigot or Purpur server (a zip or a folder). It comes in as Paper, with a note saying so.

## 2. Plugins

- [ ] On a Paper server, **Content** has a **Plugins** tab. Search **Modrinth** for "Chunky" and add it.
- [ ] Switch the source to **Hangar** and add "ViaBackwards". ViaVersion is added with it, because ViaBackwards needs it.
- [ ] Apply and restart. In the console, `plugins` lists all three.
- [ ] **World pre-generation** (Chunky) works on Paper.
- [ ] A Fabric server's Content tab still shows mods, not plugins.

## 3. Off-site backups

- [ ] **System**, **Off-site storage**, **Add storage**: fill in your bucket's endpoint, region, bucket name and keys. **Test** says it could write, read back and delete a small file.
- [ ] Enter a wrong secret key and press Test. It says what went wrong in plain words.
- [ ] Open a server's **Backups** tab and choose your storage under **Off-site copies**. Existing backups start uploading, each with a cloud icon that turns solid when its copy is safe.
- [ ] Take a new backup. It's copied off-site by itself within a minute or two.
- [ ] Delete a backup. Its copy disappears from the bucket too.
- [ ] The real test: delete a backup's local file over SSH (`rm /var/lib/flytower/backups/<server>/<file>`). The backup now shows **Off-site only**. Restore it, and Flytower downloads it first.
- [ ] Turn your bucket's keys off (or remove the bucket) and take a backup. The upload is marked failed with the reason, and retries later. **Retry off-site copy** in its menu tries again straight away.
- [ ] Your secret key never shows again after you save it, even on the System page.

## Not in 0.6.0 yet

Setting off-site storage in a server's YAML, and limits on how many off-site copies to keep (they follow the server's local retention for now).

## Reporting feedback

Open an issue with the **[Feedback](https://github.com/MattA-Official/mc-panel/issues/new?template=feedback.yml)** template. One issue per problem or idea is easiest. For anything that broke, include the output of:

```sh
journalctl -u flytower-panel -u flytower-agent -n 200 --no-pager
```
