import type { UpdatesSnapshot } from '#shared/updates'

/**
 * What the background update check last found, kept current over the shared socket.
 * Subscribing also asks for a fresh check if the last one is over an hour old.
 */
export function useLiveUpdates() {
  const updates = useState<UpdatesSnapshot | null>('live-updates', () => null)
  useTopic<UpdatesSnapshot>('updates', (m) => (updates.value = m))
  return updates
}
