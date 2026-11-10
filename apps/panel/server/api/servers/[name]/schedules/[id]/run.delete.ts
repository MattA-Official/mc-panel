import { z } from 'zod'
import { ScheduleError } from '../../../../../schedules/service'

const Params = z.object({ name: z.string().max(40), id: z.coerce.number().int() })

/** Calls off a restart that is counting down. Players who were warned are told. */
export default defineEventHandler(async (event) => {
  await requireServerPermission(event, 'server.configure')
  const { user } = await requireUserSession(event)
  const { name, id } = await getValidatedRouterParams(event, Params.parse)
  findServer(name)
  try {
    useSchedules().cancel(name, id)
  } catch (err) {
    if (err instanceof ScheduleError) {
      const missing = err.message.startsWith('No such')
      throw createError({ statusCode: missing ? 404 : 409, statusMessage: err.message })
    }
    throw err
  }
  audit(user.id, 'schedule.cancel', name, { id })
  return useSchedules().view(name)
})
