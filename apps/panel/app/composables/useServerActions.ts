import { serverUpdateCount } from '#shared/updates'
import PowerConfirmModal from '~/components/PowerConfirmModal.vue'

/**
 * Menu groups for a server card: the same list feeds its ⋯ button and its right-click
 * menu. Power actions keep their confirm; Clone, Delete and Back up now open the page that
 * owns them, with its own confirm.
 */
export function useServerActions(agentOk: () => boolean = () => true) {
  const can = useCan()
  const toast = useToast()
  const live = useLiveStatuses()
  const updates = useLiveUpdates()
  const url = useRequestURL()
  const overlay = useOverlay()
  const confirm = overlay.create(PowerConfirmModal)

  const copy = useCopy()

  async function power(s: Server, action: 'start' | 'restart' | 'stop') {
    if (action !== 'start') {
      const ok = await confirm.open({ action, displayName: s.displayName })
      if (!ok) return
    }
    try {
      await $fetch(`/api/servers/${s.name}/${action}` as string, { method: 'POST' })
    } catch (err) {
      toast.add({
        title: `Couldn't ${action} ${s.displayName}`,
        description: errorMessage(err),
        color: 'error',
      })
    }
  }

  return (s: Server) => {
    const status = live.value[s.name] ?? s.status
    return serverActions({
      server: s,
      running: status === 'active' || status === 'activating',
      updates: serverUpdateCount(updates.value, s.name),
      agentOk: agentOk(),
      can,
      origin: url.origin,
      go: (to) => void navigateTo(to),
      openInNewTab: (to) => void window.open(to, '_blank', 'noopener'),
      copy: (text, what) => void copy(text, what),
      copyAddress: () => void copy(connectAddress(s, url.hostname), 'Address'),
      power: (action) => void power(s, action),
    })
  }
}
