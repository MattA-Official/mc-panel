import { LOADER_IDS } from '@flytower/providers'
import { z } from 'zod'

const Params = z.object({ id: z.enum(LOADER_IDS) })
const Query = z.object({ mc: z.string().min(1).max(40) })

/** Loader versions for one Minecraft version, newest first. Empty for vanilla. */
export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, Params.parse)
  const { mc } = await getValidatedQuery(event, Query.parse)
  return providerCall(() => useLoaders()[id].loaderVersions(mc))
})
