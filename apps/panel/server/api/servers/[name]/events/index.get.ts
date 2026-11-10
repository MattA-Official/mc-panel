import { z } from 'zod'

const Params = z.object({ name: z.string().max(40) })

/** Crashes and other trouble from the last 30 days, newest first. */
export default defineEventHandler(async (event) => {
  await requireServerPermission(event, 'server.view')
  const { name } = await getValidatedRouterParams(event, Params.parse)
  findServer(name)
  return useCrashes()
    .events(name)
    .map((e) => ({
      id: e.id,
      at: e.at.toISOString(),
      kind: e.kind,
      cause: e.cause,
      result: e.result,
      exitStatus: e.exitStatus,
      crashReport: e.crashReport,
      logTail: e.logTail ?? [],
      dismissed: e.dismissedAt !== null,
    }))
})
