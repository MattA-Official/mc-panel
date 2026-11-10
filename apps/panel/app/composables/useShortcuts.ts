/**
 * The panel-wide keyboard shortcuts (#108), set up once by the default layout. What they
 * are lives in `utils/shortcuts.ts`; this wires them to the router.
 *
 * - None of them fire while typing in a field, the console or an editor (`defineShortcuts`
 *   checks), or while a dialog or menu is open.
 * - Only unmodified keys are used, so the browser's own Ctrl/⌘ keys still work.
 * - Account has a per-browser off switch; Ctrl/⌘ + K and + S stay on.
 */
export function useShortcuts() {
  const route = useRoute()
  const router = useRouter()
  const { enabled } = useKeyboardShortcuts()
  const sheetOpen = useShortcutSheet()
  const { data: servers } = useFetch<Server[]>('/api/servers', {
    key: 'palette-servers',
    default: () => [],
    server: false,
  })

  const current = computed(() =>
    route.path.startsWith('/servers/') ? String(route.params.name ?? '') || null : null,
  )

  /** Something modal is up: its own keys win. */
  const busy = () =>
    !!document.querySelector('[role="dialog"][data-state="open"], [role="menu"][data-state="open"]')

  const guard = (fn: () => void) => () => {
    if (!busy()) fn()
  }

  function openLogs() {
    if (!current.value) return
    // On whichever tab you're on: the pop-up belongs to the server page.
    void router.replace({ query: { ...route.query, logs: '' } })
  }

  function go(jumpKey: string) {
    const jump = JUMPS.find((j) => j.key === jumpKey)!
    if (jump.key === 'g-l') return openLogs()
    const to = jumpTarget(jump, current.value)
    if (to) void navigateTo(to)
  }

  function neighbour(step: 1 | -1) {
    if (!current.value) return
    const names = (servers.value ?? []).map((s) => s.name)
    const to = neighbourServer(names, current.value, route.path, step)
    if (to) void navigateTo(to)
  }

  function focusSearch() {
    const el = document.querySelector<HTMLElement>(FOCUS_SELECTOR)
    el?.focus()
  }

  /** J/K from anywhere: into the list, or along it from the focused row. */
  function move(step: 1 | -1) {
    const rows = [...document.querySelectorAll<HTMLElement>(ROW_SELECTOR)].filter(
      (r) => r.offsetParent !== null,
    )
    const active = document.activeElement?.closest<HTMLElement>(ROW_SELECTOR) ?? null
    const i = stepRow(rows.length, active ? rows.indexOf(active) : -1, step)
    const row = rows[i]
    if (!row) return
    row.focus()
    row.scrollIntoView({ block: 'nearest' })
  }

  defineShortcuts(
    computed(() => {
      if (!enabled.value) return {}
      return {
        ...Object.fromEntries(JUMPS.map((j) => [j.key, guard(() => go(j.key))])),
        l: guard(openLogs),
        '[': guard(() => neighbour(-1)),
        ']': guard(() => neighbour(1)),
        '?': guard(() => (sheetOpen.value = true)),
        '/': guard(focusSearch),
        j: guard(() => move(1)),
        k: guard(() => move(-1)),
      }
    }),
  )
}

/** Whether the `?` sheet is showing. */
export const useShortcutSheet = () => useState('shortcut-sheet', () => false)
