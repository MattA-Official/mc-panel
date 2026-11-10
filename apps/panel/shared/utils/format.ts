/** Bytes the way people read them: 812 KB, 12.4 MB, 1.25 GB. */
export function humanBytes(n: number) {
  if (n < 1024 ** 2) return `${Math.max(1, Math.round(n / 1024))} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

type When = string | number | Date

/**
 * Dates and times in the viewer's own locale, the same way on every page:
 * "9 Nov 2026, 23:48" in Britain, "Nov 9, 2026, 11:49 PM" in the US.
 */
export const formatDateTime = (at: When) =>
  new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/** Just the date: "9 Nov 2026". */
export const formatDate = (at: When) =>
  new Date(at).toLocaleDateString(undefined, { dateStyle: 'medium' })

/** Just the time: "23:48". */
export const formatTime = (at: When) =>
  new Date(at).toLocaleTimeString(undefined, { timeStyle: 'short' })
