/**
 * Rules for Flytower's right-click menus (#106), kept free of Vue so they can be tested
 * on their own. `ActionTarget.vue` applies them.
 */

/** Where the browser's own menu always wins: fields, editors and anything opted out. */
export const NATIVE_MENU_SELECTOR =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], .cm-editor, [data-native-menu]'

/** How long a finger has to stay down to open a menu. */
export const LONG_PRESS_MS = 500

/** The per-browser off switches, in localStorage. */
export const RIGHT_CLICK_KEY = 'flytower:right-click-menus'
export const SHORTCUTS_KEY = 'flytower:keyboard-shortcuts'

interface ContextEvent {
  shiftKey: boolean
  target: EventTarget | null
}

interface SelectionLike {
  isCollapsed: boolean
  anchorNode: Node | null
  toString(): string
}

/**
 * Whether a right-click should be left to the browser: Shift held, text selected inside
 * the row, or the click landed in a field or editor.
 */
export function wantsBrowserMenu(
  event: ContextEvent,
  root: Node,
  selection: SelectionLike | null,
): boolean {
  if (event.shiftKey) return true
  const target = event.target as Element | null
  if (target && typeof target.closest === 'function' && target.closest(NATIVE_MENU_SELECTOR)) {
    return true
  }
  if (
    selection &&
    !selection.isCollapsed &&
    selection.toString().trim() !== '' &&
    selection.anchorNode &&
    root.contains(selection.anchorNode)
  ) {
    return true
  }
  return false
}

/** The Menu key, or Shift + F10: the keyboard's way of asking for a context menu. */
export const isMenuKey = (e: { key: string; shiftKey: boolean }) =>
  e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')

/** Reads an off switch. Anything but an explicit "off" keeps the feature on. */
export function switchEnabled(storage: Pick<Storage, 'getItem'> | null, key: string): boolean {
  try {
    return storage?.getItem(key) !== 'off'
  } catch {
    return true
  }
}
