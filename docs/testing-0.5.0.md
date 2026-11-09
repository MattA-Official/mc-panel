# Testing 0.5.0

Thanks for testing. This release is about living with Flytower day to day: releases are signed, Flytower can update itself (and go back if an update goes wrong), every server keeps a week of performance history, and there's a page showing everything that's been done. Please keep using a **throwaway VPS**. Start fresh with the 0.5.0 installer, because this is the first release the updater can move on from.

Allow about 30 minutes, plus a day or so of letting the charts fill in.

## 1. Signed install

- [ ] Run the installer from the 0.5.0 release notes. Before installing anything it prints "Release signature checked". If a download had been tampered with, it would stop there instead.

## 2. Performance history

- [ ] Start a server and join it. After a couple of minutes, its new **Performance** tab shows CPU, memory, players online and time per tick.
- [ ] Hover over (or tap) a chart. It shows the value and time at that point.
- [ ] Stop the server for a few minutes, then start it again. The charts show a gap for the time it was stopped, not a drop to zero.
- [ ] **System** page, **This machine**: CPU, memory and disk for the whole VPS.
- [ ] The next day, switch to **Day**, and after a week, **Week**. Older history disappears after seven days.

## 3. Activity

- [ ] **Activity** in the sidebar lists what's been done and who did it, newest first: starts and stops, backups, content changes, SSH openings and so on.
- [ ] Filter it by server and by kind of action.

## 4. Updating Flytower

This needs a newer release than yours. When 0.5.1 or later comes out:

- [ ] **System**, **Flytower** card: it offers **Update to 0.5.x** and shows what's in that release.
- [ ] Press it. You're asked for your passkey. The panel goes away for a minute or so, then comes back on the new version. Your servers keep running throughout.
- [ ] **Go back to 0.5.0**. The same thing happens in reverse, and Activity shows both.

If an update's panel doesn't start, Flytower puts the old version and its database back by itself, and the card says what went wrong. (This is tested automatically on every change. You don't need to break anything yourself.)

## Not in 0.5.0 yet

Paper, plugins and off-site backups (0.6.0).

## Reporting feedback

Open an issue with the **[Feedback](https://github.com/MattA-Official/mc-panel/issues/new?template=feedback.yml)** template. One issue per problem or idea is easiest. A screenshot of a chart that looks wrong helps most. For anything that broke, include the output of:

```sh
journalctl -u flytower-panel -u flytower-agent -u 'flytower-update-*' -n 200 --no-pager
```

(That one needs SSH, which you can open for a while from the **System** page. If you'd rather not, a screenshot of the error is plenty.)
