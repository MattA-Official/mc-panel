import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'

/** A release whose `bun` and Rust programs just say which they are, with one wrapper. */
function release(wrapper: 'flytower-agent' | 'flytower-updater', withRust = true) {
  const root = mkdtempSync(join(tmpdir(), 'ft-wrap-'))
  const bin = join(root, 'release', 'bin')
  mkdirSync(bin, { recursive: true })
  mkdirSync(join(root, 'etc'))
  const script = (name: string, text: string) => {
    writeFileSync(join(bin, name), `#!/bin/sh\necho "${text} $*"\n`)
    chmodSync(join(bin, name), 0o755)
  }
  script('bun', 'bun')
  if (withRust) script(`${wrapper}-rust`, 'rust')
  copyFileSync(join(import.meta.dir, '..', 'bin', wrapper), join(bin, wrapper))
  chmodSync(join(bin, wrapper), 0o755)
  const run = () => {
    const r = Bun.spawnSync([join(bin, wrapper), '--x'], {
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

for (const [wrapper, script] of [
  ['flytower-agent', 'agent.js'],
  ['flytower-updater', 'updater.js'],
] as const) {
  describe(`the ${wrapper} wrapper`, () => {
    it('starts the Bun version unless the Rust one is switched on', () => {
      const { run, choose, bin } = release(wrapper)
      expect(run()).toBe(`bun ${bin}/../agent/${script} --x`)
      choose('rust\n')
      expect(run()).toBe('rust --x')
      choose('bun\n')
      expect(run()).toStartWith('bun ')
      choose(null)
      expect(run()).toStartWith('bun ')
    })

    it('falls back to Bun when the release has no Rust version', () => {
      const { run, choose } = release(wrapper, false)
      choose('rust')
      expect(run()).toStartWith('bun ')
    })
  })
}
