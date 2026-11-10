/** Discord's interaction and response types, as numbers on the wire. */
export const InteractionType = {
  Ping: 1,
  ApplicationCommand: 2,
  MessageComponent: 3,
  Autocomplete: 4,
  ModalSubmit: 5,
} as const

export const ResponseType = {
  Pong: 1,
  ChannelMessage: 4,
  DeferredChannelMessage: 5,
  AutocompleteResult: 8,
} as const

/** Message flag: only the person who used the command sees the answer. */
export const EPHEMERAL = 1 << 6

export interface Interaction {
  id: string
  type: number
  application_id: string
  token: string
  guild_id?: string
  data?: unknown
  member?: { user?: { id: string }; roles?: string[] }
  user?: { id: string }
}

/** A short private answer, for anything Flytower can't do (yet). */
export function ephemeral(content: string) {
  return {
    type: ResponseType.ChannelMessage,
    data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } },
  }
}

/** Answers one verified interaction. Commands arrive in a later part of the Discord app work. */
export async function answer(interaction: Interaction): Promise<unknown> {
  switch (interaction.type) {
    case InteractionType.Ping:
      return { type: ResponseType.Pong }
    case InteractionType.Autocomplete:
      return { type: ResponseType.AutocompleteResult, data: { choices: [] } }
    default:
      return ephemeral('Flytower can’t answer that yet.')
  }
}
