/**
 * Prints Markdown release notes from Conventional Commits between two refs.
 *
 *   bun scripts/release-notes.ts v0.1.0 [previous-tag]
 */
import { $ } from 'bun'

const REPO = 'https://github.com/MattA-Official/mc-panel'
const [to = 'HEAD', fromArg] = process.argv.slice(2)

const previous =
  fromArg ?? (await $`git describe --tags --abbrev=0 ${to}^`.nothrow().quiet().text()).trim() ?? ''
const range = previous ? `${previous}..${to}` : to
const raw = await $`git log ${range} --format=%H%x1f%s%x1f%b%x1e`.text()

interface Commit {
  hash: string
  type: string
  scope: string | null
  subject: string
  issues: string[]
  breaking: boolean
}

function parse(raw: string): Commit[] {
  return raw
    .split('\x1e')
    .map((r) => r.trim())
    .filter(Boolean)
    .flatMap((record) => {
      const [hash = '', subjectLine = '', body = ''] = record.split('\x1f')
      const m = subjectLine.match(/^(\w+)(?:\(([^)]+)\))?(!)?: (.+)$/)
      if (!m) return []
      const issues = [...body.matchAll(/(?:Closes|Fixes|Refs) #(\d+)/gi)].map((x) => x[1]!)
      return [
        {
          hash,
          type: m[1]!,
          scope: m[2] ?? null,
          subject: m[4]!,
          issues: [...new Set(issues)],
          breaking: !!m[3] || /BREAKING CHANGE/.test(body),
        },
      ]
    })
}

const sections: [string, (c: Commit) => boolean][] = [
  ['Breaking changes', (c) => c.breaking],
  ['Features', (c) => c.type === 'feat'],
  ['Fixes', (c) => c.type === 'fix'],
  ['Performance', (c) => c.type === 'perf'],
  ['Docs', (c) => c.type === 'docs'],
  ['Other', (c) => ['refactor', 'chore', 'ci', 'build', 'test'].includes(c.type)],
]

const commits = parse(raw)
const used = new Set<string>()
const out: string[] = []
for (const [title, match] of sections) {
  const list = commits.filter((c) => match(c) && !used.has(c.hash))
  if (!list.length) continue
  out.push(`### ${title}`, '')
  for (const c of list) {
    used.add(c.hash)
    const scope = c.scope ? `**${c.scope}:** ` : ''
    const refs = c.issues.map((n) => `[#${n}](${REPO}/issues/${n})`).join(', ')
    out.push(
      `- ${scope}${c.subject} ([${c.hash.slice(0, 7)}](${REPO}/commit/${c.hash}))${refs ? ` · ${refs}` : ''}`,
    )
  }
  out.push('')
}
if (previous) out.push(`**Full diff:** ${REPO}/compare/${previous}...${to}`)
console.log(out.join('\n'))
