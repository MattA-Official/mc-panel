import { eq } from 'drizzle-orm'
import { ConsoleHub } from '../console/hub'
import { schema } from '../db'
import { rewriteChat } from '../console/chat'
import { gameColour } from '../../shared/branding'

let hub: ConsoleHub | undefined

/** The one console hub for this process. */
export function useConsole(): ConsoleHub {
  hub ??= new ConsoleHub({
    serversDir: useRuntimeConfig().serversDir,
    rconTarget: (name) => {
      const row = useDb()
        .select({ port: schema.servers.rconPort, password: schema.servers.rconPassword })
        .from(schema.servers)
        .where(eq(schema.servers.name, name))
        .get()
      return row ?? null
    },
  })
  return hub
}

/**
 * Runs a command typed into the panel's console (or a scheduled task's command). `/say`, `/me`
 * and `/msg` go out as a `tellraw` under `[Server]` and the sender's name rather than "Rcon",
 * and chat everyone sees is passed to the server's Discord chat relay. `sender` is the
 * signed-in person's name, or null for the panel itself.
 */
export async function runConsoleCommand(
  name: string,
  command: string,
  sender: string | null,
  opts: { timeoutMs?: number } = {},
): Promise<string> {
  const chat = rewriteChat(command, sender, gameColour(useBranding().settings()))
  if (!chat) return useConsole().command(name, command, opts)
  const reply = await useConsole().command(name, chat.command, {
    ...opts,
    echoAs: { command, reply: chat.shown },
  })
  if (chat.relay && !reply.trim()) void useChatRelay().offer(name, chat.relay)
  return chat.shown(reply).join('\n')
}
