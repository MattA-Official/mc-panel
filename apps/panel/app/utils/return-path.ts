/**
 * Where to go after signing in: the page someone was sent away from, if it's a path on this
 * panel. Anything else (another site, `//host`, a backslash trick, the sign-in pages
 * themselves) falls back to the home page.
 */
export function returnPath(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/')) return '/'
  if (value.startsWith('//') || value.includes('\\')) return '/'
  // Control characters (tabs, new lines) are dropped by URL parsing, so `/\t/host` is `//host`.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return '/'
  const path = value.split(/[?#]/, 1)[0]!
  if (['/login', '/setup', '/enrol'].includes(path)) return '/'
  return value
}
