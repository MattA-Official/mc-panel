import { rm } from 'node:fs/promises'
import { USER_AGENT } from './http.ts'
import { ProviderError, type ExpectedHash, type Fetch } from './types.ts'

/**
 * Streams a file to disk, checking the source's hash when it publishes one, and always
 * returns the SHA-256 so the lockfile can pin what was actually installed.
 */
export async function downloadVerified(
  fetchImpl: Fetch,
  url: string,
  dest: string,
  expected: ExpectedHash | null,
): Promise<{ sha256: string; bytes: number }> {
  let res: Response
  try {
    res = await fetchImpl(url, {
      headers: { 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(10 * 60_000),
    })
  } catch {
    throw new ProviderError(`Couldn't download ${url}. Check the server's internet connection.`)
  }
  if (!res.ok || !res.body) throw new ProviderError(`Download of ${url} failed (${res.status}).`)

  const sha256 = new Bun.CryptoHasher('sha256')
  const check = expected ? new Bun.CryptoHasher(expected.algorithm) : null
  const writer = Bun.file(dest).writer()
  let bytes = 0
  try {
    for await (const chunk of res.body) {
      sha256.update(chunk)
      check?.update(chunk)
      writer.write(chunk)
      bytes += chunk.byteLength
    }
  } finally {
    await writer.end()
  }
  if (expected && check!.digest('hex') !== expected.value.toLowerCase()) {
    await rm(dest, { force: true })
    throw new ProviderError(`The file from ${url} didn't match its published checksum.`)
  }
  return { sha256: sha256.digest('hex'), bytes }
}
