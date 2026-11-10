import { z } from 'zod'
import { ScheduleError } from '../../../../../schedules/service'

const Params = z.object({ name: z.string().max(40), id: z.coerce.number().int() })

/**
 * Runs a scheduled task now. A restart still counts down its warnings. Answers at once; the
 * result arrives on the `schedules:<name>` topic and in the activity log.
 */
export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const { name, id } = await getValidatedRouterParams(event, Params.parse)
  findServer(name)
  try {
    useSchedules().runNow(name, id, user.id)
  } catch (err) {
    if (err instanceof ScheduleError) {
      const missing = err.message.startsWith('No such')
      throw createError({ statusCode: missing ? 404 : 409, statusMessage: err.message })
    }
    throw err
  }
  return useSchedules().view(name)
})
