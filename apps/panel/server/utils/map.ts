import { MapService } from '../map/service'

let service: MapService | undefined

/** The one map service for this process. */
export function useMap(): MapService {
  service ??= new MapService({
    db: useDb(),
    serverDir,
    agent,
    rcon: (name, command) =>
      useConsole().command(name, command, { echo: false, timeoutMs: 10_000 }),
  })
  return service
}
