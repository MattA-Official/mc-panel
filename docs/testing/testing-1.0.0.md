# Testing 1.0.0

Thanks for testing. 1.0 is about trusting Flytower with real worlds: a security review, every upgrade path tested, passkey management, and full documentation. This is the first release meant for a **real VPS**. If you're testing on the throwaway one, update it from the **System** page.

Allow about 30 minutes.

## 1. Passkeys and recovery codes

- [ ] **System**, **Your passkeys** lists your passkey with when it was added and last used.
- [ ] **Add a passkey** on a second device: sign in on your phone (or another browser), then add one there. You're asked for your existing passkey first.
- [ ] Sign out and back in with the new one.
- [ ] Remove the old one. Your last passkey has no remove button.
- [ ] **Make new codes**: you get ten new codes, and an old code no longer works on the sign-in page.
- [ ] **Activity** shows the passkey changes and the new codes.

## 2. Security

- [ ] Deleting a backup now asks for your passkey (unless you confirmed one in the last five minutes).
- [ ] Your browser's developer tools (Network tab, any request) show a `Content-Security-Policy` header, and `Strict-Transport-Security` over HTTPS.
- [ ] Everything still works as before: console, charts, content search icons, file uploads, YAML editing. A blank page or missing icons would mean the new security headers block something; please report it with the browser console's errors.

## 3. Documentation

- [ ] Read [the documentation](../README.md) as if you were new. Anything wrong, missing or confusing is worth an issue, especially [Passkeys and recovery codes](../account.md) and [Troubleshooting](../troubleshooting.md).

## 4. Upgrading

- [ ] If you still have an install from before 0.5.0 anywhere, re-run the installer on it ([Updating](../updating.md#re-running-the-installer)). Your servers and sign-in survive.

## Reporting feedback

Open an issue with the **[Feedback](https://github.com/MattA-Official/mc-panel/issues/new?template=feedback.yml)** template. One issue per problem or idea is easiest.
