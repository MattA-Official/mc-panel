<script setup lang="ts">
/** How much of the machine's memory the servers have been given. */
interface Budget {
  totalMb: number
  budgetMb: number
  givenMb: number
  freeMb: number
  servers: { name: string; displayName: string; memoryMb: number; costMb: number }[]
}
defineProps<{ detailed?: boolean }>()
const { data } = await useFetch<{ budget: Budget }>('/api/servers/defaults')
const budget = computed(() => data.value?.budget)
const gb = (mb: number) => `${(mb / 1024).toFixed(1).replace(/\.0$/, '')} GB`
const over = computed(() => !!budget.value && budget.value.givenMb > budget.value.budgetMb)
</script>

<template>
  <div v-if="budget" class="space-y-2" data-e2e="memory-budget">
    <div class="flex flex-wrap items-baseline justify-between gap-2 text-sm">
      <span class="font-medium">Memory</span>
      <span class="text-muted tabular-nums">
        {{ gb(budget.givenMb) }} of {{ gb(budget.budgetMb) }} given ·
        <span :class="over ? 'text-error' : ''">
          {{ over ? `${gb(budget.givenMb - budget.budgetMb)} over` : `${gb(budget.freeMb)} free` }}
        </span>
      </span>
    </div>
    <UProgress
      :model-value="Math.min(budget.givenMb, budget.budgetMb)"
      :max="budget.budgetMb || 1"
      :color="over ? 'error' : budget.freeMb < 1024 ? 'warning' : 'primary'"
    />
    <template v-if="detailed">
      <ul class="space-y-1 text-sm">
        <li v-for="s in budget.servers" :key="s.name" class="flex justify-between gap-4">
          <span>{{ s.displayName }}</span>
          <span class="text-muted tabular-nums">{{ gb(s.memoryMb) }} + Java</span>
        </li>
      </ul>
      <p class="text-xs text-muted">
        This machine has {{ gb(budget.totalMb) }}. 1 GB is kept for the system and Flytower, and
        each server counts its memory plus about 0.5 GB that Java uses around it.
      </p>
    </template>
  </div>
</template>
