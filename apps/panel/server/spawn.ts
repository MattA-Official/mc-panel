/** How much of a command's error output is kept for its message. */
const KEEP_STDERR = 16 * 1024

/**
 * Runs a command and waits for it, reading its error output while it runs. Waiting first and
 * reading after would hang once the output fills the pipe: the command blocks on writing it
 * and never exits. Only the end of the output is kept.
 */
export async function run(cmd: string[]): Promise<{ code: number; stderr: string }> {
  const proc = Bun.spawn(cmd, { stdout: 'ignore', stderr: 'pipe' })
  const [stderr, code] = await Promise.all([tail(proc.stderr), proc.exited])
  return { code, stderr: stderr.trim() }
}

async function tail(stream: ReadableStream<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder()
  let kept = ''
  for await (const chunk of stream) {
    kept += decoder.decode(chunk, { stream: true })
    if (kept.length > KEEP_STDERR * 2) kept = kept.slice(-KEEP_STDERR)
  }
  kept += decoder.decode()
  return kept.length > KEEP_STDERR ? kept.slice(-KEEP_STDERR) : kept
}
