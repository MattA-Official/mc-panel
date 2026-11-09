import { LOADER_IDS } from '@flytower/providers'
import { z } from 'zod'

const Params = z.object({ id: z.enum(LOADER_IDS) })
const Query = z.object({ snapshots: z.stringbool().default(false) })

/** Minecraft versions a loader supports, newest first. */
export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, Params.parse)
  const { snapshots } = await getValidatedQuery(event, Query.parse)
  return providerCall(() => useLoaders()[id].minecraftVersions({ includeSnapshots: snapshots }))
})
