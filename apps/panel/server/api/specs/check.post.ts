import { z } from 'zod'
import { parseSpec } from '../../spec/yaml'

const Body = z.object({ yaml: z.string().max(256 * 1024) })

/** Checks a spec without changing anything, for the YAML editor. */
export default defineEventHandler(async (event) => {
  await requireUserSession(event)
  const { yaml } = await readValidatedBody(event, Body.parse)
  return parseSpec(yaml)
})
