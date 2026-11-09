export type ServiceState =
  'active' | 'inactive' | 'activating' | 'deactivating' | 'failed' | 'unknown'

export interface Server {
  name: string
  displayName: string
  loader: 'vanilla' | 'fabric'
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
  `${s.loader === 'fabric' ? 'Fabric' : 'Vanilla'} ${s.mcVersion}`

export const formatMemory = (mb: number) => `${(mb / 1024).toFixed(mb % 1024 ? 1 : 0)} GB`

/** What players type to connect: the hostname, or this machine's address and the port. */
export function connectAddress(s: Pick<Server, 'hostname' | 'port'>, machine: string): string {
  if (s.hostname) return s.hostname
  return s.port === 25565 ? machine : `${machine}:${s.port}`
}
