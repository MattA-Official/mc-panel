import { resolve } from 'node:path'
import { defineCollection, defineContentConfig, z } from '@nuxt/content'

export default defineContentConfig({
  collections: {
    // The user docs live in the repo's docs/ folder, shared with the in-panel help.
    // Release test scripts (testing-*.md) are for testers, not users.
    docs: defineCollection({
      type: 'page',
      source: {
        cwd: resolve(__dirname, '../../docs'),
        include: '*.md',
        exclude: ['testing-*.md'],
        prefix: '/docs',
      },
      schema: z.object({
        order: z.number().optional(),
        since: z.string().optional(),
        panelRoute: z.string().optional(),
      }),
    }),
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
