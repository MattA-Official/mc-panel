export interface ExecResult {
  code: number
  stdout: string
  stderr: string
}

/** Runs a program with an argument list. Never goes through a shell. */
export type Exec = (file: string, args: readonly string[]) => Promise<ExecResult>

export const realExec: Exec = async (file, args) => {
  try {
    const proc = Bun.spawn([file, ...args], {
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 120_000,
    })
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    return { code, stdout, stderr }
  } catch (err) {
    // Bun.spawn throws when the program does not exist.
    return { code: 127, stdout: '', stderr: err instanceof Error ? err.message : String(err) }
  }
}
