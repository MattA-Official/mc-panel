<script setup lang="ts">
/** A leaderboard's icon. The names are written out here so the icon bundle finds them. */
import type { BoardKey } from '#shared/leaderboards'

defineProps<{ board: BoardKey }>()

const ICONS: Record<BoardKey, string> = {
  playtime: 'i-lucide-clock',
  deaths: 'i-lucide-skull',
  mob_kills: 'i-lucide-sword',
  distance: 'i-lucide-footprints',
  blocks_mined: 'i-lucide-pickaxe',
}
</script>

<template>
  <UIcon :name="ICONS[board]" aria-hidden="true" />
</template>
