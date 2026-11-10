import { DiskUsage } from '../disk'
import { getSetting, setSetting } from '../settings'
import { schema } from '../db'

let usage: DiskUsage | undefined

/** The one disk use tracker for this process. */
export function useDiskUsage(): DiskUsage {
  if (usage) return usage
  const config = useRuntimeConfig()
  usage = new DiskUsage({
    names: () =>
      useDb()
        .select({ name: schema.servers.name })
        .from(schema.servers)
        .all()
        .map((r) => r.name),
    serverDir,
    backupsDir: config.backupsDir,
    exportsDir: config.exportsDir,
    mapsDir: config.mapsDir,
    importsDir: config.importsDir,
    archiveDir: config.archiveDir,
    levelName: async (name) => (await readProperties(name))['level-name'] ?? null,
    load: () => getSetting(useDb(), 'disk.usage') ?? null,
    save: (report) => setSetting(useDb(), 'disk.usage', report),
  })
  return usage
}

/** How full the servers' disk is, from the metrics sampler's last reading. */
export function diskFullness() {
  const m = useMetrics().latest
  if (m?.diskUsedMb == null || !m.diskTotalMb) {
    return { usedMb: null, totalMb: null, percent: null }
  }
  return {
    usedMb: m.diskUsedMb,
    totalMb: m.diskTotalMb,
    percent: Math.round((m.diskUsedMb / m.diskTotalMb) * 1000) / 10,
  }
}
