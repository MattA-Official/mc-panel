export type ChallengePurpose = 'register' | 'login' | 'elevate'

interface Entry {
  challenge: string
  purpose: ChallengePurpose
  expiresAt: number
}

const TTL_MS = 60_000
const MAX_ENTRIES = 1_000

/**
 * Single-use WebAuthn challenges, kept in memory (one panel process per box). Each is bound
 * to a purpose so a login challenge cannot be replayed to register, and expires after 60 s.
 */
export class ChallengeStore {
  private entries = new Map<string, Entry>()

  constructor(private now: () => number = Date.now) {}

  /** Stores a challenge and returns the attempt id the browser sends back. */
  put(challenge: string, purpose: ChallengePurpose): string {
    this.sweep()
    if (this.entries.size >= MAX_ENTRIES) {
      // Oldest first: Map preserves insertion order.
      const oldest = this.entries.keys().next().value
      if (oldest) this.entries.delete(oldest)
    }
    const attemptId = Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64url')
    this.entries.set(attemptId, { challenge, purpose, expiresAt: this.now() + TTL_MS })
    return attemptId
  }

  /** Returns and deletes the challenge, or null if unknown, expired or for another purpose. */
  take(attemptId: string, purpose: ChallengePurpose): string | null {
    const e = this.entries.get(attemptId)
    this.entries.delete(attemptId)
    if (!e || e.purpose !== purpose || e.expiresAt < this.now()) return null
    return e.challenge
  }

  private sweep() {
    const t = this.now()
    for (const [k, e] of this.entries) if (e.expiresAt < t) this.entries.delete(k)
  }
}

export const challenges = new ChallengeStore()
