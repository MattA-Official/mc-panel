import { defineCollection, defineContentConfig, z } from '@nuxt/content'
import { docsCollection } from '@flytower/docs-layer/collection'

export default defineContentConfig({
  collections: {
    // The repo's docs/ folder, shared with the panel's built-in help (which serves it at /help).
    docs: docsCollection('/docs'),
    // Site-only pages written in Markdown, such as "Why Flytower?".
    pages: defineCollection({
      type: 'page',
      source: { include: 'pages/*.md', prefix: '/' },
    }),
    legal: defineCollection({
      type: 'page',
      source: { include: 'legal/*.md', prefix: '/legal' },
      schema: z.object({ lastUpdated: z.string().optional() }),
    }),
  },
})
