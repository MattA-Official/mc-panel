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

## Inviting someone

1. Go to **System**, **People**, and choose **Invite someone**.
2. Pick a role and a server (or all servers). A note for who it's for is optional and only shown to you.
3. Copy the link and send it to them. It works once, for 7 days, and is only shown once.

When they open it, they choose a name, create a passkey and save their recovery codes, the same steps as first-time setup. Until they do, the link shows under **Invite links not used yet**, where you can cancel it.

You can only give someone access you have yourself.

## Changing or removing someone

On **System**, **People**, choose the pencil to change someone's roles, or the remove button to take them off. Both ask for your passkey and apply straight away: a removed person is signed out on their next click and their passkeys stop working.

The last Owner can't be removed or given a smaller role. Make someone else an Owner first.

Everything here is recorded under **Activity**, in **Sign-ins and access**.
