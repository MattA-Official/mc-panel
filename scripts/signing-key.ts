/**
 * Turns FLYTOWER_SIGNING_KEY into a PKCS#8 PEM that openssl can read, whatever shape it was
 * pasted in: a normal PEM, one with its newlines flattened to spaces or written as "\n", the
 * PEM base64-encoded again, or an unencrypted OpenSSH key from `ssh-keygen -t ed25519`.
 * Writes the PEM to the path given; prints only a description of the shape, never the key.
 */
const out = process.argv[2]
if (!out) throw new Error('usage: bun scripts/signing-key.ts <out.pem>')
let text = (process.env.FLYTOWER_SIGNING_KEY ?? '').trim().replace(/\\n/g, '\n')

const fail = (why: string): never => {
  console.log(`::error::FLYTOWER_SIGNING_KEY ${why}`)
  process.exit(1)
}
if (!text) fail('is empty.')

// The whole PEM base64-encoded once more.
if (!text.includes('-----BEGIN')) {
  const decoded = Buffer.from(text.replace(/\s+/g, ''), 'base64').toString('utf8')
  if (decoded.includes('-----BEGIN')) text = decoded.trim()
}

const m = text.match(/-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/)
if (!m) fail('has no -----BEGIN ...----- line. Paste the whole private key file.')
const label = m![1]!
const der = Buffer.from(m![2]!.replace(/\s+/g, ''), 'base64')

const pem = (body: Buffer) =>
  `-----BEGIN PRIVATE KEY-----\n${body
    .toString('base64')
    .match(/.{1,64}/g)!
    .join('\n')}\n-----END PRIVATE KEY-----\n`

// PKCS#8 for Ed25519 is this 16-byte prefix and the 32-byte seed.
const PKCS8_ED25519 = Buffer.from('302e020100300506032b657004220420', 'hex')

let body: Buffer
if (label === 'PRIVATE KEY') {
  body = der
  console.log('Signing key: PKCS#8 PEM')
} else if (label === 'OPENSSH PRIVATE KEY') {
  // https://github.com/openssh/openssh-portable/blob/master/PROTOCOL.key
  let at = 0
  const magic = 'openssh-key-v1\0'
  if (der.subarray(0, magic.length).toString('latin1') !== magic)
    fail("is an OpenSSH key in a format this script doesn't know.")
  at = magic.length
  const str = () => {
    const n = der.readUInt32BE(at)
    const s = der.subarray(at + 4, at + 4 + n)
    at += 4 + n
    return s
  }
  const cipher = str().toString()
  if (cipher !== 'none')
    fail(
      'is a passphrase-protected OpenSSH key. Remove the passphrase (ssh-keygen -p -f <file>) and save it again.',
    )
  str() // kdf name
  str() // kdf options
  at += 4 // number of keys
  str() // public key
  const priv = str()
  at = 0
  const d = priv
  const rd = () => {
    const n = d.readUInt32BE(at)
    const s = d.subarray(at + 4, at + 4 + n)
    at += 4 + n
    return s
  }
  at = 8 // two check ints
  const type = rd().toString()
  if (type !== 'ssh-ed25519')
    fail(`is an OpenSSH ${type} key; Flytower releases need an Ed25519 key.`)
  rd() // public
  const secret = rd() // seed (32) + public (32)
  body = Buffer.concat([PKCS8_ED25519, secret.subarray(0, 32)])
  console.log('Signing key: OpenSSH Ed25519, converted')
} else {
  fail(`is a "${label}", not an Ed25519 private key.`)
}
await Bun.write(out, pem(body!), { mode: 0o600 })
