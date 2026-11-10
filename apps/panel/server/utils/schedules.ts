import { gameColour } from '../../shared/branding'
import { ScheduleService } from '../schedules/service'

let service: ScheduleService | undefined

/**
 * Restarts a server the way the panel's Restart button does: the restart alert goes out and
 * crash detection expects it. Resolves once systemd reports it running again.
 */
async function restartLikeTheButton(name: string) {
  useConsole().forget(name)
  syncLogWatcher()
  useLogWatcher().restartPressed(name)
  try {
    await agent('service.restart', { server: name }, { timeoutMs: 150_000 })
  } catch (err) {
    useLogWatcher().restartFailed(name)
    throw new Error(`Couldn't restart: ${(err as Error).message}`, { cause: err })
  }
  await useStatus().poke()
  await useJobs().waitActive(name)
}

/** The one scheduled-task service for this process. */
export function useSchedules(): ScheduleService {
  service ??= new ScheduleService({
    db: useDb(),
    lock: useBackups(),
    rcon: (name, command) => useConsole().command(name, command, { timeoutMs: 30_000 }),
    isRunning: async (name) => {
      const { active } = await agent('service.status', { server: name })
      return active === 'active'
    },
    restart: restartLikeTheButton,
    notify: useNotify(),
    bus: useJobs().bus,
    colour: () => gameColour(useBranding().settings()),
  })
  return service
}
