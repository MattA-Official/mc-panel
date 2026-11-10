/**
 * Prints Markdown release notes from Conventional Commits between two refs.
 *
 *   bun scripts/release-notes.ts v0.1.0 [previous-tag]
 *
 * A stable release starts from the last stable tag, so it covers its betas too.
 * A written summary in .github/release-notes/<version>.md, if there is one, goes first.
 * A squash merge whose message lists the branch's commits (GitHub's "* feat: ..." lines)
 * is split back into those commits. Commits that still aren't Conventional Commits are
 * listed under "Other changes", so a release never comes out empty.
 */
import { $ } from 'bun'

const REPO = 'https://github.com/MattA-Official/mc-panel'
const [to = 'HEAD', fromArg] = process.argv.slice(2)

// A stable release lists everything since the last stable one, betas included.
const stable = /^v?\d+\.\d+\.\d+$/.test(to)
const exclude = stable ? ['--exclude', 'v*-*'] : []
const previous =
  fromArg ??
  (
    await $`git describe --tags --abbrev=0 --match ${'v*'} ${exclude} ${to}^`
      .nothrow()
      .quiet()
      .text()
  ).trim()
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
      if (/^Merge (branch|pull request|remote-tracking)/.test(subjectLine)) return []
      const issues = [
        ...new Set([...body.matchAll(/(?:Closes|Fixes|Refs) #(\d+)/gi)].map((x) => x[1]!)),
      ]
      const squashed = [...body.matchAll(/^\* (\w+(?:\([^)]+\))?!?: .+)$/gm)].map((x) => x[1]!)
      const lines = squashed.length ? squashed : [subjectLine]
      return lines.map((line) => {
        const m = line.match(CONVENTIONAL)
        return {
          hash,
          type: m?.[1] ?? '',
          scope: m?.[2] ?? null,
          subject: m?.[4] ?? line,
          issues,
          breaking: !!m?.[3] || /BREAKING CHANGE/.test(body),
        }
      })
    })
}

const CONVENTIONAL = /^(\w+)(?:\(([^)]+)\))?(!)?: (.+)$/

const sections: [string, (c: Commit) => boolean][] = [
  ['Breaking changes', (c) => c.breaking],
  ['Features', (c) => c.type === 'feat'],
  ['Fixes', (c) => c.type === 'fix'],
  ['Performance', (c) => c.type === 'perf'],
  ['Docs', (c) => c.type === 'docs'],
  ['Other', (c) => ['refactor', 'chore', 'ci', 'build', 'test'].includes(c.type)],
  ['Other changes', (c) => c.type === ''],
]

const commits = parse(raw)
const used = new Set<Commit>()
const out: string[] = []
const summary = Bun.file(`.github/release-notes/${to.replace(/^v/, '')}.md`)
if (await summary.exists()) out.push((await summary.text()).trim(), '')
for (const [title, match] of sections) {
  const list = commits.filter((c) => match(c) && !used.has(c))
  if (!list.length) continue
  out.push(`### ${title}`, '')
  for (const c of list) {
    used.add(c)
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
