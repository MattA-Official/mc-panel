/**
 * Compares x.y.z[-pre] versions: negative if a is older. A pre-release sorts before its
 * release, and pre-release parts compare as semver does (beta.9 before beta.10). The panel
 * offers only releases newer than the running one by this order, and the agent refuses to
 * install anything older (`crates/flytower-agent/src/versions.rs` is the same).
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const s = v.replace(/^v/, '')
    const dash = s.indexOf('-')
    const main = dash < 0 ? s : s.slice(0, dash)
    return { nums: main.split('.').map(Number), pre: dash < 0 ? null : s.slice(dash + 1) }
  }
  const x = parse(a)
  const y = parse(b)
  for (let i = 0; i < 3; i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0)
    if (d) return d
  }
  if (x.pre === y.pre) return 0
  if (x.pre === null) return 1
  if (y.pre === null) return -1
  const xp = x.pre.split('.')
  const yp = y.pre.split('.')
  for (let i = 0; i < Math.max(xp.length, yp.length); i++) {
    const p = xp[i]
    const q = yp[i]
    if (p === undefined) return -1
    if (q === undefined) return 1
    if (p === q) continue
    const pn = /^\d+$/.test(p)
    const qn = /^\d+$/.test(q)
    if (pn && qn) return Number(p) - Number(q)
    if (pn) return -1
    if (qn) return 1
    return p < q ? -1 : 1
  }
  return 0
}
