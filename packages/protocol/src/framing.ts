import { MAX_LINE_BYTES } from './envelope.ts'

/** Encode one message as a newline-terminated JSON line. */
export const encode = (message: unknown) => JSON.stringify(message) + '\n'

/**
 * Splits a byte stream into JSON lines. Calls `onLine` per complete line and `onOverflow`
 * if a line grows past `maxBytes` (the caller should drop the connection).
 */
export function lineSplitter(
  onLine: (line: string) => void,
  onOverflow: () => void,
  maxBytes = MAX_LINE_BYTES,
) {
  let buffer = ''
  // Streaming decode, so a multi-byte character split across chunks survives.
  const decoder = new TextDecoder()
  return (chunk: Uint8Array | string) => {
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true })
    let nl: number
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl)
      buffer = buffer.slice(nl + 1)
      if (line.trim()) onLine(line)
    }
    if (Buffer.byteLength(buffer) > maxBytes) {
      buffer = ''
      onOverflow()
    }
  }
}
