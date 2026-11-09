import { execFile } from 'node:child_process'

export interface ExecResult {
  code: number
  stdout: string
  stderr: string
}

/** Runs a program with an argument list. Never goes through a shell. */
export type Exec = (file: string, args: readonly string[]) => Promise<ExecResult>

export const realExec: Exec = (file, args) =>
  new Promise((resolve) => {
    execFile(
      file,
      args,
      { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0
        resolve({ code, stdout: String(stdout), stderr: String(stderr) })
      },
    )
  })
