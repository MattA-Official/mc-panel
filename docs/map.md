# Web map

A server can have a map of its world that opens in the browser, drawn by [squaremap](https://modrinth.com/plugin/squaremap). It looks like an in-game map seen from above, and shows where everyone is while they play.

It works on Fabric and Paper servers. Vanilla servers can't load it, so change the loader in **Settings** first.

## Adding it

On the server's **World** tab, **Web map**, press **Add squaremap**. That adds squaremap to the server's content (and Fabric API, which it needs on Fabric) through the usual plan, so you see exactly what changes before anything happens. The server restarts to load it. You can also add it in the [YAML](spec.md#content) with `modrinth: squaremap`.

squaremap draws the world as players explore it and as chunks change. Places nobody has visited since it was added appear once they're next loaded.

## Opening it

Once squaremap has made the map (the first start after adding it), the card has an **Open map** button. The map is at:

- `https://<your panel>/s/<server name>/map/`
- `https://<hostname>/map/` too, when the server has its own [hostname](addresses.md) and its public page is on.

When the map is public, the card shows the address to share, with a copy button.

## Who can see it

- **Show players**: where each online player is, updated every second. Off, squaremap never writes their positions anywhere.
- **Anyone can open it**: lets people open the map without signing in, from the [public page](status-page.md). This needs the public page on. Off (the default), only people who can see the server in the panel can open it.

Someone who isn't signed in and opens a map that isn't public is sent to sign in. Anyone who can't see the server gets "Not found", exactly as for a server that doesn't exist.

Both can also be set with `map:` in the [YAML](spec.md#map).

Player heads on the map are turned off, because squaremap would otherwise load them from a third-party site and tell it who's looking at your map.

## What it costs

- **Memory:** squaremap runs inside the server's own Java, so there's no second program and the memory budget doesn't change. It draws in the background; on machines with four CPU cores or fewer, Flytower gives it one worker so players always come first. Give a server with a map at least 3 GB.
- **Disk:** one image per 512×512 blocks of explored world, at a few zoom levels. The map's files are under the server folder (`squaremap/web` on Fabric, `plugins/squaremap/web` on Paper).
- **Backups:** the map's tiles are left out of backups, since squaremap can always draw them again.
- **Ports:** none. squaremap has its own web server, but Flytower turns it off and serves the map's files itself, so nothing new listens on the network. The map page can't load anything from other sites, and a public map never sets a cookie.

## Settings Flytower looks after

Flytower writes these in squaremap's `config.yml` and puts them back if they're changed by hand:

- `settings.internal-webserver.enabled`: always `false`.
- `world-settings.default.player-tracker.enabled`: from **Show players**.
- `world-settings.default.player-tracker.nameplate.show-head`: always `false`.

Everything else in the file is yours to change, such as which dimensions are drawn or how far you can zoom. Run `squaremap reload` in the console afterwards. A per-world player tracker setting (under `world-settings.<world>`) wins over Flytower's default, so leave those out if you want **Show players** to decide.
