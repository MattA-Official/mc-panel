import { MAX_LINE_BYTES } from './envelope.ts'

/** Encode one message as a newline-terminated JSON line. */
export const encode = (message: unknown) => JSON.stringify(message) + '\n'

/**
 * Splits a byte stream into JSON lines. Calls `onLine` per complete line and `onOverflow`
 * if a line grows past MAX_LINE_BYTES (the caller should drop the connection).
 */
export function lineSplitter(onLine: (line: string) => void, onOverflow: () => void) {
  let buffer = ''
  return (chunk: Buffer | string) => {
    buffer += chunk.toString('utf8')
    let nl: number
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl)
      buffer = buffer.slice(nl + 1)
      if (line.trim()) onLine(line)
    }
    if (Buffer.byteLength(buffer) > MAX_LINE_BYTES) {
      buffer = ''
      onOverflow()
    }
  }
}
