import { randomUUID } from 'node:crypto'
import { createConnection } from 'node:net'
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
  const id = randomUUID()

  return new Promise((resolve, reject) => {
    let settled = false
    const conn = createConnection(socketPath)
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      conn.destroy()
      fn()
    }
    const timer = setTimeout(
      () =>
        finish(() => reject(new AgentError('internal', `agent did not answer ${verb} in time`))),
      timeoutMs,
    )

    conn.on('error', (err) =>
      finish(() => reject(new AgentError('internal', `agent unreachable: ${err.message}`))),
    )
    conn.on('close', () =>
      finish(() => reject(new AgentError('internal', 'agent closed the connection'))),
    )
    conn.on(
      'data',
      lineSplitter(
        (line) => {
          const parsed = Response.safeParse(JSON.parse(line))
          if (!parsed.success || parsed.data.id !== id) return
          const res = parsed.data
          if (!res.ok) {
            finish(() => reject(new AgentError(res.error.code, res.error.message)))
            return
          }
          const result = spec.result.safeParse(res.result)
          finish(() =>
            result.success
              ? resolve(result.data as Result<V>)
              : reject(new AgentError('internal', 'agent returned an unexpected result')),
          )
        },
        () => finish(() => reject(new AgentError('internal', 'agent reply too long'))),
      ),
    )
    conn.on('connect', () => conn.write(encode({ id, verb, params: checked.data })))
  })
}
