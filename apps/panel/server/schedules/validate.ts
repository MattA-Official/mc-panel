import type { ScheduleItem } from '../../shared/schedules'
import { nextRun } from './timers'

/** Problems Zod can't see: unknown time zones and cron expressions Bun can't read. */
export function scheduleProblems(
  items: ScheduleItem[],
  timezone?: string,
): { path: (string | number)[]; message: string }[] {
  const out: { path: (string | number)[]; message: string }[] = []
  if (timezone !== undefined) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: timezone })
    } catch {
      out.push({ path: ['timezone'], message: `Unknown time zone ${timezone}.` })
    }
  }
  for (const [i, item] of items.entries()) {
    const key = 'restart' in item ? 'restart' : 'cron'
    try {
      nextRun('restart' in item ? item.restart : item.cron, 'UTC')
    } catch (err) {
      out.push({ path: ['schedules', i, key], message: (err as Error).message })
    }
  }
  return out
}
