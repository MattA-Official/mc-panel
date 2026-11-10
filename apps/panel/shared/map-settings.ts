/**
 * A server's web map (squaremap): who may open it, and whether it shows where players are.
 * Shared by the spec, the World tab card and the code that writes squaremap's config.
 */
import { z } from 'zod'

export const MapSettings = z
  .object({
    public: z
      .boolean()
      .default(false)
      .describe(
        'Let anyone open the map, without signing in. Needs the public page on. Otherwise only people who can see this server in the panel can.',
      ),
    players: z
      .boolean()
      .default(true)
      .describe('Show where online players are. Off, positions are never written to disk.'),
  })
  .strict()
  .describe('The web map, made by squaremap. Left out, the current settings stay.')

export type MapSettings = z.output<typeof MapSettings>
export type MapSettingsInput = z.input<typeof MapSettings>

export const DEFAULT_MAP: MapSettings = { public: false, players: true }

/** The settings as stored (null until first set), with defaults filled in. */
export function readMapSettings(raw: unknown): MapSettings {
  const r = MapSettings.safeParse(raw ?? {})
  return r.success ? r.data : { ...DEFAULT_MAP }
}

export const isDefaultMap = (m: MapSettings) =>
  m.public === DEFAULT_MAP.public && m.players === DEFAULT_MAP.players

export const sameMapSettings = (a: MapSettings, b: MapSettings) =>
  a.public === b.public && a.players === b.players

/** A one-line summary for plans and the activity log. */
export function describeMap(m: MapSettings): string {
  return `${m.public ? 'Anyone' : 'Signed-in people'}, ${m.players ? 'with players' : 'no players'}`
}

/** Only what differs from the defaults, for a tidy spec. */
export function compactMap(m: MapSettings): MapSettingsInput | null {
  if (isDefaultMap(m)) return null
  const out: MapSettingsInput = {}
  if (m.public !== DEFAULT_MAP.public) out.public = m.public
  if (m.players !== DEFAULT_MAP.players) out.players = m.players
  return out
}
