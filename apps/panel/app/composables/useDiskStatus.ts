/**
 * How full the disk is, with each server's share. Shared by the banner, the System page and
 * the backup dialog, so they all show the same figures from one request.
 */
export function useDiskStatus() {
  return useFetch('/api/system/disk', { key: 'disk-status', dedupe: 'defer' })
}

/** Space the way people read it, from megabytes: 812 MB, 12.4 GB. */
export function humanMb(mb: number) {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`
}
