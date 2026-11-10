// Link previews for public status pages. The panel is a single-page app, so its HTML has no
// page-specific tags; this adds a title, description and image to /s/<name> for Discord and
// other sites that preview links without running scripts.
import { eq } from 'drizzle-orm'
import { schema } from '../db'
import { previewTags } from '../status/preview'

const PATH = /^\/s\/([a-z0-9][a-z0-9-]{0,39})\/?$/

export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('render:html', (html, { event }) => {
    const m = PATH.exec(getRequestURL(event).pathname)
    if (!m) return
    try {
      const row = useDb()
        .select({
          displayName: schema.servers.displayName,
          publicPage: schema.servers.publicPage,
        })
        .from(schema.servers)
        .where(eq(schema.servers.name, m[1]!))
        .get()
      if (!row?.publicPage?.enabled) return
      const brand = useBranding().public()
      const origin = getRequestURL(event, { xForwardedHost: true, xForwardedProto: true }).origin
      html.head.push(
        ...previewTags({
          displayName: row.displayName,
          description: row.publicPage.description,
          site: brand.name,
          image: brand.customLogo ? new URL(brand.logo, origin).href : null,
        }),
      )
    } catch (err) {
      console.error('[flytower] status page preview tags failed', err)
    }
  })
})
