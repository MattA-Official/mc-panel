/**
 * Release gate: refuses to release a commit the E2E workflow (install, self-update and the
 * upgrade tests) hasn't passed on. Reuses the run main already had rather than running it
 * again. A commit with no run of its own passes on the nearest earlier commit that has one,
 * as long as everything in between only touches paths E2E ignores (release notes, say).
 *
 *   bun scripts/e2e-gate.ts <sha>     (needs GH_TOKEN and GITHUB_REPOSITORY; E2E_WORKFLOW
 *                                     points at another copy of e2e.yml)
 */
import { $ } from 'bun'

export interface Run {
  status: string
  conclusion: string | null
  html_url: string
}

export interface GateDeps {
  /** Commits from `sha` back along the first parent, newest first. */
  history: string[]
  /** E2E runs for a commit, newest first. */
  runs: (sha: string) => Promise<Run[]>
  /** Files changed between two commits. */
  changed: (from: string, to: string) => Promise<string[]>
  /** The globs E2E's push trigger ignores. */
  ignored: string[]
}

export type Verdict = { ok: true; via: string; url: string } | { ok: false; reason: string }

export function isIgnored(file: string, globs: string[]) {
  return globs.some((g) => new Bun.Glob(g).match(file))
}

export async function decide(deps: GateDeps): Promise<Verdict> {
  const [target] = deps.history
  if (!target) return { ok: false, reason: 'no commit to check' }
  for (const sha of deps.history) {
    if (sha !== target) {
      const product = (await deps.changed(sha, target)).filter((f) => !isIgnored(f, deps.ignored))
      if (product.length) {
        return {
          ok: false,
          reason: `E2E hasn't run on ${target.slice(0, 7)}, which changes ${product.slice(0, 3).join(', ')}. Run the E2E workflow on it first.`,
        }
      }
    }
    const [run] = await deps.runs(sha)
    if (!run) continue
    if (run.status !== 'completed') {
      return { ok: false, reason: `E2E is still running on ${sha.slice(0, 7)}: ${run.html_url}` }
    }
    if (run.conclusion !== 'success') {
      return {
        ok: false,
        reason: `E2E ended "${run.conclusion}" on ${sha.slice(0, 7)}: ${run.html_url}`,
      }
    }
    return { ok: true, via: sha, url: run.html_url }
  }
  return { ok: false, reason: `no E2E run found in the last ${deps.history.length} commits` }
}

if (import.meta.main) {
  const target = process.argv[2]
  const repo = process.env.GITHUB_REPOSITORY
  const token = process.env.GH_TOKEN
  if (!target || !repo || !token) {
    console.error('usage: GH_TOKEN=… GITHUB_REPOSITORY=owner/repo bun scripts/e2e-gate.ts <sha>')
    process.exit(2)
  }
  const file = process.env.E2E_WORKFLOW ?? '.github/workflows/e2e.yml'
  const workflow = Bun.YAML.parse(await Bun.file(file).text()) as {
    on: { push: { 'paths-ignore'?: string[] } }
  }
  const history = (await $`git rev-list --first-parent -n 30 ${target}`.text()).trim().split('\n')
  const verdict = await decide({
    history,
    ignored: workflow.on.push['paths-ignore'] ?? [],
    changed: async (from, to) =>
      (await $`git diff --name-only ${from} ${to}`.text()).split('\n').filter(Boolean),
    runs: async (sha) => {
      const res = await fetch(
        `https://api.github.com/repos/${repo}/actions/workflows/e2e.yml/runs?head_sha=${sha}&per_page=5`,
        { headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' } },
      )
      if (!res.ok) throw new Error(`GitHub said ${res.status} listing E2E runs`)
      return ((await res.json()) as { workflow_runs: Run[] }).workflow_runs
    },
  })
  if (!verdict.ok) {
    console.error(`::error::${verdict.reason}`)
    process.exit(1)
  }
  console.log(`E2E passed on ${verdict.via.slice(0, 7)}: ${verdict.url}`)
}
