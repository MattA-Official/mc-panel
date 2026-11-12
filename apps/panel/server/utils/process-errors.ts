let installed = false

/**
 * Logs an unhandled rejection or uncaught exception instead of letting it end the panel.
 * One forgotten `.catch` in a timer or file watch shouldn't take every server's console,
 * schedules and backups down with it. Systemd still restarts the panel if it really dies.
 */
export function keepRunningOnStrayErrors(log: (msg: string, err: unknown) => void = console.error) {
  if (installed) return
  installed = true
  process.on('unhandledRejection', (err) => log('[flytower] unhandled rejection', err))
  process.on('uncaughtException', (err) => log('[flytower] uncaught exception', err))
}
