# Passkeys and recovery codes

Flytower has no passwords. You sign in with a **passkey**: your phone, laptop or password manager proves it's you with your fingerprint, face or PIN. Passkeys can't be phished, and there's nothing to leak.

## Setting up

The installer gives you a **setup token** (or uses the one you chose). The first time you open the panel, enter it, create your passkey, and save the ten **recovery codes** you're shown. Download them or copy them somewhere safe, like your password manager. You're asked to type one back to show you've saved them.

## More than one device

On **System**, **Account and security**, **Your passkeys**:

- **Add a passkey** creates one on the device you're using, or on a security key. Add at least two, so losing one device doesn't lock you out. Passkeys in iCloud Keychain, Google Password Manager, 1Password and similar sync between your devices by themselves.
- Remove a passkey you no longer use, or one on a lost device. Your last passkey can't be removed.

## If you lose every passkey

On the sign-in page, choose **Lost your passkeys? Use a recovery code**. Each code works once. After signing in with one, you're asked to add a new passkey straight away, before anything else.

Down to your last few codes? **System**, **Account and security**, **Make new codes** gives you a fresh set of ten. The old ones stop working.

## If you lose your passkeys and your codes

You need to get onto the machine itself, through your VPS provider's web console (or SSH if it's open). Then re-run the installer with a new setup token:

```sh
curl -fsSL https://github.com/MattA-Official/mc-panel/releases/latest/download/install.sh \
  | sudo bash -s -- --domain panel.example.com --setup-token NEW-LONG-RANDOM-TOKEN
sudo sqlite3 /var/lib/flytower/flytower.db 'DELETE FROM credentials; DELETE FROM recovery_codes;'
sudo systemctl restart flytower-panel
```

The panel then asks for the setup token again, as on the first day. Your servers, backups and settings are untouched. (`sqlite3` may need installing with `apt install sqlite3`.)

## Who did what

**Activity** lists every sign-in, passkey change and recovery-code use, alongside everything done to servers.
