export type ServiceState =
  'active' | 'inactive' | 'activating' | 'deactivating' | 'failed' | 'unknown'

export type LoaderId = 'vanilla' | 'fabric' | 'paper'

/** How each loader is named and described in the UI. */
export const LOADERS: Record<
  LoaderId,
  { label: string; description: string; versionLabel: string | null }
> = {
  fabric: { label: 'Fabric', description: 'Runs Fabric mods', versionLabel: 'Fabric loader' },
  paper: {
    label: 'Paper',
    description: 'Faster vanilla, with plugins to come',
    versionLabel: 'Paper build',
  },
  vanilla: { label: 'Vanilla', description: 'Plain Minecraft', versionLabel: null },
}
export const loaderItems = (Object.keys(LOADERS) as LoaderId[]).map((value) => ({
  value,
  label: LOADERS[value].label,
  description: LOADERS[value].description,
}))

export interface Server {
  name: string
  displayName: string
  loader: LoaderId
  mcVersion: string
  loaderVersion: string | null
  javaMajor: number
  memoryMb: number
  port: number
  hostname: string | null
  createdAt: string
  status: ServiceState
}

/** Live systemd states for every server, kept current over the shared socket. */
export function useLiveStatuses() {
  const statuses = ref<Record<string, ServiceState>>({})
  useTopic<Record<string, ServiceState>>('servers', (m) => (statuses.value = m))
  return statuses
}

export const loaderLabel = (s: Pick<Server, 'loader' | 'mcVersion'>) =>
  `${LOADERS[s.loader]?.label ?? s.loader} ${s.mcVersion}`

export const formatMemory = (mb: number) => `${(mb / 1024).toFixed(mb % 1024 ? 1 : 0)} GB`

/** What players type to connect: the hostname, or this machine's address and the port. */
export function connectAddress(s: Pick<Server, 'hostname' | 'port'>, machine: string): string {
  if (s.hostname) return s.hostname
  return s.port === 25565 ? machine : `${machine}:${s.port}`
}
