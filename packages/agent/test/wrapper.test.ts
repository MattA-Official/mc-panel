import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'

const WRAPPER = join(import.meta.dir, '..', 'bin', 'flytower-agent')

/** A release whose `bun` and Rust agent just say which they are. */
function release(withRust = true) {
  const root = mkdtempSync(join(tmpdir(), 'ft-wrap-'))
  const bin = join(root, 'release', 'bin')
  mkdirSync(bin, { recursive: true })
  mkdirSync(join(root, 'etc'))
  const script = (name: string, text: string) => {
    writeFileSync(join(bin, name), `#!/bin/sh\necho "${text} $*"\n`)
    chmodSync(join(bin, name), 0o755)
  }
  script('bun', 'bun')
  if (withRust) script('flytower-agent-rust', 'rust')
  copyFileSync(WRAPPER, join(bin, 'flytower-agent'))
  chmodSync(join(bin, 'flytower-agent'), 0o755)
  const run = () => {
    const r = Bun.spawnSync([join(bin, 'flytower-agent'), '--x'], {
      env: { PATH: process.env.PATH, FLYTOWER_CONFIG_DIR: join(root, 'etc') },
    })
    return r.stdout.toString().trim()
  }
  const choose = (text: string | null) =>
    text === null
      ? rmSync(join(root, 'etc', 'agent'), { force: true })
      : writeFileSync(join(root, 'etc', 'agent'), text)
  return { run, choose, bin }
}

describe('the flytower-agent wrapper', () => {
  it('starts the Bun agent unless the Rust one is switched on', () => {
    const { run, choose, bin } = release()
    expect(run()).toBe(`bun ${bin}/../agent/agent.js --x`)
    choose('rust\n')
    expect(run()).toBe('rust --x')
    choose('bun\n')
    expect(run()).toStartWith('bun ')
    choose(null)
    expect(run()).toStartWith('bun ')
  })

  it('falls back to Bun when the release has no Rust agent', () => {
    const { run, choose } = release(false)
    choose('rust')
    expect(run()).toStartWith('bun ')
  })
})
