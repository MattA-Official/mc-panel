/** The Discord app connection, as the System page sees it. The bot token never leaves the panel. */
export type DiscordState =
  | {
      connected: false
      /** Where Discord should send interactions; null when the panel has no domain. */
      endpointUrl: string | null
    }
  | {
      connected: true
      applicationId: string
      name: string
      endpointUrl: string | null
      /** Whether Flytower set (and Discord accepted) the endpoint URL on the app. */
      endpointSet: boolean
      /** Why setting the endpoint URL failed, when it did. */
      endpointError: string | null
      /** Adds the app's commands to a Discord server. */
      inviteUrl: string
      connectedAt: string
    }
