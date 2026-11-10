---
section: Getting started
order: 5
since: '1.2.0'
panelRoute:
  - '/access'
  - '/access/**'
---

# People and roles

Flytower can have more than one person signing in. Each person has one or more **roles**, each for one server or for all of them. Roles add up: someone can be an Operator on every server and an Admin on one.

## Roles

| Role         | Can                                                                                                                                                                    |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Owner**    | Everything, including people, Flytower updates, SSH, notifications, off-site storage and branding. There's always at least one Owner.                                  |
| **Admin**    | Everything on their servers: settings, files, content, backups and downloads, worlds, schedules, and deleting the server. On all servers, can also create new servers. |
| **Operator** | Start, stop and restart, the console and logs, players (whitelist, operators, bans) and taking backups.                                                                |
| **Viewer**   | The server's status, settings and who's online. Not the console or logs, since they show players' IP addresses.                                                        |

Dangerous actions (deleting, restoring, resetting a world, opening SSH and so on) still ask for a passkey, whatever the role.

## Custom roles

On **Access**, the **Roles** tab lists every role, and **New role** makes your own, such as a Moderator who can read the console and manage players but not start or stop the server. Tick what it can do. Anything done on a server includes seeing it. The permissions under **Across Flytower** (creating servers, people, managing Flytower, all activity) only count when the role is given for all servers.

Changing a role changes it for everyone who has it, straight away. A role can be deleted once nobody has it, and its unused invite links are cancelled. Built-in roles can't be changed, and you can't make a role that can do more than you can.

## What people see

People only see the servers they've been given. On a server, tabs they can't use are hidden: without the console permission a server opens on its players, and Files only shows with the files permission. Where they can look but not change things (settings, content, players, backups, schedules, world), the tab says **View only** and its buttons are off. Start, stop and restart only show for people who can use them, as do **New server** and the System pages for updates, storage, notifications, branding and SSH.

If someone's access changes while they have the panel open, it updates when they come back to the tab.

## Inviting someone

1. Go to **Access** in the sidebar. On the **People** tab, choose **Invite someone**.
2. Pick a role and a server (or all servers). A note for who it's for is optional and only shown to you.
3. Copy the link and send it to them. It works once, for 7 days, and is only shown once.

When they open it, they choose a name, create a passkey and save their recovery codes, the same steps as first-time setup. Until they do, the link shows under **Invite links not used yet**, where you can cancel it.

You can only give someone access you have yourself.

## Changing or removing someone

On **Access**, **People**, choose the pencil to change someone's roles, or the remove button to take them off. Both ask for your passkey and apply straight away: a removed person is signed out on their next click and their passkeys stop working.

The last Owner can't be removed or given a smaller role. Make someone else an Owner first.

Everything here is recorded under **Activity**, in **Sign-ins and access**.
