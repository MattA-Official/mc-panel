# Discord app

Flytower can answer **slash commands** in your Discord server, such as `/status` and `/players`, through a Discord app you make. It's separate from [notifications](notifications.md), which only need a channel webhook.

Discord sends each command to your panel over HTTPS, so the panel needs a domain that Discord can reach from the internet. Flytower doesn't keep a connection open to Discord.

## Connecting an app

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and press **New Application**. Its name and icon are what people see next to the answers.
2. On the app's **Bot** tab, press **Reset Token** and copy the token.
3. In Flytower, open **System**, **Integrations**, paste the token into **Discord app** and press **Connect**. You're asked for your passkey.

Flytower then:

- reads the app's name, application ID and public key from Discord, so you don't copy them by hand,
- stores the token encrypted (it's never shown again), and
- sets the app's **Interactions Endpoint URL** to `https://<your panel domain>/api/discord/interactions`. Discord checks the address straight away by calling it, so a green **Connected** means Discord can reach the panel.

Last, press **Add to a Discord server** and pick the server. The app only needs the `applications.commands` scope, so it can't read messages or change anything in your Discord server.

## Commands

| Command                                 | Answers                                                                                                           |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `/status [server]`                      | Whether the server is online, starting or offline, its address, how many are on, and its version.                 |
| `/players [server]`                     | Who's on right now.                                                                                               |
| `/leaderboard [stat] [period] [server]` | The top players for playtime, deaths, mob kills, distance or blocks mined, for all time, this month or this week. |
| `/stats <player> [server]`              | One player's figures for all time, and what they added this week.                                                 |

Leave out `server` to get every server at once; as you type it, Discord suggests the servers you can see.

Both answer from the same information as the [public status page](status-page.md), so the server itself is never asked and the page's settings apply: a server whose page shows only a count shows only a count in Discord, and one that hides players or its version hides them here too.

**Which servers show.** Servers with their **public page** turned on. Everything else stays hidden: asking for it answers the same as a server that doesn't exist. Mapping Discord roles to Flytower roles, so staff can see and run more, comes in a later version.

**Leaderboards and stats.** `/leaderboard` and `/stats` use the same figures as the server's [Stats tab](stats.md). They only cover servers whose public page shows leaderboards (which needs the page to show player names, and the server to keep stats). Players left out of stats never appear, and `/stats` never says when someone last played. With more than one such server, pick one with `server`.

Answers are posted in the channel for everyone to see, except "no such server" and similar, which only the person who asked sees. Player names can never ping anyone.

Flytower sends Discord its command list when you connect, and again after an update if the list changed. If Discord didn't take it, the card says so, with **Send them again**.

## If the endpoint isn't set

The card says **Endpoint not set**, with Discord's reason, when Discord couldn't reach the panel or the panel has no domain. Fix the cause, then press **Try the endpoint again**. You can also copy the endpoint from the card into **Interactions Endpoint URL** on the app's **General Information** page in the Developer Portal; Discord checks it there too.

## Testing and disconnecting

**Test connection** checks the stored token still works for the same app, and notices if the endpoint was changed in the Developer Portal.

**Disconnect** takes the app's commands down, clears its endpoint, and forgets the token. The app itself stays in the Developer Portal and in any Discord server it was added to; remove it there if you don't want it any more. If you think the token has leaked, press **Reset Token** in the Developer Portal: the old one stops working at once, and you connect again with the new one.

## How it's kept safe

- Every request to the endpoint must carry Discord's Ed25519 signature, made with the app's private key and checked against its public key before anything else happens. Requests with a missing or wrong signature, or a timestamp more than five minutes off, get a 401.
- The bot token is encrypted with a key derived from the panel's own secret, like notification and off-site storage secrets.
- Connecting and disconnecting need **Manage Flytower** and a passkey check, and both are in **Activity**.
