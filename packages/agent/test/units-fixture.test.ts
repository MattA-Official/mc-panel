import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import { envFile, templateUnit } from '../src/units.ts'
import type { AgentContext } from '../src/context.ts'

// The Rust agent (crates/flytower-agent/src/units.rs) checks the same files. Both agents
// rewrite the template when it differs, so the two must agree byte for byte.
const fixtures = join(import.meta.dir, '../../../protocol/fixtures')
const read = (name: string) => readFileSync(join(fixtures, name), 'utf8')

describe('unit fixtures', () => {
  it('match the template and env file', () => {
    const ctx = {
      panelGroup: 'flytower',
      paths: { servers: '/srv/flytower/servers', config: '/etc/flytower' },
    } as AgentContext
    expect(templateUnit(ctx)).toBe(read('server-unit.service'))
    expect(envFile('/opt/flytower/runtimes/temurin-25', 6144)).toBe(read('server.env'))
  })
})
