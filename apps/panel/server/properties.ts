/**
 * Reads and edits Java `.properties` files (Minecraft's server.properties) without
 * disturbing anything we didn't change: comments, blank lines, order and unknown keys stay.
 */

type Line =
  { kind: 'entry'; key: string; value: string; raw: string } | { kind: 'other'; raw: string }

export interface PropertiesDoc {
  lines: Line[]
  newline: string
}

/** Keys Flytower manages itself; edit them through their own settings. */
export const MANAGED_KEYS = new Set(['server-port', 'enable-rcon', 'rcon.port', 'rcon.password'])

export function parseProperties(text: string): PropertiesDoc {
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  const physical = text.split(/\r?\n/)
  if (physical.at(-1) === '') physical.pop()
  const lines: Line[] = []
  for (let i = 0; i < physical.length; i++) {
    let raw = physical[i]!
    const trimmed = raw.trimStart()
    if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('!')) {
      lines.push({ kind: 'other', raw })
      continue
    }
    // A logical line continues while it ends in an odd number of backslashes.
    let logical = trimmed
    while (endsWithContinuation(logical) && i + 1 < physical.length) {
      i++
      raw += newline + physical[i]
      logical = logical.slice(0, -1) + physical[i]!.trimStart()
    }
    const { key, value } = splitEntry(logical)
    lines.push({ kind: 'entry', key: unescape(key), value: unescape(value), raw })
  }
  return { lines, newline }
}

export function toRecord(doc: PropertiesDoc): Record<string, string> {
  const out: Record<string, string> = {}
  for (const l of doc.lines) if (l.kind === 'entry') out[l.key] = l.value
  return out
}

/** Sets values; only lines whose value really changed are rewritten. New keys go last. */
export function setProperties(doc: PropertiesDoc, changes: Record<string, string>): PropertiesDoc {
  const pending = new Map(Object.entries(changes))
  const lines = doc.lines.map((l): Line => {
    if (l.kind !== 'entry' || !pending.has(l.key)) return l
    const value = pending.get(l.key)!
    pending.delete(l.key)
    if (value === l.value) return l
    return { kind: 'entry', key: l.key, value, raw: `${escapeKey(l.key)}=${escapeValue(value)}` }
  })
  for (const [key, value] of pending) {
    lines.push({ kind: 'entry', key, value, raw: `${escapeKey(key)}=${escapeValue(value)}` })
  }
  return { lines, newline: doc.newline }
}

export function stringifyProperties(doc: PropertiesDoc): string {
  return doc.lines.map((l) => l.raw).join(doc.newline) + doc.newline
}

function endsWithContinuation(s: string): boolean {
  let n = 0
  for (let i = s.length - 1; i >= 0 && s[i] === '\\'; i--) n++
  return n % 2 === 1
}

function splitEntry(s: string): { key: string; value: string } {
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '\\') {
      i++
      continue
    }
    if (c === '=' || c === ':' || c === ' ' || c === '\t' || c === '\f') {
      let j = i
      while (s[j] === ' ' || s[j] === '\t' || s[j] === '\f') j++
      if ((s[j] === '=' || s[j] === ':') && (c === ' ' || c === '\t' || c === '\f')) j++
      else if (c === '=' || c === ':') j = i + 1
      while (s[j] === ' ' || s[j] === '\t' || s[j] === '\f') j++
      return { key: s.slice(0, i), value: s.slice(j) }
    }
  }
  return { key: s, value: '' }
}

const ESCAPES: Record<string, string> = { t: '\t', n: '\n', r: '\r', f: '\f' }

function unescape(s: string): string {
  return s.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, e: string) =>
    e.length === 5 ? String.fromCharCode(parseInt(e.slice(1), 16)) : (ESCAPES[e] ?? e),
  )
}

function escapeCommon(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/\t/g, '\\t')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\f/g, '\\f')
    .replace(/[=:#!]/g, (c) => `\\${c}`)
    .replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
}

/** Like Java's Properties.store: escapes separators, comment marks and non-ASCII. */
export const escapeValue = (s: string) => escapeCommon(s).replace(/^ /, '\\ ')
const escapeKey = (s: string) => escapeCommon(s).replace(/ /g, '\\ ')
