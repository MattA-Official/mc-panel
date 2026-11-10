/**
 * Stable entry points (docs/decisions/0001-rust-and-go.md, rule 5). systemd starts the agent
 * as `current/bin/flytower-agent`, and the agent starts a release's updater as
 * `releases/<version>/bin/flytower-updater`, so what is behind those paths (Bun today, Rust
 * later) can change between releases.
 *
 * Releases before these wrappers existed only have `bin/bun agent/agent.js`, and the
 * installer never runs again after an update, so the unit has to be rewritten to match
 * whichever release `current` is about to point at: by the agent when it starts, by the
 * updater when it switches, and by the agent before it hands over to an older updater.
 */
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const AGENT_UNIT = 'flytower-agent.service'

/** True if a release folder has the wrapper scripts. */
export const hasWrappers = (release: string) => existsSync(join(release, 'bin', 'flytower-agent'))

/**
 * The agent unit's ExecStart line for `release` (a folder under `prefix/releases`). It always
 * goes through `current`, so it stays right after the symlink moves.
 */
export function agentExecStart(prefix: string, release: string): string {
  const current = join(prefix, 'current')
  return hasWrappers(release)
    ? `ExecStart=${join(current, 'bin', 'flytower-agent')}`
    : `ExecStart=${join(current, 'bin', 'bun')} ${join(current, 'agent', 'agent.js')}`
}

/** How to run `release`'s updater: its wrapper, or Bun and the bundled script before that. */
export function updaterCommand(release: string): string[] {
  return hasWrappers(release)
    ? [join(release, 'bin', 'flytower-updater')]
    : [join(release, 'bin', 'bun'), join(release, 'agent', 'updater.js')]
}

/** True if `release` has an updater this agent knows how to start. */
export const hasUpdater = (release: string) =>
  existsSync(join(release, 'bin', 'flytower-updater')) ||
  existsSync(join(release, 'agent', 'updater.js'))

/**
 * Points the agent unit at `release`'s entry point. Returns true if the file changed; the
 * caller runs `systemctl daemon-reload`. Leaves a unit without an ExecStart line alone.
 */
export async function setAgentExecStart(
  systemdDir: string,
  prefix: string,
  release: string,
): Promise<boolean> {
  const file = join(systemdDir, AGENT_UNIT)
  const unit = await readFile(file, 'utf8').catch(() => null)
  if (unit === null || !/^ExecStart=.*$/m.test(unit)) return false
  const line = agentExecStart(prefix, release)
  const next = unit.replace(/^ExecStart=.*$/m, () => line)
  if (next === unit) return false
  await writeFile(file, next)
  return true
}
