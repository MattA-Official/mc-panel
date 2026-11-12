# Docs screenshots

The pictures here are taken by a script, not by hand. Don't edit them.

A docs page asks for one with a block like this:

```markdown
::screenshot{name="backups" anchor="world.backups" labels="backups.back-up-now, backups.schedule"}
The Backups section of a server's World tab.
::
```

- `name`: the file name here (`backups-light.webp`, `backups-dark.webp`, `backups.json`).
- `anchor`: the page to picture, named by a control in `packages/docs-layer/anchors.ts`. A section's anchor pictures the whole section; anything else pictures the window.
- `labels`: controls to number on the picture, in order.
- `device="phone"`: a phone-sized picture.

To take or retake them, run `bun run docs:screens` (or `bun run docs:screens backups people` for some), or the **Docs screenshots** workflow in Actions, which opens a pull request. The script runs the panel with the stand-in agent and made-up servers and people, so no real data ends up in a picture. `bun test` fails while a block has no picture or its labels have changed.

The website shows these with numbered pins and a key. The panel's own help shows **Show me** instead, since the real page is right there.
