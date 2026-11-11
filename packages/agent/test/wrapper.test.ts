import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'

/**
 * A release whose `bun` and Rust programs just say which they are, with one wrapper. The fake
 * Rust agent deletes the start marker, as the real one does once it's listening, unless
 * `rustFails` is set.
 */
function release(wrapper: 'flytower-agent' | 'flytower-updater', withRust = true) {
  const root = mkdtempSync(join(tmpdir(), 'ft-wrap-'))
  const bin = join(root, 'release', 'bin')
  const runDir = join(root, 'run')
  const marker = join(runDir, 'agent-rust-starting')
  mkdirSync(bin, { recursive: true })
  mkdirSync(join(root, 'etc'))
  const script = (name: string, body: string) => {
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`)
    chmodSync(join(bin, name), 0o755)
  }
  script('bun', 'echo "bun $*"')
  if (withRust)
    script(`${wrapper}-rust`, `echo "rust $*"\n[ -n "$RUST_FAILS" ] && exit 1\nrm -f "${marker}"`)
  copyFileSync(join(import.meta.dir, '..', 'bin', wrapper), join(bin, wrapper))
  chmodSync(join(bin, wrapper), 0o755)
  const run = (rustFails = false) => {
    const r = Bun.spawnSync([join(bin, wrapper), '--x'], {
      env: {
        PATH: process.env.PATH,
        FLYTOWER_CONFIG_DIR: join(root, 'etc'),
        FLYTOWER_AGENT_SOCKET: join(runDir, 'agent.sock'),
        ...(rustFails ? { RUST_FAILS: '1' } : {}),
      },
    })
    return r.stdout.toString().trim()
  }
  const choose = (text: string | null) =>
    text === null
      ? rmSync(join(root, 'etc', 'agent'), { force: true })
      : writeFileSync(join(root, 'etc', 'agent'), text)
  return { run, choose, bin, marker }
}

for (const [wrapper, script] of [
  ['flytower-agent', 'agent.js'],
  ['flytower-updater', 'updater.js'],
] as const) {
  describe(`the ${wrapper} wrapper`, () => {
    it('starts the Rust version unless Bun is chosen', () => {
      const { run, choose, bin } = release(wrapper)
      expect(run()).toBe('rust --x')
      choose('rust\n')
      expect(run()).toBe('rust --x')
      choose('bun\n')
      expect(run()).toBe(`bun ${bin}/../agent/${script} --x`)
      choose(null)
      expect(run()).toBe('rust --x')
    })

    it('falls back to Bun when the release has no Rust version', () => {
      const { run, choose } = release(wrapper, false)
      expect(run()).toStartWith('bun ')
      choose('rust')
      expect(run()).toStartWith('bun ')
    })
  })
}

describe('the flytower-agent wrapper, when the Rust agent fails to start', () => {
  it('leaves a marker naming the release, which a good start clears', () => {
    const { run, marker, bin } = release('flytower-agent')
    expect(run(true)).toBe('rust --x')
    expect(readFileSync(marker, 'utf8').trim()).toBe(bin)
    expect(run()).toStartWith('bun ')
    // Bun leaves it, so the updater knows too.
    expect(existsSync(marker)).toBe(true)
    rmSync(marker)
    expect(run()).toBe('rust --x')
    expect(existsSync(marker)).toBe(false)
  })

  it('tries Rust again in a new release', () => {
    const { run, marker } = release('flytower-agent')
    mkdirSync(join(marker, '..'), { recursive: true })
    writeFileSync(marker, '/opt/flytower/releases/older/bin\n')
    expect(run()).toBe('rust --x')
  })

  it('stays on Bun when Bun is chosen, marker or not', () => {
    const { run, choose, marker } = release('flytower-agent')
    choose('bun')
    expect(run()).toStartWith('bun ')
    expect(existsSync(marker)).toBe(false)
  })
})

describe('the flytower-updater wrapper', () => {
  it('uses Bun while the Rust agent has fallen back on this box', () => {
    const { run, marker } = release('flytower-updater')
    mkdirSync(join(marker, '..'), { recursive: true })
    writeFileSync(marker, '/opt/flytower/releases/any/bin\n')
    expect(run()).toStartWith('bun ')
    rmSync(marker)
    expect(run()).toBe('rust --x')
  })
})
