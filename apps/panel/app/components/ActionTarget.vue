<script setup lang="ts">
/**
 * Gives whatever it wraps (a card or a row) a Flytower right-click menu (#106), while
 * leaving the browser's own menu alone where people expect it:
 *
 * - Shift + right-click, selected text in the row, and fields or editors get the browser's.
 * - The Menu key and Shift + F10 open it anchored to the focused card or row, and Escape
 *   hands focus back.
 * - Press and hold on a touch screen opens the same actions as a bottom sheet.
 * - Account has a per-browser off switch.
 * - It's a row for keyboard movement (#108): J/K or the arrows move between rows, Enter
 *   opens, `.` opens the menu and Shift + Delete starts the delete (with its confirm).
 *
 * The same `items` should feed a visible ⋯ button (ActionMenuButton), so right-click is
 * only ever a shortcut.
 */
import type { Component } from 'vue'

defineOptions({ inheritAttrs: false })
const props = withDefaults(
  defineProps<{
    items: ActionItem[][]
    /** What the actions are for, e.g. the server's name. Titles the bottom sheet. */
    label: string
    /** The element (or component, like NuxtLink) to render: a card, a `tr`, a `li`. */
    as?: string | Component
  }>(),
  { as: 'div' },
)

const { enabled } = useRightClickMenus()
const shortcuts = useKeyboardShortcuts()
const pressDelay = LONG_PRESS_MS
const rootRef = useTemplateRef<HTMLElement | { $el: HTMLElement }>('root')
/** The rendered element, also when `as` is a component. */
const rootEl = () => {
  const r = rootRef.value
  return r instanceof HTMLElement ? r : (r?.$el ?? null)
}
const open = ref(false)
const sheetOpen = ref(false)

// The hint closes desktop menus; the sheet has no use for it.
const menuItems = computed<ActionItem[][]>(() => [
  ...props.items,
  [{ type: 'label', label: 'Shift + right-click for the browser menu' }],
])

let lastPointer = 'mouse'
let synthetic = false
let returnFocus: HTMLElement | null = null
let swallowClick = false

const narrow = () => window.matchMedia('(max-width: 639px)').matches
const wantsSheet = () => lastPointer === 'touch' || lastPointer === 'pen' || narrow()

function onPointerDown(e: PointerEvent) {
  lastPointer = e.pointerType
}

function onContextMenu(e: MouseEvent) {
  if (synthetic) return
  if (!enabled.value || wantsBrowserMenu(e, rootEl()!, window.getSelection())) {
    // This element is also the menu's trigger. Capture listeners run first, so stopping
    // here keeps the trigger from seeing it, and the default (the browser menu) stands.
    e.stopImmediatePropagation()
  }
}

function onOpenChange(value: boolean) {
  if (value && wantsSheet()) {
    openSheet()
    return
  }
  open.value = value
}

function openSheet() {
  open.value = false
  sheetOpen.value = true
  if (lastPointer === 'touch') {
    navigator.vibrate?.(10)
    // Lifting the finger after a long press can count as a tap, on the card's link or
    // on whichever row of the sheet is now under it.
    swallowClick = true
    document.addEventListener('pointerup', () => setTimeout(() => (swallowClick = false), 400), {
      capture: true,
      once: true,
    })
  }
}

// Watched on the whole document: the sheet sits outside this element, and the finger
// lifting can land on one of its rows.
function onClick(e: MouseEvent) {
  if (swallowClick) {
    swallowClick = false
    e.preventDefault()
    e.stopPropagation()
  }
}
onMounted(() => document.addEventListener('click', onClick, true))
onBeforeUnmount(() => document.removeEventListener('click', onClick, true))

/** The first delete-like (error-coloured) action, sub-menus included. */
function dangerItem(): ActionItem | undefined {
  const flat = props.items.flat().flatMap((i) => [i, ...(i.children ?? [])])
  return flat.find((i) => i.color === 'error' && !i.disabled)
}

/** Keys for the row itself, only while it (not a button or field inside it) has focus. */
function onRowKey(e: KeyboardEvent, target: HTMLElement): boolean {
  if (e.target !== target || e.ctrlKey || e.metaKey || e.altKey) return false
  if (e.key === 'Enter') {
    // Open: the row's own link or open button. Rows with neither open their menu.
    const opener = target.querySelector<HTMLElement>('[data-row-open], a[href]')
    if (!opener) return false
    opener.click()
    return true
  }
  if (e.key === 'Delete' && e.shiftKey) {
    const item = dangerItem()
    if (!item) return false
    choose(item)
    return true
  }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const rows = [...document.querySelectorAll<HTMLElement>(ROW_SELECTOR)].filter(
      (r) => r.offsetParent !== null,
    )
    const next = rows[stepRow(rows.length, rows.indexOf(target), e.key === 'ArrowDown' ? 1 : -1)]
    next?.focus()
    next?.scrollIntoView({ block: 'nearest' })
    return true
  }
  return false
}

function onKeydown(e: KeyboardEvent) {
  const target = rootEl()
  if (!target) return
  if (onRowKey(e, target)) {
    e.preventDefault()
    return
  }
  // `.` is a character key, so the shortcuts switch covers it; the Menu key is the
  // keyboard's own and only follows the right-click one.
  const onRow = e.target === target
  const dot = e.key === '.' && onRow && shortcuts.enabled.value
  if (!enabled.value || !(isMenuKey(e) || dot || (e.key === 'Enter' && onRow))) return
  e.preventDefault()
  returnFocus = document.activeElement as HTMLElement | null
  lastPointer = 'keyboard'
  if (narrow()) return openSheet()
  // Browsers give keyboard menus no useful position, so anchor it to the element.
  const rect = target.getBoundingClientRect()
  synthetic = true
  try {
    target.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + 16,
        clientY: rect.top + Math.min(rect.height, 48),
      }),
    )
  } finally {
    synthetic = false
  }
}

watch([open, sheetOpen], ([menu, sheet], [wasMenu, wasSheet]) => {
  if ((wasMenu && !menu) || (wasSheet && !sheet)) {
    const el = returnFocus
    returnFocus = null
    if (el?.isConnected) void nextTick(() => el.focus())
  }
})

function choose(item: ActionItem) {
  sheetOpen.value = false
  if (item.onSelect) item.onSelect()
  else if (typeof item.href === 'string') {
    // Downloads are plain links; the sheet's rows are buttons, so follow it by hand.
    const a = document.createElement('a')
    a.href = item.href
    if (typeof item.download === 'string') a.download = item.download
    a.click()
  } else if (item.to) void navigateTo(item.to)
}

/** Sub-menus have no room on a sheet, so their items show under a heading instead. */
const sheetGroups = computed(() =>
  props.items.flatMap((group) => {
    const plain = group.filter((i) => !i.children && i.type !== 'label')
    const nested = group
      .filter((i) => i.children)
      .map((i) => ({ heading: i.label, items: i.children! }))
    return [...(plain.length ? [{ heading: undefined, items: plain }] : []), ...nested]
  }),
)
</script>

<template>
  <UContextMenu
    :items="menuItems"
    :open="open"
    :disabled="!enabled"
    :press-open-delay="pressDelay"
    @update:open="onOpenChange"
  >
    <component
      :is="as"
      ref="root"
      v-bind="$attrs"
      tabindex="-1"
      data-action-row
      class="pointer-coarse:select-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
      @contextmenu.capture="onContextMenu"
      @pointerdown.capture="onPointerDown"
      @keydown="onKeydown"
    >
      <slot />
    </component>
  </UContextMenu>
  <UDrawer v-model:open="sheetOpen" :title="label" :ui="{ body: 'pb-6' }">
    <template #body>
      <div class="space-y-3" data-e2e="action-sheet">
        <div v-for="(group, i) in sheetGroups" :key="i">
          <p v-if="group.heading" class="px-3 pb-1 text-xs font-medium text-muted">
            {{ group.heading }}
          </p>
          <UButton
            v-for="item in group.items"
            :key="item.label"
            block
            size="xl"
            variant="ghost"
            :color="item.color === 'error' ? 'error' : 'neutral'"
            :icon="item.icon"
            :disabled="item.disabled"
            class="justify-start"
            @click="choose(item)"
          >
            <span class="flex min-w-0 flex-col text-left">
              <span>{{ item.label }}</span>
              <span v-if="item.description" class="text-xs font-normal text-muted">{{
                item.description
              }}</span>
            </span>
          </UButton>
        </div>
      </div>
    </template>
  </UDrawer>
</template>
