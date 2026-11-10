import { z } from 'zod'
import { SPEC_SCHEMA_PATH } from '../../../../shared/spec'
import { specFromServer } from '../../../spec/from-server'
import { toYaml } from '../../../spec/yaml'

const Params = z.object({ name: z.string().max(40) })

/** The server as a spec, in YAML and parsed. */
export default defineEventHandler(async (event) => {
  await requireUserSession(event)
  const { name } = await getValidatedRouterParams(event, Params.parse)
  const spec = specFromServer(
    findServer(name),
    await readProperties(name),
    useOffsite().targets(),
    useSchedules().tasks(name),
  )
  return { spec, yaml: toYaml(spec, new URL(SPEC_SCHEMA_PATH, relyingParty(event).origin).href) }
})
