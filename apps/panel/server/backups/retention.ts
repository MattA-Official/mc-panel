export interface Retention {
  keepLast: number
  keepDaily: number
  keepWeekly: number
}

interface Dated {
  id: number
  createdAt: Date
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10)

/** ISO-8601 week, e.g. 2026-W45, in UTC. */
export function weekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const year = t.getUTCFullYear()
  const week = Math.ceil(((t.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7)
  return `${year}-W${String(week).padStart(2, '0')}`
}

/**
 * Which scheduled backups to delete. Keeps the newest `keepLast`, the newest of each of the
 * last `keepDaily` days that have a backup, and the newest of each of the last `keepWeekly`
 * weeks that have one. Everything else goes.
 */
export function toPrune<T extends Dated>(backups: T[], r: Retention): T[] {
  const newest = [...backups].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  const keep = new Set<number>(newest.slice(0, Math.max(0, r.keepLast)).map((b) => b.id))
  const bucket = (key: (d: Date) => string, count: number) => {
    const seen = new Set<string>()
    for (const b of newest) {
      if (seen.size >= count) break
      const k = key(b.createdAt)
      if (seen.has(k)) continue
      seen.add(k)
      keep.add(b.id)
    }
  }
  bucket(dayKey, r.keepDaily)
  bucket(weekKey, r.keepWeekly)
  return newest.filter((b) => !keep.has(b.id))
}
