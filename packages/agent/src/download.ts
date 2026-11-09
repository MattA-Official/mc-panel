import type { Fetch } from './context.ts'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { AgentError } from '@flytower/protocol'

const USER_AGENT = 'flytower-agent (+https://github.com/MattA-Official)'

export async function getJson<T>(fetchImpl: Fetch, url: string): Promise<T> {
  const res = await fetchImpl(url, {
    headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
  })
  if (!res.ok) throw new AgentError('failed', `GET ${url} returned ${res.status}`)
  return (await res.json()) as T
}

/** Streams a URL to disk while hashing it; deletes the file if the SHA-256 does not match. */
export async function downloadVerified(
  fetchImpl: Fetch,
  url: string,
  dest: string,
  sha256: string,
): Promise<void> {
  if (!/^[a-f0-9]{64}$/i.test(sha256))
    throw new AgentError('failed', 'upstream gave no usable checksum')
  const res = await fetchImpl(url, { headers: { 'user-agent': USER_AGENT } })
  if (!res.ok || !res.body)
    throw new AgentError('failed', `download of ${url} returned ${res.status}`)
  const hash = createHash('sha256')
  const body = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream)
  body.on('data', (chunk: Buffer) => hash.update(chunk))
  await pipeline(body, createWriteStream(dest, { mode: 0o600 }))
  const got = hash.digest('hex')
  if (got.toLowerCase() !== sha256.toLowerCase()) {
    await rm(dest, { force: true })
    throw new AgentError('failed', `checksum mismatch for ${url}`)
  }
}
