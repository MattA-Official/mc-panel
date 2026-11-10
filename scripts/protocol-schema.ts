/**
 * Writes the agent protocol as JSON Schema to protocol/schema.json, for the Rust and Go
 * implementations (docs/decisions/0001-rust-and-go.md).
 *
 *   bun scripts/protocol-schema.ts          # write it
 *   bun scripts/protocol-schema.ts --check  # fail if the committed file is out of date
 */
import { join, resolve } from 'node:path'
import { protocolJsonSchemaText } from '../packages/protocol/src/json-schema.ts'

const file = join(resolve(import.meta.dir, '..'), 'protocol/schema.json')
const wanted = protocolJsonSchemaText()

if (process.argv.includes('--check')) {
  const current = await Bun.file(file)
    .text()
    .catch(() => '')
  if (current !== wanted) {
    console.error('protocol/schema.json is out of date; run `bun scripts/protocol-schema.ts`')
    process.exit(1)
  }
  console.log('protocol/schema.json is up to date')
} else {
  await Bun.write(file, wanted)
  console.log(`wrote ${file}`)
}
