/** Text colour for a Minecraft log line, by its level. */
export function logTone(line: string) {
  if (line.startsWith('> ')) return 'text-primary'
  if (/\/WARN\]/.test(line)) return 'text-warning'
  if (/\/(ERROR|FATAL)\]/.test(line)) return 'text-error'
  return 'text-default'
}
