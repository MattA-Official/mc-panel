/**
 * Who is on each server, for the public status page, kept without asking the server.
 *
 * The log watcher already sees every "joined the game", "left the game", "Done" and
 * "Stopping the server" line (through inotify, no polling), so the roster follows those.
 * When the panel starts, or a server is first asked about while running, the roster asks
 * the console once (`list`) to know who's already there. After that, visitors to the
 * public page never reach the server.
 */
import type { LogEvent } from '../notify/watchers'
import type { OnlinePlayers } from '../players'

interface Entry {
  /** Players currently on, in the order they joined. */
  players: Set<string>
  /** "Done" was seen (or `list` answered) since it last stopped. */
  ready: boolean
  /** The roster has a known starting point: a `list` answer or a fresh start. */
  known: boolean
  max: number | null
}

export interface RosterView {
  ready: boolean
  /** null until the roster knows who's on. */
  players: string[] | null
  max: number | null
}

/** Asks the console who's on; null when it doesn't answer. */
export type ListPlayers = (server: string) => Promise<OnlinePlayers | null>

/** Don't ask a console that didn't answer again for this long. */
export const SEED_RETRY_MS = 60_000

export class Roster {
  private entries = new Map<string, Entry>()
  private seeding = new Map<string, Promise<void>>()
  private lastTry = new Map<string, number>()

  constructor(
    private list: ListPlayers,
    private now: () => number = Date.now,
  ) {}

  private entry(server: string): Entry {
    let e = this.entries.get(server)
    if (!e) {
      e = { players: new Set(), ready: false, known: false, max: null }
      this.entries.set(server, e)
    }
    return e
  }

  /** A line from the server's log. */
  observe(server: string, event: LogEvent) {
    const e = this.entry(server)
    switch (event.kind) {
      case 'ready':
        // A fresh start: nobody can be on yet.
        e.players.clear()
        e.ready = true
        e.known = true
        break
      case 'stopping':
        this.reset(server)
        break
      case 'joined':
        e.players.add(event.player)
        break
      case 'left':
        e.players.delete(event.player)
        break
    }
  }

  /** The server stopped or crashed: nobody is on, and it isn't ready. */
  reset(server: string) {
    const e = this.entry(server)
    e.players.clear()
    e.ready = false
    e.known = false
  }

  forget(server: string) {
    this.entries.delete(server)
    this.lastTry.delete(server)
  }

  /**
   * Who's on a server that systemd says is running. The first time (or after a stop), asks
   * the console once; while that's in flight, or if the console didn't answer, the players
   * aren't known yet.
   */
  async view(server: string, running: boolean): Promise<RosterView> {
    if (!running) {
      this.reset(server)
      return { ready: false, players: [], max: this.entries.get(server)?.max ?? null }
    }
    const e = this.entry(server)
    if (!e.known) await this.seed(server)
    return {
      ready: e.ready,
      players: e.known ? [...e.players] : null,
      max: e.max,
    }
  }

  private seed(server: string): Promise<void> {
    const inFlight = this.seeding.get(server)
    if (inFlight) return inFlight
    const last = this.lastTry.get(server)
    if (last !== undefined && this.now() - last < SEED_RETRY_MS) return Promise.resolve()
    this.lastTry.set(server, this.now())
    const p = this.list(server)
      .catch(() => null)
      .then((online) => {
        if (!online) return
        // Only a console that didn't answer waits before being asked again.
        this.lastTry.delete(server)
        const e = this.entry(server)
        // A join or a "Done" seen while asking is newer than the answer.
        if (e.known) return
        e.players = new Set(online.names)
        e.max = online.max
        e.ready = true
        e.known = true
      })
      .finally(() => this.seeding.delete(server))
    this.seeding.set(server, p)
    return p
  }
}
