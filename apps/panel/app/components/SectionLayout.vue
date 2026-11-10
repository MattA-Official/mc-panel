<script setup lang="ts">
/**
 * A tab split into sections: a menu down the left on wide screens and a dropdown on top
 * below that, with the section's page beside it. Used by World and Settings.
 */
export interface Section {
  label: string
  icon: string
  to: string
  exact?: boolean
}
const props = defineProps<{ sections: Section[]; label: string }>()

const route = useRoute()
const current = computed(
  () =>
    [...props.sections]
      .reverse()
      .find((s) => (s.exact ? route.path === s.to : route.path.startsWith(s.to))) ??
    props.sections[0]!,
)
const items = computed(() =>
  props.sections.map((s) => ({ ...s, active: s.to === current.value.to })),
)
const menu = computed(() => [items.value.map((s) => ({ ...s, type: 'link' as const }))])
</script>

<template>
  <div class="mx-auto grid w-full max-w-7xl gap-6 lg:grid-cols-[12rem_minmax(0,1fr)]">
    <nav :aria-label="label" class="min-w-0">
      <UNavigationMenu
        :items="items"
        orientation="vertical"
        highlight
        class="sticky top-0 hidden lg:flex"
        data-e2e="section-nav"
      />
      <UDropdownMenu :items="menu" :content="{ align: 'start' }" class="lg:hidden">
        <UButton
          :label="current.label"
          :icon="current.icon"
          trailing-icon="i-lucide-chevron-down"
          color="neutral"
          variant="outline"
          data-e2e="section-menu"
        />
      </UDropdownMenu>
    </nav>
    <div class="min-w-0">
      <slot />
    </div>
  </div>
</template>
