<script setup lang="ts">
/** One leaderboard as a ranked list with heads. Used by the Stats tab and the public page. */
import { formatStat, type Board } from '#shared/leaderboards'

const props = withDefaults(
  defineProps<{
    board: Board
    icon?: string
    /** The skin URL for a player, for pages that can't use the signed-in skin route. */
    skin?: (uuid: string) => string | undefined
  }>(),
  { icon: undefined, skin: undefined },
)

const MEDALS = ['text-amber-400', 'text-slate-300', 'text-orange-400']
const medal = (rank: number) => MEDALS[rank - 1] ?? 'text-muted'
</script>

<template>
  <section
    class="rounded-lg border border-default p-4"
    :data-e2e="`board-${props.board.key}`"
    :aria-label="props.board.label"
  >
    <h3 class="flex items-center gap-2 text-sm font-semibold">
      <UIcon v-if="props.icon" :name="props.icon" class="size-4 text-muted" />
      {{ props.board.label }}
    </h3>
    <p v-if="!props.board.entries.length" class="mt-3 text-sm text-muted">Nobody yet.</p>
    <ol v-else class="mt-3 space-y-1.5">
      <li v-for="e in props.board.entries" :key="e.uuid" class="flex items-center gap-2.5 text-sm">
        <span
          class="w-5 shrink-0 text-right font-mono text-xs tabular-nums"
          :class="medal(e.rank)"
          >{{ e.rank }}</span
        >
        <PlayerHead :uuid="e.uuid" :size="20" :src="props.skin?.(e.uuid)" />
        <span class="min-w-0 flex-1 truncate">{{ e.name }}</span>
        <span class="shrink-0 font-mono text-xs text-muted tabular-nums">{{
          formatStat(props.board.unit, e.value)
        }}</span>
      </li>
    </ol>
  </section>
</template>
