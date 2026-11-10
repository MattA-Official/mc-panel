# Release summaries

Write `<version>.md` here (for example `1.1.0.md`) before releasing that version. The
release workflow puts it at the top of the release notes, above the list of changes
generated from commits.

Keep every summary the same shape, so releases read alike:

- One to three short paragraphs for the people running Flytower: what's new and what to
  do after updating. No headings or bullet lists, since the generated list below already
  has its own **Features**, **Fixes** and other sections.
- A last line pointing to the testing notes, for example
  `Testing notes are in section 2 of [testing-1.1.0.md](…/blob/v1.1.0-beta.4/docs/testing-1.1.0.md).`

The panel shows release notes with a small Markdown reader, so stick to paragraphs,
**bold**, `code` and links.

The generated list comes from Conventional Commit messages, so merge pull requests with a
merge commit and give each commit a `feat:`, `fix:` (and so on) message. A squash merge that
lists its commits as `* feat: …` lines is split back into them.

To rewrite the notes of a release that's already out, run the **Release notes** workflow
from the Actions tab with its tag.

To release an older commit, such as a stable version while `main` already holds the next
one's work, run the **Release** workflow from `main` and give it a `ref` (a tag, branch or
commit, for example `v1.1.0-beta.6`). The summary still comes from `main`. A stable release's
generated list covers everything since the last stable release, betas included.
