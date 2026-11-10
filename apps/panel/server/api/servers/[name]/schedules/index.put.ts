import { z } from 'zod'
import { describeTask, Schedules, toTask } from '../../../../../shared/schedules'
import { scheduleProblems } from '../../../../schedules/validate'

const Params = z.object({ name: z.string().max(40) })
const Body = z.object({
  timezone: z.string().trim().min(1).max(60),
  schedules: Schedules,
})

/** Replaces the server's scheduled tasks and time zone, as the spec's `schedules:` would. */
export default defineEventHandler(async (event) => {
  await requireServerPermission(event, 'server.configure')
  const { user } = await requireUserSession(event)
  const { name } = await getValidatedRouterParams(event, Params.parse)
  findServer(name)
  const parsed = Body.safeParse(await readBody(event))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!
    throw createError({ statusCode: 400, statusMessage: issue.message })
  }
  const { timezone, schedules } = parsed.data
  const problem = scheduleProblems(schedules, timezone)[0]
  if (problem) throw createError({ statusCode: 400, statusMessage: problem.message })
  const tasks = schedules.map(toTask)
  useSchedules().replace(name, tasks, timezone)
  audit(user.id, 'schedule.update', name, { timezone, tasks: tasks.map(describeTask) })
  return useSchedules().view(name)
})
