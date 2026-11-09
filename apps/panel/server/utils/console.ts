import { eq } from 'drizzle-orm'
import { ConsoleHub } from '../console/hub'
import { schema } from '../db'

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
