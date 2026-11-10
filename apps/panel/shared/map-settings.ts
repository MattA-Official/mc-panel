/**
 * A server's web map: whether Flytower draws it, who may open it, and whether it shows
 * where players are. Shared by the spec, the World tab card and the map service.
 */
import { z } from 'zod'

export const MapSettings = z
  .object({
    enabled: z
      .boolean()
      .default(false)
      .describe(
        'Draw a web map of the world. Flytower reads the world files itself, so nothing is added to the server.',
      ),
    public: z
      .boolean()
      .default(false)
      .describe(
        'Let anyone open the map, without signing in. Needs the public page on. Otherwise only people who can see this server in the panel can.',
      ),
    players: z
      .boolean()
      .default(true)
      .describe('Show where online players are, while someone has the map open.'),
  })
  .strict()
  .describe('The web map. Left out, the current settings stay.')

export type MapSettings = z.output<typeof MapSettings>
export type MapSettingsInput = z.input<typeof MapSettings>

export const DEFAULT_MAP: MapSettings = { enabled: false, public: false, players: true }

/** The settings as stored (null until first set), with defaults filled in. */
export function readMapSettings(raw: unknown): MapSettings {
  const r = MapSettings.safeParse(raw ?? {})
  return r.success ? r.data : { ...DEFAULT_MAP }
}

export const sameMapSettings = (a: MapSettings, b: MapSettings) =>
  a.enabled === b.enabled && a.public === b.public && a.players === b.players

export const isDefaultMap = (m: MapSettings) => sameMapSettings(m, DEFAULT_MAP)

/** A one-line summary for plans and the activity log. */
export function describeMap(m: MapSettings): string {
  if (!m.enabled) return 'Off'
  return `On: ${m.public ? 'anyone' : 'signed-in people'}, ${m.players ? 'with players' : 'no players'}`
}

/** Only what differs from the defaults, for a tidy spec. */
export function compactMap(m: MapSettings): MapSettingsInput | null {
  if (isDefaultMap(m)) return null
  const out: MapSettingsInput = {}
  if (m.enabled !== DEFAULT_MAP.enabled) out.enabled = m.enabled
  if (m.public !== DEFAULT_MAP.public) out.public = m.public
  if (m.players !== DEFAULT_MAP.players) out.players = m.players
  return out
}
