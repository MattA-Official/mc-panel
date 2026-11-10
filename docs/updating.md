# Updating Flytower

## From the panel

**System**, **Updates** shows the version you're on and offers any newer release, with its notes. **Update** asks for your passkey, then:

1. downloads the release and checks its signature against Flytower's release key;
2. copies the panel's database aside;
3. switches to the new version and restarts the panel and agent. Your Minecraft servers keep running throughout;
4. checks the new panel starts and answers. If it doesn't, Flytower puts the previous version and the database back by itself, and the card says what went wrong.

The panel is away for a minute or so. **Go back to** the previous version is offered afterwards in the same way. Both show up in **Activity**.

## Stable or Beta

The **Update channel** on the same card chooses what you're offered:

- **Stable** (the default): finished releases only.
- **Beta**: betas too, such as `1.1.0-beta.1`, so you can try new features before they're released. They're signed and tested like any release, but may have rough edges. Take a backup of anything you care about first.

Changing the channel doesn't install anything, and shows up in **Activity**. A beta is marked **Beta** when it's offered.

Choosing Stable again while you're running a beta doesn't take you backwards: you're offered the next stable release that's newer than your beta (`1.1.0` comes after `1.1.0-beta.3`). To leave a beta sooner, **Go back to** the version you had before.

If you install a beta with the installer and never choose a channel, Flytower assumes Beta.

## Releases are signed

Each release's `SHA256SUMS` is signed with Flytower's Ed25519 release key. The installer and the updater both check the signature before installing anything, using the public key built into them. A download that doesn't match is refused.

## Re-running the installer

Running the installer again is always safe. It installs the release you ask for (the newest stable release by default, or the newest beta with `--beta`), keeps your data, settings and app secret, and runs any database changes. Use it to upgrade installs from before 0.5.0, which had no updater, or if the panel won't start at all:

```sh
curl -fsSL https://github.com/MattA-Official/mc-panel/releases/latest/download/install.sh \
  | sudo bash -s -- --domain panel.example.com
```

Every release is tested upgrading from each earlier one, including the database, before it's published.

## Minecraft and Java

Flytower updates itself, not your servers. Minecraft versions change only when you choose (Settings, **Version**), and mods and plugins only when you update them. See [Content](content.md#updates). Java is installed per server as each Minecraft version needs it.

## Publishing a beta

For maintainers: run the **Release** workflow with a version like `1.1.0-beta.1`. Any version with a `-suffix` is published as a GitHub pre-release, which only Beta installs are offered. Number betas `beta.1`, `beta.2` and so on; `beta.10` correctly comes after `beta.9`.
