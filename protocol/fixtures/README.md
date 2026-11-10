# Protocol fixtures

Messages that every implementation of the agent protocol must agree on, whatever language it's written in. See [the decision record](../../docs/decisions/0001-rust-and-go.md).

There's one JSON object per line:

- `envelope.jsonl` has `kind` set to `request` or `response`, and checks the envelope only.
- `verbs.jsonl` adds a `verb`, and `kind` is `params` or `result`. It checks that verb's params or result.
- `valid` says whether an implementation must accept `value` (`true`) or refuse it (`false`).
- `note` says why a line is there, which matters most for the refused ones.

Some rules are Zod refinements that JSON Schema can't express. A note ending in "(a refinement, not in schema.json)" marks those lines, so other languages have to check them in code.

The TypeScript tests (`packages/protocol/src/fixtures.test.ts`) replay every line against the Zod schemas. They also check that each verb has at least one valid params line and one valid result line. When you add or change a verb, add lines here in the same commit.
