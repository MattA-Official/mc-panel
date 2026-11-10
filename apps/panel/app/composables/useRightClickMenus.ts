/**
 * The per-browser switch for Flytower's right-click menus (#106), from Account. The ⋯
 * buttons stay whichever way it's set. Off is stored; on is the default.
 */
export function useRightClickMenus() {
  const enabled = useState('right-click-menus', () => true)
  onMounted(() => {
    enabled.value = rightClickEnabled(safeStorage())
  })
  function set(on: boolean) {
    enabled.value = on
    try {
      if (on) localStorage.removeItem(RIGHT_CLICK_KEY)
      else localStorage.setItem(RIGHT_CLICK_KEY, 'off')
    } catch {
      // Private windows can refuse storage; the switch still holds for this page.
    }
  }
  return { enabled: readonly(enabled), set }
}

function safeStorage(): Storage | null {
  try {
    return localStorage
  } catch {
    return null
  }
}
