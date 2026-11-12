/**
 * Live values the docs can show (#270): `:value{of="server.address"}`. In the panel's Help
 * they show your own setup, such as the address players join with; on the website, and
 * whenever the panel doesn't know, they read as words like "your server's address".
 *
 * Only plain facts that anyone who can open that server's page already sees. Never anything
 * secret: no tokens, keys, codes or addresses of other machines.
 */

export interface DocValue {
  /** What the website shows instead, and the panel when it can't tell. */
  fallback: string
  /** Read from a server: the one whose page you're on, or your only server. */
  server?: true
}

export const docValues = {
  'server.name': { fallback: 'your server', server: true },
  'server.address': { fallback: "your server's address", server: true },
  'server.version': { fallback: "your server's Minecraft version", server: true },
  'panel.address': { fallback: "your panel's address" },
} as const satisfies Record<string, DocValue>

export type DocValueId = keyof typeof docValues

/** The value with this id, or null if there's no such value. */
export function docValue(id: string): DocValue | null {
  return Object.hasOwn(docValues, id) ? docValues[id as DocValueId] : null
}

/** Every value a docs page shows, in `:value{of="…"}` order. */
export function valuesInMarkdown(markdown: string): string[] {
  return [...markdown.matchAll(/:value(?:\[[^\]]*\])?\{[^}]*\bof="([^"]*)"[^}]*\}/g)].map(
    (m) => m[1]!,
  )
}
