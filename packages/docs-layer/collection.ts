import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineCollection, z } from '@nuxt/content'

/** The repo's docs/ folder: the one place user docs are written. */
export const docsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../docs')

/**
 * Frontmatter every docs page may carry. Titles and descriptions come from the page's H1 and
 * first paragraph unless the frontmatter sets them.
 */
export const docsSchema = z.object({
  /** Group in the docs navigation, e.g. "Running servers". */
  section: z.string().optional(),
  /** Position in the navigation; sections follow their lowest-ordered page. */
  order: z.number().optional(),
  /** First Flytower version with this feature, e.g. "1.1.0". */
  since: z.string().optional(),
  /**
   * Panel routes this page explains, e.g. "/servers/:name/backups" or "/system/ssh#ssh". The
   * panel's Help button opens the best match; the website ignores it.
   */
  panelRoute: z.union([z.string(), z.array(z.string())]).optional(),
})

/** The docs collection, served under `prefix` (/help in the panel, /docs on the website). */
export function docsCollection(prefix: string) {
  return defineCollection({
    type: 'page',
    // Top-level pages only: docs/testing/ holds release test scripts, which aren't user docs.
    source: { cwd: docsDir, include: '*.md', prefix },
    schema: docsSchema,
  })
}
