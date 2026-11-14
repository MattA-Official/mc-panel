import type { Socket } from 'bun'
import { AgentError, Response } from './envelope.ts'
import { encode, lineSplitter } from './framing.ts'
import { verbs, type Params, type Result, type Verb } from './verbs.ts'

export interface CallOptions {
  socketPath: string
  /** Default 30 s. Long verbs (runtime.install) pass more. */
  timeoutMs?: number
}

/**
 * Calls one agent verb over a fresh connection. Params are validated before sending and the
 * result after receiving, so both sides enforce the same schema. Failures throw AgentError:
 * the agent's own code when it answered, `internal` when it could not be reached.
 */
export function callAgent<V extends Verb>(
  verb: V,
  params: Params<V>,
  { socketPath, timeoutMs = 30_000 }: CallOptions,
): Promise<Result<V>> {
  const spec = verbs[verb]
  const checked = spec.params.safeParse(params)
  if (!checked.success) {
    return Promise.reject(new AgentError('invalid_params', checked.error.issues[0]?.message ?? ''))
  }
  const id = crypto.randomUUID()

  return new Promise((resolve, reject) => {
    let settled = false
    let conn: Socket | undefined
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      conn?.end()
      fn()
    }
    const fail = (message: string) => finish(() => reject(new AgentError('internal', message)))
    const timer = setTimeout(() => fail(`agent did not answer ${verb} in time`), timeoutMs)

    const feed = lineSplitter(
      (line) => {
        const parsed = Response.safeParse(JSON.parse(line))
        if (!parsed.success || parsed.data.id !== id) return
        const res = parsed.data
        if (!res.ok) {
          finish(() => reject(new AgentError(res.error.code, res.error.message)))
          return
        }
        const result = spec.result.safeParse(res.result)
        if (!result.success) return fail('agent returned an unexpected result')
        finish(() => resolve(result.data as Result<V>))
      },
      () => fail('agent reply too long'),
    )

    Bun.connect({
      unix: socketPath,
      socket: {
        open(socket) {
          // Requests are a few hundred bytes, well under one socket write.
          socket.write(encode({ id, verb, params: checked.data }))
        },
        data(_socket, chunk) {
          feed(chunk)
        },
        close() {
          fail('agent closed the connection')
        },
        error(_socket, err) {
          fail(`agent unreachable: ${err.message}`)
        },
      },
    }).then(
      (socket) => {
        conn = socket
        if (settled) socket.end()
      },
      (err: Error) => fail(`agent unreachable: ${err.message}`),
    )
  })
}

export * from './subscribe.ts'
