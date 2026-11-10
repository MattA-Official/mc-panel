import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { schema } from '../../../db'
import { PublicPage, defaultPublicPage, samePublicPage } from '../../../../shared/public-page'

const Params = z.object({ name: z.string().max(40) })

/** The server's public status page: on or off, its description and what it shows. */
export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const { name } = await getValidatedRouterParams(event, Params.parse)
  const body = await readValidatedBody(event, PublicPage.parse)
  const server = findServer(name)
  const was = server.publicPage ?? defaultPublicPage()
  if (samePublicPage(was, body)) return { changed: false }
  useDb()
    .update(schema.servers)
    .set({ publicPage: body })
    .where(eq(schema.servers.name, name))
    .run()
  audit(user.id, 'server.public_page', name, {
    enabled: body.enabled,
    was: was.enabled,
    players: body.show.players,
  })
  return { changed: true }
})
