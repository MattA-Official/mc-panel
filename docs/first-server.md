---
section: Getting started
order: 3
panelRoute:
  - '/'
  - '/servers/new'
  - '/servers/import'
  - '/servers/:name'
  - '/servers/:name/**'
  - '/servers/:name/settings#the-servers-tabs'
---

# Your first server

## Create it

1. **Servers**, **New server**.
2. Give it a **name**, which is what players see. The **short name** below it is used for its folder and can't change later.
3. Pick a **loader**:
   - **Vanilla**: Mojang's server, unchanged. Datapacks only.
   - **Fabric**: for mods (performance mods like Lithium, or gameplay mods). Datapacks work too.
   - **Paper**: for plugins (from Modrinth or Hangar), with Paper's own performance improvements. Datapacks work too.
4. Pick the **Minecraft version**. The newest release is chosen for you; tick **Snapshots** to see test versions.
5. Choose **memory**. The slider stops at what the machine has free (see _Memory budget_ below).
6. Leave **port** empty to use the next free one, starting at 25565.
7. **Create server**. Flytower installs the right Java, downloads the server, accepts the EULA for you (you agree to it by creating the server), and starts it.

Players connect to your VPS's address, with `:port` if it isn't 25565. To give each server a name of its own instead, see [Addresses and DNS](addresses.md).

## Other ways to start

- **Import server**: upload a world (a zip of the world folder) or a whole server folder, from your own computer or another host. Vanilla, Fabric, Paper, Spigot and Purpur servers are recognised. Spigot and Purpur come in as Paper, which reads the same worlds and plugins. `server.properties`, the whitelist, ops and bans come across.
- **From YAML**: paste a [server spec](spec.md), for example one downloaded from another Flytower.
- **Clone** (a server's **Settings** tab): a copy with the same settings and content, with or without its world.
- **A deleted server**: deleting a server archives its folder first, and you can import it back from **Import server**.

## The server's tabs

| Tab         | What it's for                                                                                                     |
| ----------- | ----------------------------------------------------------------------------------------------------------------- |
| Console     | Live output, and commands (without the `/`). Start, stop and restart are in the header.                           |
| Logs        | Today's log and older ones, to read or download.                                                                  |
| Players     | Who's online; kick, ban, operators, and the whitelist.                                                            |
| Performance | CPU, memory, players and time per tick over the last hour, day or week.                                           |
| Backups     | Backups, schedules, restoring, off-site copies, and world exports you can share.                                  |
| Content     | Mods, plugins and datapacks. See [Content](content.md).                                                           |
| World       | Pre-generating chunks (with Chunky), resetting the world, and copying another server's world in.                  |
| Files       | The server folder: edit, upload, rename, delete.                                                                  |
| Settings    | Name, `server.properties`, memory, port, address, Minecraft version and loader, cloning, and deleting the server. |
| YAML        | The whole server as one [spec](spec.md), to edit or download.                                                     |

## Typing commands in the console

The console suggests as you type: command names first, then what comes next, such as online players and `@a`/`@p` for a player, item and block ids for `give` and `setblock`, effects, sounds, game modes and coordinates. A line under the suggestions shows the command's shape, like `give <targets> <item> [<count>]`.

- **Tab** fills in the highlighted suggestion; press it again to go through the others, and **Shift+Tab** to go back. Type a space to move on to the next part.
- **Up** and **Down** move through the suggestions while they're open, and through your earlier commands when they're not. **Escape** closes them, and **→** at the end of the line takes the greyed-out suggestion.
- On a phone, suggestions are a row of buttons above the box.

Flytower gets the vanilla commands from the game itself: the first time a console opens for a Minecraft version, it downloads that version's server from Mojang and runs its built-in command report (in the background, at low priority, with the Java the server already uses), then keeps the result. Until that's done, and if it can't be done, you still get the commands from the server's `help`. Mods' and plugins' commands come from `help` too, so they complete by name and show their usage; their arguments don't. They're read again each time the server starts.

Only people who can send commands get suggestions.

## How it looks in the server list

**Settings**, **Game settings** has the server's entry in Minecraft's multiplayer list.

- **Server icon**: **Upload** a PNG, JPEG or WebP picture (up to 10 MB), drag and zoom to crop it square, and save. Flytower scales it to the 64×64 `server-icon.png` Minecraft reads, keeping only the image itself (nothing else from the file, such as its metadata). **Remove** goes back to the default. Clones keep the icon. It isn't part of the [spec](spec.md), since a spec can't carry a picture.
- **Message of the day**: two lines, with colours and formatting from the toolbar, or `§` codes with **Show codes**. See [`properties`](spec.md#properties).

A preview shows the whole entry as it'll look, and warns when a line is too long. Minecraft reads both when the server starts, so they show after the next restart.

## Plans

Anything that changes what a server runs (content, its version or loader, settings in YAML) shows a **plan** first: what will be added, updated or removed, how much will be downloaded, and whether a restart is needed. Nothing happens until you press **Apply**. Anything that touches mods or the world takes a backup first.

## Memory budget

Each server gets the memory you give it, plus about 0.5 GB that Java uses around it. Flytower keeps 1 GB for the system and itself, and won't let the total go over what the machine has. The **Servers** and **System** pages show who has what. If you need more room, lower another server's memory or move to a bigger VPS.

## Dangerous actions

Restoring a backup, resetting or copying a world, deleting a backup or a server, opening SSH, adding or removing passkeys, off-site storage changes and updates all ask for your passkey again, unless you confirmed one in the last five minutes.
