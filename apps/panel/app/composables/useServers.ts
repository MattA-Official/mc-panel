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
