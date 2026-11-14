# The agent protocol

How the panel talks to the agent, which runs as root. The Zod schemas in `packages/protocol` are the source of truth; [`schema.json`](schema.json) is generated from them (`bun scripts/protocol-schema.ts`) and [`fixtures/`](fixtures) holds messages every implementation must agree on. See [the decision record](../docs/decisions/0001-rust-and-go.md).

Messages are JSON objects, one per line, over the Unix socket at `/run/flytower/agent.sock`. Only root and the panel's user may connect.

## Protocol 1: requests

The panel sends `{id, verb, params}` and the agent answers `{id, ok: true, result}` or `{id, ok: false, error: {code, message}}`. Requests on one connection are answered in order. `verbs.ts` lists every verb; anything else is refused, so that list is the whole of the panel's root access.

## Protocol 2: subscriptions

For things that keep happening, such as a server's log or its state, the panel opens a subscription and the agent keeps sending until it's cancelled. Only the Rust agent speaks protocol 2. Ask `agent.hello` first: it says which agent is running (`rust` or `bun`), which protocols it speaks and which subscriptions it offers. An agent that answers `unknown_verb` speaks protocol 1 only.

| Panel sends                     | Agent sends                                                                                     |
| ------------------------------- | ----------------------------------------------------------------------------------------------- |
| `{id, subscribe: verb, params}` | `{id, ok: true, result}`, or an error as for a request, then                                    |
|                                 | `{id, event}` for each event,                                                                   |
|                                 | `{id, skipped: n}` if it dropped `n` events because the panel fell behind,                      |
|                                 | `{id, end: true, reason, message?}` last, where `reason` is `finished`, `cancelled` or `failed` |
| `{id, cancel: true}`            | the end frame, with reason `cancelled`                                                          |
|                                 | `{ping: true}` after 30 s without sending anything, while subscriptions are live                |

- `subscriptions` in `verbs.ts` lists every subscription, with the schemas of its params, its answer and its events.
- Several subscriptions can share one connection, up to 64. Requests can be sent on it too, but they're answered in order, so a long request delays reading a cancel.
- Each subscription queues at most 1024 events. When the panel reads too slowly, the agent counts what it drops and sends `skipped` rather than using more memory.
- A connection with live subscriptions is never closed for being idle; one without is closed after 10 minutes, as before.
- Ids belong to a connection. An id can be reused once its end frame has been sent.

`AgentStreams` and `subscribeAgent` in `@flytower/protocol/client` do this for the panel: one connection shared by every subscription, and after the agent restarts (an update, say) they reconnect with backoff and subscribe again, calling `onStart(result, true)` so callers can catch up on what they missed.

`testing.ticks` exists only in test builds (`cargo build --features testing`, binary `flytower-agent-testing`), so the client can be tested against the real agent. Release builds answer it with `unknown_verb`.
