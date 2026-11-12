/**
 * The per-browser switch for Flytower's right-click menus (#106), from Account. The ⋯
 * buttons stay whichever way it's set.
 */
export const useRightClickMenus = () => useBrowserSwitch(RIGHT_CLICK_KEY)

/**
 * The per-browser switch for single-key and G-then-letter shortcuts (#108), as WCAG 2.1.4
 * asks for. Ctrl/⌘ + K and Ctrl/⌘ + S stay on.
 */
export const useKeyboardShortcuts = () => useBrowserSwitch(SHORTCUTS_KEY)
