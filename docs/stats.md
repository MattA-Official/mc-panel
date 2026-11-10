---
section: Running servers
order: 19
since: '1.3.0'
---

# Player stats

Each server's **Players** tab has a **Stats** view with leaderboards and a card for every player. Anyone who can see the server in the panel can see it.

## Where the figures come from

Flytower doesn't add a mod or plugin for this. It uses two things it already has:

- **Visits**: when each player joins and leaves, from the server's log. This gives first and last seen, the number of visits and who is online.
- **A daily read of Minecraft's own stats files** (`world/players/stats/`, or `world/stats/` on older versions) at 03:30 in the server's time zone. Flytower keeps about twenty numbers per player from them, not the thousands of counters the files hold.

Because the stats are read once a day, the leaderboards can be up to a day behind. People who can change the server's settings can press **Read now** on the Stats view to read them straight away.

## Leaderboards

There are five boards, each showing the top ten:

| Board              | What it counts                                                                         |
| ------------------ | -------------------------------------------------------------------------------------- |
| Playtime           | Time in the game, as Minecraft counts it                                               |
| Deaths             | Times the player died                                                                  |
| Mob kills          | Mobs killed                                                                            |
| Distance travelled | Walking, sprinting, swimming, flying with elytra, boats, horses and minecarts together |
| Blocks mined       | Every block broken with the right tool                                                 |

Switch between **All time**, **This month** and **This week**. Weeks start on Monday and months on the 1st, in the server's time zone. Players with the same figure share a place.

If a world is reset, its counts start again from zero; Flytower counts everything in the new world as new.

## Turning stats off and leaving players out

Under **Settings**, **Community**, **Player stats** you can turn stats off for a server (what was kept stays and is still shown, but nothing new is kept) or leave individual players out. A player who is left out has everything kept about them on that server deleted, and never appears on the Stats view, a leaderboard or anywhere else.
