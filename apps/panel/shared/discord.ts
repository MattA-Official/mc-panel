/** Where the Gateway connection for chat from Discord is. */
export type DiscordChatConnection = 'off' | 'connecting' | 'connected' | 'reconnecting' | 'stopped'

/** Chat from Discord into the game, as the Discord card shows it. */
export interface DiscordChatState {
  /** The setting: whether the panel keeps a connection to Discord open. */
  enabled: boolean
  state: DiscordChatConnection
  /** Why it's reconnecting or stopped. */
  error: string | null
  /** When the state last changed (ISO). */
  since: string | null
  /** Discord servers the bot has been added to. */
  guildCount: number
  /** Servers whose chat takes messages from Discord, by display name. */
  servers: string[]
}

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
      /** The slash commands Flytower answers, without the slash. */
      commands: string[]
      /** Why Discord didn't take the command list, when it didn't. */
      commandsError: string | null
      /** Adds the app as a bot that can see channels, which chat from Discord needs. */
      botInviteUrl: string
      chat: DiscordChatState
    }

/** A Discord role whose members get a Flytower role, for one server or (null) all of them. */
export interface DiscordRoleMapping {
  discordRoleId: string
  /** A name to recognise the Discord role by; Discord doesn't tell the app role names. */
  label: string
  /** A Flytower role ID. */
  roleId: string
  server: string | null
}

/** What the role mapping section needs: the mappings and what can be picked. */
export interface DiscordRolesView {
  mappings: DiscordRoleMapping[]
  roles: { id: string; name: string }[]
  servers: { name: string; displayName: string }[]
}
