/** Start, stop or restart a server, for the panel and Discord alike. Doesn't audit. */
export async function powerServer(name: string, action: 'start' | 'stop' | 'restart') {
  findServer(name)
  // The old RCON connection dies with the process; don't hand it to the next command.
  if (action !== 'start') useConsole().forget(name)
  // A server created moments ago may not be followed yet; its first start should still be heard.
  syncLogWatcher()
  if (action === 'restart') useLogWatcher().restartPressed(name)
  try {
    // Stopping waits for the world to save, which can take a while on a big world.
    await agent(`service.${action}`, { server: name }, { timeoutMs: 150_000 })
  } catch (err) {
    if (action === 'restart') useLogWatcher().restartFailed(name)
    throw createError({
      statusCode: 502,
      statusMessage: `Couldn't ${action} ${name}: ${(err as Error).message}`,
    })
  }
}

/** Resolves true once the server logs that players can join, or false after `ms`. */
export function untilReady(name: string, ms = 5 * 60_000): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      stop()
      resolve(false)
    }, ms)
    const stop = useLogWatcher().listen((server, e) => {
      if (server !== name || e.kind !== 'ready') return
      clearTimeout(timer)
      stop()
      resolve(true)
    })
  })
}
