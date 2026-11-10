import { Roster } from '../status/roster'
import { parseList } from '../players'

let roster: Roster | undefined

/** Who's on each server, from the log, for the public status page. */
export function useRoster(): Roster {
  if (!roster) {
    const r = new Roster((server) =>
      useConsole()
        .command(server, 'list', { echo: false })
        .then(parseList)
        .catch(() => null),
    )
    useLogWatcher().listen((server, e) => r.observe(server, e))
    roster = r
  }
  return roster
}
