import { z } from 'zod'
import { MANAGED_KEYS } from '../../../properties'

const Params = z.object({ name: z.string().max(40) })

export default defineEventHandler(async (event) => {
  const { name } = await getValidatedRouterParams(event, Params.parse)
  findServer(name)
  const values = await readProperties(name)
  // The RCON password is Flytower's own credential; it never goes to the browser.
  delete values['rcon.password']
  return { values, managed: [...MANAGED_KEYS] }
})
