import { ProviderError } from '@flytower/providers'
import { z } from 'zod'
import { readPublicPage } from '../../../../shared/public-page'
import { packUnavailable } from '../../../status/mrpack'

const Params = z.object({ name: z.string().max(40) })

/** What the players' modpack holds and what it leaves out, for the Public page card. */
export default defineEventHandler(async (event) => {
  const { name } = await getValidatedRouterParams(event, Params.parse)
  const row = findServer(name)
  const unavailable = packUnavailable(row)
  if (unavailable) return { unavailable, included: [], skipped: [], empty: true }
  const page = readPublicPage(row.publicPage)
  try {
    const pack = await usePacks().get(row, page.pack.extras)
    return {
      unavailable: null,
      included: pack.included,
      skipped: pack.skipped,
      empty: !pack.path,
    }
  } catch (err) {
    if (err instanceof ProviderError) {
      throw createError({ statusCode: 503, statusMessage: err.message })
    }
    throw err
  }
})
