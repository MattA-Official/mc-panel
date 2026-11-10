import type { Handlers } from '../dispatch.ts'
import { protocolInfo } from '../dispatch.ts'
import * as runtime from './runtime.ts'
import * as server from './server.ts'
import * as service from './service.ts'
import * as ssh from './ssh.ts'
import * as update from './update.ts'

export const handlers: Handlers = {
  ping: async (_p, ctx) => protocolInfo(ctx.version),
  'service.status': service.status,
  'service.usage': service.usage,
  'service.wait': service.wait,
  'service.start': service.start,
  'service.stop': service.stop,
  'service.restart': service.restart,
  'runtime.install': runtime.install,
  'server.create': server.create,
  'server.configure': server.configure,
  'server.permissions': server.permissions,
  'server.delete': server.remove,
  'ssh.status': ssh.status,
  'ssh.set': ssh.set,
  'update.status': update.status,
  'update.install': update.install,
  'update.rollback': update.rollback,
}
