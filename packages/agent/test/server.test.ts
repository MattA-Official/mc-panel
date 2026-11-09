import { mkdtempSync, statSync } from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'bun:test'
import { encode, lineSplitter } from '@flytower/protocol'
import { handlers } from '../src/index.ts'
import { listen } from '../src/server.ts'
import { fakeContext, fakeExec } from './fakes.ts'

let close: (() => void) | undefined
afterEach(() => close?.())

function roundTrip(socketPath: string, lines: string[]) {
  return new Promise<unknown[]>((resolve, reject) => {
    const out: unknown[] = []
    const c = connect(socketPath)
    c.on('error', reject)
    c.on(
      'data',
      lineSplitter(
        (l) => {
          out.push(JSON.parse(l))
          if (out.length === lines.length) {
            c.end()
            resolve(out)
          }
        },
        () => reject(new Error('overflow')),
      ),
    )
    c.write(lines.join(''))
  })
}

describe('socket server', () => {
  it('answers pipelined requests in order and sets mode 0660', async () => {
    const socketPath = join(mkdtempSync(join(tmpdir(), 'flytower-')), 'agent.sock')
    const { ctx } = fakeContext(fakeExec().exec)
    const server = await listen({ socketPath, group: null }, handlers, ctx)
    close = () => server.close()
    expect(statSync(socketPath).mode & 0o777).toBe(0o660)
    const res = await roundTrip(socketPath, [
      encode({ id: '1', verb: 'ping', params: {} }),
      encode({ id: '2', verb: 'nope', params: {} }),
      encode({ id: '3', verb: 'ping', params: {} }),
    ])
    expect(res.map((r) => (r as { id: string }).id)).toEqual(['1', '2', '3'])
  })
})
