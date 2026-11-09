/**
 * Runs a dangerous action, asking for a passkey first if the panel says the last check is
 * too old. The action is retried once after a successful prompt.
 */
export function useElevation() {
  const { authenticate } = usePasskeys()
  return async function withElevation<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action()
    } catch (err) {
      const e = err as { statusCode?: number; data?: { data?: { elevate?: boolean } } }
      if (e.statusCode !== 403 || !e.data?.data?.elevate) throw err
      await authenticate('elevate')
      return action()
    }
  }
}
