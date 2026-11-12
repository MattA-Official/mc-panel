# Docs screenshots

The pictures here are taken by a script, not by hand. Don't edit them.

A docs page asks for one with a block like this:

```markdown
::screenshot{name="backups" anchor="world.backups" labels="backups.back-up-now, backups.schedule"}
The Backups section of a server's World tab.
::
```

- `name`: the file name here (`backups-light.webp`, `backups-dark.webp`, `backups.json`).
- `anchor`: the page to picture, named by a control in `packages/docs-layer/anchors.ts`. A section's or card's anchor pictures just that section or card; anything else pictures the window.
- `labels`: controls to number on the picture, in order.
- `device="phone"`: a phone-sized picture.

To take or retake them, run `bun run docs:screens` (or `bun run docs:screens backups people` for some), or the **Docs screenshots** workflow in Actions, which opens a pull request. The script runs the panel with the stand-in agent and made-up servers and people, so no real data ends up in a picture. `bun test` fails while a block has no picture or its labels have changed.

The website shows these with numbered pins and a key. The panel's own help shows **Show me** instead, since the real page is right there.

## Other docs blocks

- `:ui{anchor="backups.back-up-now"}` names a control. On the website it's a chip that looks like it; in the panel's help it's **Show me**. `:ui[other words]{anchor="…"}` changes the words.
- `:ui{anchor="backups.back-up-now" do}` also offers **Do it** in the panel's help, which presses the control for you so its own confirm and passkey check take over. Only controls marked `action: true` in `anchors.ts` can be pressed, and `bun test` fails for any other. Keep that list to safe things.
- `:value{of="server.address"}` shows a live value in the panel's help (the list is in `packages/docs-layer/values.ts`, and never holds anything secret). The website shows words instead, like "your server's address".
- `:shortcut{keys="meta+k"}` shows a keyboard shortcut.
