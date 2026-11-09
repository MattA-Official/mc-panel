import { AgentError } from '@kiln/protocol'
import type { Handlers } from '../dispatch.ts'
import { protocolInfo } from '../dispatch.ts'
import * as runtime from './runtime.ts'
import * as service from './service.ts'

const notYet = (verb: string) => async () => {
  throw new AgentError('failed', `${verb} is not implemented yet`)
}

export const handlers: Handlers = {
  ping: async (_p, ctx) => protocolInfo(ctx.version),
  'service.status': service.status,
  'service.start': service.start,
  'service.stop': service.stop,
  'service.restart': service.restart,
  'runtime.install': runtime.install,
  'server.create': notYet('server.create'),
  'server.delete': notYet('server.delete'),
}
