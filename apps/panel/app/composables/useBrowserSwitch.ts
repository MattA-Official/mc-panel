/**
 * A per-browser on/off setting from Account, kept in localStorage: on unless switched off.
 * Used for right-click menus (#106) and keyboard shortcuts (#108).
 */
export function useBrowserSwitch(key: string) {
  const enabled = useState(`switch:${key}`, () => true)
  onMounted(() => {
    let storage: Storage | null = null
    try {
      storage = localStorage
    } catch {
      // Storage refused: stay on.
    }
    enabled.value = switchEnabled(storage, key)
  })
  function set(on: boolean) {
    enabled.value = on
    try {
      if (on) localStorage.removeItem(key)
      else localStorage.setItem(key, 'off')
    } catch {
      // Private windows can refuse storage; the switch still holds for this page.
    }
  }
  return { enabled: readonly(enabled), set }
}
