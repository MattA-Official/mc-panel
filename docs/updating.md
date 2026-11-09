# Updating Flytower

## From the panel

**System**, **Flytower** shows the version you're on and offers any newer release, with its notes. **Update** asks for your passkey, then:

1. downloads the release and checks its signature against Flytower's release key;
2. copies the panel's database aside;
3. switches to the new version and restarts the panel and agent. Your Minecraft servers keep running throughout;
4. checks the new panel starts and answers. If it doesn't, Flytower puts the previous version and the database back by itself, and the card says what went wrong.

The panel is away for a minute or so. **Go back to** the previous version is offered afterwards in the same way. Both show up in **Activity**.

## Releases are signed

Each release's `SHA256SUMS` is signed with Flytower's Ed25519 release key. The installer and the updater both check the signature before installing anything, using the public key built into them. A download that doesn't match is refused.

## Re-running the installer

Running the installer again is always safe. It installs the release you ask for (the newest by default), keeps your data, settings and app secret, and runs any database changes. Use it to upgrade installs from before 0.5.0, which had no updater, or if the panel won't start at all:

```sh
curl -fsSL https://github.com/MattA-Official/mc-panel/releases/latest/download/install.sh \
  | sudo bash -s -- --domain panel.example.com
```

Every release is tested upgrading from each earlier one, including the database, before it's published.

## Minecraft and Java

Flytower updates itself, not your servers. Minecraft versions change only when you choose (Settings, **Version**), and mods and plugins only when you update them. See [Content](content.md#updates). Java is installed per server as each Minecraft version needs it.
