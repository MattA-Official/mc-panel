import { z } from 'zod'
import { ServerSpec } from '../../../shared/spec'

let cached: string | null = null

/** The spec's JSON Schema, public so editors can fetch it. */
export default defineEventHandler((event) => {
  cached ??= JSON.stringify(
    {
      ...z.toJSONSchema(ServerSpec, { io: 'input', unrepresentable: 'any' }),
      title: 'Flytower server spec',
    },
    null,
    2,
  )
  setResponseHeaders(event, {
    'content-type': 'application/schema+json',
    'cache-control': 'public, max-age=3600',
    'access-control-allow-origin': '*',
  })
  return cached
})
