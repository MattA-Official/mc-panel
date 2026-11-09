type Listener = (message: unknown) => void

/**
 * In-process publish/subscribe keyed by topic (`job:12`, later `console:survival`). The panel
 * is one process, so this is all the fan-out the WebSocket needs.
 */
export class Bus {
  private topics = new Map<string, Set<Listener>>()

  subscribe(topic: string, listener: Listener): () => void {
    let set = this.topics.get(topic)
    if (!set) this.topics.set(topic, (set = new Set()))
    set.add(listener)
    return () => {
      set.delete(listener)
      if (set.size === 0) this.topics.delete(topic)
    }
  }

  publish(topic: string, message: unknown) {
    for (const listener of this.topics.get(topic) ?? []) {
      try {
        listener(message)
      } catch (err) {
        console.error(`[flytower] listener on ${topic} failed`, err)
      }
    }
  }
}
