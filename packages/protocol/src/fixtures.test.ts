/**
 * Replays the shared fixtures in protocol/fixtures, which the Rust and Go implementations
 * replay too (docs/decisions/0001-rust-and-go.md).
 */
import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import { z } from 'zod'
import { Request, Response } from './envelope.ts'
import { protocolJsonSchema, protocolJsonSchemaText } from './json-schema.ts'
import { verbNames, verbs, type Verb } from './verbs.ts'

const root = join(import.meta.dir, '../../../protocol')

interface Line {
  verb?: Verb
  kind: 'request' | 'response' | 'params' | 'result'
  valid: boolean
  note?: string
  value: unknown
}

const read = async (name: string) =>
  (await Bun.file(join(root, 'fixtures', name)).text())
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Line)

const envelope = await read('envelope.jsonl')
const verbLines = await read('verbs.jsonl')
const label = (l: Line) =>
  `${l.verb ? l.verb + ' ' : ''}${l.kind} ${l.valid ? 'accepts' : 'refuses'} ${l.note ?? JSON.stringify(l.value)}`
const zodFor = (l: Line): z.ZodType =>
  l.kind === 'request'
    ? Request
    : l.kind === 'response'
      ? Response
      : verbs[l.verb!][l.kind as 'params' | 'result']
/** Lines whose rule JSON Schema can't express. */
const isRefinement = (l: Line) => l.note?.endsWith('(a refinement, not in schema.json)') ?? false

describe('fixtures against the Zod schemas', () => {
  it.each([...envelope, ...verbLines].map((l) => [label(l), l] as const))('%s', (_, l) => {
    expect(zodFor(l).safeParse(l.value).success).toBe(l.valid)
  })

  it('only name known verbs', () => {
    for (const l of verbLines) expect(verbNames).toContain(l.verb!)
  })

  it.each(verbNames.map((v) => [v]))('cover %s with a valid params and result line', (v) => {
    const mine = verbLines.filter((l) => l.verb === v && l.valid)
    expect(mine.some((l) => l.kind === 'params')).toBe(true)
    expect(mine.some((l) => l.kind === 'result')).toBe(true)
  })
})

describe('protocol/schema.json', () => {
  it('is up to date (run `bun scripts/protocol-schema.ts`)', async () => {
    expect(await Bun.file(join(root, 'schema.json')).text()).toBe(protocolJsonSchemaText())
  })

  // Reading the exported schema back proves it says the same as Zod, as far as JSON Schema can.
  const schema = protocolJsonSchema()
  const fromJson = (l: Line) =>
    z.fromJSONSchema(
      (l.kind === 'request' || l.kind === 'response'
        ? schema[l.kind]
        : schema.verbs[l.verb!]![l.kind as 'params' | 'result']) as Parameters<
        typeof z.fromJSONSchema
      >[0],
    )
  it.each(
    [...envelope, ...verbLines].filter((l) => !isRefinement(l)).map((l) => [label(l), l] as const),
  )('%s', (_, l) => {
    expect(fromJson(l).safeParse(l.value).success).toBe(l.valid)
  })
})
