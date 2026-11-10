import { z } from 'zod'
import { MANAGED_KEYS, withoutSecrets } from '../../../properties'

const Params = z.object({ name: z.string().max(40) })

export default defineEventHandler(async (event) => {
  const { name } = await getValidatedRouterParams(event, Params.parse)
  findServer(name)
  // Secrets (the RCON password, the management server's secret) never go to the browser.
  const values = withoutSecrets(await readProperties(name))
  return { values, managed: [...MANAGED_KEYS] }
})
