import type { Fetch } from '../src/context.ts'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'bun:test'
import { dispatch, handlers } from '../src/index.ts'
import { realExec } from '../src/exec.ts'
import { fakeContext } from './fakes.ts'

let root: string
let tarball: Buffer
let sha: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'flytower-rt-'))
  const src = join(root, 'src', 'jdk-25.0.1+8-jre', 'bin')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, 'java'), '#!/bin/sh\n', { mode: 0o755 })
  execFileSync('tar', [
    '-czf',
    join(root, 'jre.tar.gz'),
    '-C',
    join(root, 'src'),
    'jdk-25.0.1+8-jre',
  ])
  tarball = readFileSync(join(root, 'jre.tar.gz'))
  sha = createHash('sha256').update(tarball).digest('hex')
})

function adoptium(checksum: () => string, seen: string[] = []): Fetch {
  return async (input) => {
    const url = String(input)
    seen.push(url)
    if (url.startsWith('https://api.adoptium.net/')) {
      return Response.json([
        {
          binary: {
            package: {
              link: 'https://dl.example/jre.tar.gz',
              checksum: checksum(),
              name: 'jre.tar.gz',
            },
          },
          version: { semver: '25.0.1+8' },
        },
      ])
    }
    if (url === 'https://dl.example/jre.tar.gz') return new Response(new Uint8Array(tarball))
    return new Response('no', { status: 404 })
  }
}

const install = JSON.stringify({
  id: 'i',
  verb: 'runtime.install',
  params: { vendor: 'temurin', major: 25 },
})

describe('runtime.install', () => {
  it('downloads, verifies and unpacks Temurin, then is idempotent', async () => {
    const seen: string[] = []
    const runtimes = join(root, 'runtimes')
    const { ctx } = fakeContext(
      realExec,
      adoptium(() => sha, seen),
      { servers: '', runtimes, archive: '', config: '', systemd: '', state: '' },
    )
    const first = await dispatch(install, handlers, ctx)
    expect(first).toEqual({
      id: 'i',
      ok: true,
      result: {
        javaHome: join(runtimes, 'temurin-25'),
        version: '25.0.1+8',
        alreadyInstalled: false,
      },
    })
    expect(existsSync(join(runtimes, 'temurin-25', 'bin', 'java'))).toBe(true)
    expect(seen[0]).toContain('/25/hotspot?architecture=x64&image_type=jre&os=linux&vendor=eclipse')

    const second = await dispatch(install, handlers, ctx)
    expect(second).toMatchObject({ ok: true, result: { alreadyInstalled: true } })
  })

  it('refuses a download whose checksum does not match and leaves nothing behind', async () => {
    const runtimes = join(root, 'runtimes')
    const { ctx } = fakeContext(
      realExec,
      adoptium(() => 'a'.repeat(64)),
      { servers: '', runtimes, archive: '', config: '', systemd: '', state: '' },
    )
    const res = await dispatch(install, handlers, ctx)
    expect(res).toMatchObject({ ok: false, error: { code: 'failed' } })
    expect(existsSync(join(runtimes, 'temurin-25'))).toBe(false)
  })
})
