---
section: Running servers
order: 19
since: '1.3.0'
panelRoute:
  - '/servers/:name/world/map'
---

# Web map

A server can have a map of its world that opens in the browser. It looks like the game's own maps seen from above, keeps up as players explore and build, and shows where everyone is while you watch.

Flytower draws it itself, from the world's files. Nothing is added to the server, so it works the same on vanilla, Fabric and Paper, and the server needs no extra memory or ports.

## Turning it on

On the server's **World** tab, **Web map**, switch on **Draw a web map**. Flytower draws the whole world straight away, then keeps it up to date. You can also set it in the [YAML](spec.md#map) with `map: { enabled: true }`.

Turning it off stops drawing and deletes the map's files. Turning it back on draws everything again.

## How it keeps up

Minecraft saves the world every few minutes, and whenever the server stops. Flytower notices each save as it happens (it doesn't keep checking) and, once saving has been quiet for half a minute, draws just the parts of the world that changed. A busy server is redrawn at least every five minutes.

**Draw now** on the card draws what's changed without waiting. **Redraw everything** draws the whole world again, which is only needed if something looks wrong.

When the world is reset, copied from another server or restored from a backup, the next drawing notices that every region file is new and draws the new world, and parts of the old one that aren't in the new world disappear.

The card shows how drawing is going, as it happens: when the map was last drawn, how much changed, and how long it took. If any chunks couldn't be read (a damaged region file, say), it says how many and why, and draws the rest.

### Colours

The colours come from the game itself: the first time a server on a new Minecraft version is drawn, Flytower downloads that version's game files from Mojang, checks them against Mojang's published checksum, works out a colour for every block and biome, and deletes the download. Nothing in it is ever run.

If that download fails, the map is drawn with simpler built-in colours, the card says so, and the next drawing tries again.

## Opening it

Once the map has been drawn, the card has an **Open map** button. The map is at:

- `https://<your panel>/s/<server name>/map/`
- `https://<hostname>/map/` too, when the server has its own [hostname](addresses.md) and its public page is on.

On the map:

- Drag to move around. Scroll, pinch, double-click (Shift to zoom out) or use **+** and **−** to zoom.
- Pick the **Overworld**, **Nether** or **End** at the top. The Nether is drawn below its roof.
- The coordinates under the pointer are at the bottom left.
- Players online in this dimension show with their heads. The list at the bottom right jumps to each one.
- The address keeps where you're looking, so you can send someone a link to a spot.

An open map checks for newly drawn parts every minute, and player positions every few seconds.

## Who can see it

- **Show players**: where each online player is. Flytower asks the server with the game's own `data` command, only while someone has the map open, and at most every three seconds however many people are looking.
- **Anyone can open it**: lets people open the map without signing in, and links it from the [public page](status-page.md#web-map) and `/status` in [Discord](discord.md). This needs the public page on. Off (the default), only people who can see the server in the panel can open it.

When the map is public, the card shows its address to share, with a copy button.

Someone who isn't signed in and opens a map that isn't public is sent to sign in. Anyone who can't see the server, or opens a map that's off, gets "Not found", exactly as for a server that doesn't exist.

Player heads come from the panel's own copy of their skins, never from another site. The map page loads nothing from anywhere else, and a public map never sets a cookie.

## What it costs

- **CPU:** drawing runs one server at a time, at the lowest priority, so the Minecraft servers always come first. A 512×512-block region takes well under a second; after the first drawing, only changed regions are drawn.
- **Memory:** about 20 MB while drawing, and nothing in between.
- **Disk:** one image per 512×512 blocks of explored world, plus zoomed-out copies. The server's **Disk use** card shows it on its own line, **Web map**. The files are in `/var/lib/flytower/maps`, not in the server's folder, so they're never in backups.
- **Ports:** none. The panel serves the map itself.
