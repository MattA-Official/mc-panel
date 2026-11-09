import { z } from 'zod'

const Params = z.object({ id: z.coerce.number().int() })

/** Retries a failed off-site upload now. */
export default defineEventHandler(async (event) => {
  const { name, service } = await backupContext(event)
  const { id } = await getValidatedRouterParams(event, Params.parse)
  backupHttp(() => service.get(name, id))
  useOffsite().retry(id)
  return { ok: true }
})
