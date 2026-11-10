/**
 * Whether a server keeps player stats (sessions, playtime and the daily snapshot), and which
 * players are left out of them. Shared by the spec, the settings card and the recorders.
 */
import { z } from 'zod'

export const LEAVE_OUT_MAX = 500

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export const LeftOutPlayer = z
  .object({
    uuid: z
      .string()
      .trim()
      .toLowerCase()
      .regex(UUID, "Use the player's UUID, like 069a79f4-44e9-4726-a5be-fca90e38aaf5."),
    name: z
      .string()
      .trim()
      .min(1)
      .max(32)
      .describe('Their name, to make the list readable. The UUID is what counts.'),
  })
  .strict()
export type LeftOutPlayer = z.output<typeof LeftOutPlayer>

export const StatsSettings = z
  .object({
    enabled: z
      .boolean()
      .default(true)
      .describe('Keep playtime and a daily snapshot of player stats for this server.'),
    leaveOut: z
      .array(LeftOutPlayer)
      .max(LEAVE_OUT_MAX)
      .default([])
      .describe('Players whose stats are never kept. What was kept about them is deleted.'),
  })
  .strict()
export type StatsSettings = z.output<typeof StatsSettings>

export const DEFAULT_STATS: StatsSettings = { enabled: true, leaveOut: [] }

/** The settings as stored (null until first set), with defaults filled in. */
export function readStatsSettings(raw: unknown): StatsSettings {
  const r = StatsSettings.safeParse(raw ?? {})
  return r.success ? r.data : { ...DEFAULT_STATS, leaveOut: [] }
}

export function isDefaultStats(s: StatsSettings): boolean {
  return s.enabled && s.leaveOut.length === 0
}

export function sameStatsSettings(a: StatsSettings, b: StatsSettings): boolean {
  if (a.enabled !== b.enabled || a.leaveOut.length !== b.leaveOut.length) return false
  const ids = new Set(a.leaveOut.map((p) => p.uuid))
  return b.leaveOut.every((p) => ids.has(p.uuid))
}

/** A one-line summary for plans and the activity log. */
export function describeStats(s: StatsSettings): string {
  if (!s.enabled) return 'Off'
  const n = s.leaveOut.length
  return n ? `On, ${n} player${n === 1 ? '' : 's'} left out` : 'On'
}
