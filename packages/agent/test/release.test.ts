import { generateKeyPairSync, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import { RELEASE_KEY, sumFor, verifySums } from '../src/release'

const pair = () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  return { pub: publicKey.export({ type: 'spki', format: 'pem' }).toString(), privateKey }
}

describe('release signatures', () => {
  const sums = 'a'.repeat(64) + '  flytower-0.5.0-linux-amd64.tar.gz\n'

  it('accepts a good signature and refuses changes or another key', () => {
    const { pub, privateKey } = pair()
    const sig = sign(null, Buffer.from(sums), privateKey).toString('base64')
    expect(verifySums(sums, sig, pub)).toBe(true)
    expect(verifySums(sums.replace('a', 'b'), sig, pub)).toBe(false)
    expect(verifySums(sums, sig, pair().pub)).toBe(false)
    expect(verifySums(sums, 'not base64!', pub)).toBe(false)
  })

  it('reads a file hash out of SHA256SUMS', () => {
    expect(sumFor(sums, 'flytower-0.5.0-linux-amd64.tar.gz')).toBe('a'.repeat(64))
    expect(sumFor(sums, 'other.tar.gz')).toBeNull()
  })

  it('uses the same key as the installer', () => {
    const installer = readFileSync(join(import.meta.dir, '../../../installer/install.sh'), 'utf8')
    const embedded = /RELEASE_KEY="\$\(cat <<'KEY'\n([\s\S]*?)\nKEY\n\)"/.exec(installer)?.[1]
    expect(embedded?.trim()).toBe(RELEASE_KEY.trim())
  })
})
