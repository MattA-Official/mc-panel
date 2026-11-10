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
 *
 * The same `items` should feed a visible ⋯ button (ActionMenuButton), so right-click is
 * only ever a shortcut.
 */
const props = defineProps<{
  items: ActionItem[][]
  /** What the actions are for, e.g. the server's name. Titles the bottom sheet. */
  label: string
}>()

const { enabled } = useRightClickMenus()
const pressDelay = LONG_PRESS_MS
const root = useTemplateRef<HTMLElement>('root')
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
  if (!enabled.value || wantsBrowserMenu(e, root.value!, window.getSelection())) {
    // Stop it here, before the menu's trigger sees it, and leave the default alone.
    e.stopPropagation()
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

function onKeydown(e: KeyboardEvent) {
  if (!enabled.value || !isMenuKey(e)) return
  const target = root.value?.firstElementChild as HTMLElement | null
  if (!target) return
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
  else if (item.to) void navigateTo(item.to)
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
  <div
    ref="root"
    class="contents"
    @contextmenu.capture="onContextMenu"
    @pointerdown.capture="onPointerDown"
    @keydown="onKeydown"
  >
    <UContextMenu
      :items="menuItems"
      :open="open"
      :disabled="!enabled"
      :press-open-delay="pressDelay"
      class="pointer-coarse:select-none"
      @update:open="onOpenChange"
    >
      <slot />
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
  </div>
</template>
