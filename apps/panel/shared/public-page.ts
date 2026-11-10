/**
 * A server's public status page: a page anyone can open without signing in, showing the
 * address, whether the server is up and who's on. Shared by the spec, the settings form and
 * the page itself.
 */
import { z } from 'zod'

export const PLAYER_VISIBILITY = ['names', 'count', 'none'] as const
export type PlayerVisibility = (typeof PLAYER_VISIBILITY)[number]

export const DESCRIPTION_MAX = 500

export const EXTRAS_MAX = 50

/** A client-only extra for the players' pack: a mod, shader pack or resource pack. */
export const ClientItem = z
  .object({
    modrinth: z
      .string()
      .trim()
      .regex(/^[\w.-]{1,64}$/, 'Use the project\'s Modrinth slug or id, like "iris".')
      .describe('A Modrinth project: a client mod, shader pack or resource pack.'),
    version: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .optional()
      .describe("An exact version number or id. Left out, the newest for the server's version."),
  })
  .strict()
export type ClientItem = z.output<typeof ClientItem>

const Pack = z
  .object({
    enabled: z
      .boolean()
      .default(true)
      .describe('Offer a modpack (.mrpack) on Fabric servers with mods players need.'),
    extras: z
      .array(ClientItem)
      .max(EXTRAS_MAX)
      .default([])
      .describe('Client-only extras for the pack, like Iris, Sodium or a shader pack.'),
  })
  .strict()
  .describe("The players' modpack, offered on the public page.")

export const PublicPage = z
  .object({
    enabled: z.boolean().default(false).describe('Turn the public page on. Off unless set.'),
    description: z
      .string()
      .trim()
      .max(DESCRIPTION_MAX)
      .default('')
      .describe('A few lines about the server, shown as plain text with line breaks.'),
    show: z
      .object({
        players: z
          .enum(PLAYER_VISIBILITY)
          .default('count')
          .describe(
            'Who is online: "names" shows heads and names, "count" only how many, "none" nothing.',
          ),
        version: z.boolean().default(true).describe('Show the Minecraft version and loader.'),
      })
      .strict()
      .default({ players: 'count', version: true }),
    pack: Pack.default({ enabled: true, extras: [] }),
  })
  .strict()
  .describe('A public status page at /s/<name> that anyone can open without signing in.')

export type PublicPage = z.output<typeof PublicPage>
export type PublicPageInput = z.input<typeof PublicPage>

export const defaultPublicPage = (): PublicPage => PublicPage.parse({})

/**
 * The settings as stored, with any field added since they were saved filled in. Null (never
 * set) and anything unreadable read as the defaults: off.
 */
export function readPublicPage(raw: unknown): PublicPage {
  const r = PublicPage.safeParse(raw ?? {})
  return r.success ? r.data : defaultPublicPage()
}

/** True when two settings say the same thing. */
export function samePublicPage(a: PublicPage, b: PublicPage): boolean {
  return (
    a.enabled === b.enabled &&
    a.description === b.description &&
    a.show.players === b.show.players &&
    a.show.version === b.show.version &&
    a.pack.enabled === b.pack.enabled &&
    JSON.stringify(a.pack.extras) === JSON.stringify(b.pack.extras)
  )
}

/** The spec as a person would write it: defaults left out. Null when it's all defaults. */
export function compactPublicPage(p: PublicPage): PublicPageInput | null {
  const out: PublicPageInput = {}
  if (p.enabled) out.enabled = true
  if (p.description) out.description = p.description
  const show: NonNullable<PublicPageInput['show']> = {}
  if (p.show.players !== 'count') show.players = p.show.players
  if (!p.show.version) show.version = false
  if (Object.keys(show).length) out.show = show
  const pack: NonNullable<PublicPageInput['pack']> = {}
  if (!p.pack.enabled) pack.enabled = false
  if (p.pack.extras.length) pack.extras = p.pack.extras
  if (Object.keys(pack).length) out.pack = pack
  return Object.keys(out).length ? out : null
}

/** One line for plans and Activity, like "On, showing player names". */
export function describePublicPage(p: PublicPage): string {
  if (!p.enabled) return 'Off'
  const players = { names: 'player names', count: 'how many are online', none: 'no players' }[
    p.show.players
  ]
  return `On, showing ${players}`
}

/** What the public page shows, as the public API sends it. */
export interface PublicStatus {
  name: string
  displayName: string
  description: string
  /** The message of the day from server.properties, with its `§` codes. */
  motd: string
  /** The server's 64×64 icon, or null when it has none. */
  icon: string | null
  /** The address players join with. */
  address: string
  /** online: players can join; starting: on its way up; offline: stopped or crashed. */
  state: 'online' | 'starting' | 'offline'
  /** null when the page doesn't show players. */
  players: {
    count: number
    max: number | null
    /** Only when the page shows names. */
    list?: { name: string; uuid: string }[]
  } | null
  /** null when the page doesn't show the version. */
  version: { minecraft: string; loader: string } | null
  /** The players' modpack download, when the server offers one. */
  pack: { url: string; filename: string } | null
}
