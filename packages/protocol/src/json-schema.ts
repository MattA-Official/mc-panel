/**
 * The protocol as JSON Schema, for agents and helpers that aren't written in TypeScript
 * (see docs/decisions/0001-rust-and-go.md). Zod stays the source of truth;
 * `bun scripts/protocol-schema.ts` writes this to protocol/schema.json.
 *
 * JSON Schema can't express Zod refinements (such as "a server name must not end with a
 * hyphen", or "server.configure needs something to change"), so those are left out here and
 * covered by the shared fixtures in protocol/fixtures instead.
 */
import { z } from 'zod'
import { ErrorCode, MAX_LINE_BYTES, PROTOCOL_VERSION, Request, Response } from './envelope.ts'
import { verbNames, verbs } from './verbs.ts'

const toSchema = (schema: z.ZodType) => {
  const json = z.toJSONSchema(schema, { unrepresentable: 'any' }) as Record<string, unknown>
  delete json.$schema
  return json
}

export function protocolJsonSchema() {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $comment:
      'Generated from packages/protocol by `bun scripts/protocol-schema.ts`. Do not edit by hand.',
    protocolVersion: PROTOCOL_VERSION,
    maxLineBytes: MAX_LINE_BYTES,
    errorCodes: ErrorCode.options,
    request: toSchema(Request),
    response: toSchema(Response),
    verbs: Object.fromEntries(
      [...verbNames]
        .sort()
        .map((v) => [v, { params: toSchema(verbs[v].params), result: toSchema(verbs[v].result) }]),
    ),
  }
}

/** The file contents: stable key order and a trailing newline, so diffs stay small. */
export const protocolJsonSchemaText = () => JSON.stringify(protocolJsonSchema(), null, 2) + '\n'
