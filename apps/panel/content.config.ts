import { defineContentConfig } from '@nuxt/content'
import { docsCollection } from '@flytower/docs-layer/collection'

// The repo's docs/ folder, bundled into each build so Help always matches the installed version.
export default defineContentConfig({
  collections: { docs: docsCollection('/help') },
})
