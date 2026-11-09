/**
 * Reading and writing specs as YAML with Bun.YAML. Bun's parser doesn't say where a value
 * came from, so `lineOf` finds a path by walking the indentation, which is enough for the
 * block style people write and we emit.
 */
import {
  compactSpec,
  issuePath,
  ServerSpec,
  type ServerSpecInput,
  type SpecIssue,
} from '../../shared/spec'
import { nextRun } from '../backups/scheduler'

export type ParsedSpec = { ok: true; spec: ServerSpec } | { ok: false; issues: SpecIssue[] }

const MAX_SPEC_BYTES = 256 * 1024

interface Line {
  n: number
  indent: number
  text: string
}

function meaningful(text: string): Line[] {
  return text.split(/\r?\n/).flatMap((raw, i) => {
    const t = raw.trimStart()
    if (!t || t.startsWith('#') || t === '---') return []
    return [{ n: i + 1, indent: raw.length - t.length, text: t }]
  })
}

/** The 1-based line a path points at, or the nearest line found on the way. */
export function lineOf(text: string, path: readonly PropertyKey[]): number | undefined {
  const lines = meaningful(text)
  let from = 0
  let parent = -1
  let found: number | undefined
  for (const seg of path) {
    let hit = -1
    let childIndent = 0
    let count = 0
    for (let i = from; i < lines.length; i++) {
      const l = lines[i]!
      // A line at or left of the parent ends the block (except for the parent's own line).
      if (i > from && l.indent <= parent) break
      if (i === from && from > 0 && l.indent <= parent && typeof seg !== 'number') {
        // The parent's own line may hold the first key after "- ".
        const first = /^-\s+([^:#]+?)\s*:/.exec(l.text)
        if (first && first[1] === String(seg)) {
          hit = i
          childIndent = l.indent + 2
          break
        }
        continue
      }
      if (typeof seg === 'number') {
        if (l.text.startsWith('-') && l.indent > parent) {
          if (count === seg) {
            hit = i
            childIndent = l.indent
            break
          }
          count++
        }
      } else {
        const m = /^(-\s+)?(["']?)([^:#"']+?)\2\s*:(\s|$)/.exec(l.text)
        if (m && m[3] === String(seg) && l.indent > parent) {
          hit = i
          childIndent = l.indent + (m[1]?.length ?? 0)
          break
        }
      }
    }
    if (hit < 0) return found
    found = lines[hit]!.n
    from = hit
    parent = childIndent
  }
  return found
}

/** Parses and checks a spec. Never throws. */
export function parseSpec(text: string): ParsedSpec {
  if (text.length > MAX_SPEC_BYTES) {
    return { ok: false, issues: [{ path: '', message: 'That spec is too long.' }] }
  }
  let doc: unknown
  try {
    doc = Bun.YAML.parse(text)
  } catch (err) {
    const message = (err as Error).message.replace(/^YAML Parse error:\s*/i, '')
    return {
      ok: false,
      issues: [{ path: '', message: `This isn't valid YAML: ${message}` }],
    }
  }
  if (Array.isArray(doc)) doc = doc[0]
  if (!doc || typeof doc !== 'object') {
    return {
      ok: false,
      issues: [{ path: '', message: 'A spec needs at least name and loader.', line: 1 }],
    }
  }
  const parsed = ServerSpec.safeParse(doc)
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({
        path: issuePath(i.path),
        message: i.message,
        line: lineOf(text, i.path),
      })),
    }
  }
  const spec = parsed.data
  const issues: SpecIssue[] = []
  const tzPath = spec.backups.schedule ? ['backups', 'schedule'] : ['backups', 'timezone']
  try {
    if (spec.backups.schedule) nextRun(spec.backups.schedule, spec.backups.timezone)
    else new Intl.DateTimeFormat('en', { timeZone: spec.backups.timezone })
  } catch (err) {
    const msg = (err as Error).message
    const path = msg.startsWith('Unknown time zone') ? ['backups', 'timezone'] : tzPath
    issues.push({ path: issuePath(path), message: msg, line: lineOf(text, path) })
  }
  return issues.length ? { ok: false, issues } : { ok: true, spec }
}

/** The spec as YAML, with a schema line so editors can check it. */
export function toYaml(spec: ServerSpec | ServerSpecInput, schemaUrl?: string): string {
  const body = Bun.YAML.stringify(compactSpec(ServerSpec.parse(spec)), null, 2)
  const head = schemaUrl ? `# yaml-language-server: $schema=${schemaUrl}\n` : ''
  return `${head}${body.endsWith('\n') ? body : `${body}\n`}`
}
