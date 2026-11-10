<script setup lang="ts">
/**
 * The Java runtimes Flytower installed, and whether Adoptium has a newer build of each.
 * Updating them from here comes later (issue #99).
 */
import { failedCheck } from '#shared/updates'

const updates = useLiveUpdates()
const runtimes = computed(() =>
  (updates.value?.java ?? []).flatMap((j) => (j.summary ? [{ ...j.summary, check: j }] : [])),
)
const failed = computed(() => failedCheck(updates.value?.java ?? []))
const lastRun = computed(() => updates.value?.lastRunAt ?? null)
</script>

<template>
  <UCard v-if="updates" data-e2e="java-runtimes">
    <template #header>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-base font-semibold">Java</h2>
        <p class="text-xs text-muted">
          <template v-if="updates.checking">Checking for updates…</template>
          <template v-else-if="lastRun">Checked {{ formatDateTime(lastRun) }}</template>
        </p>
      </div>
    </template>
    <div class="space-y-3 text-sm">
      <p v-if="!runtimes.length" class="text-muted">
        No Java installed yet. Flytower installs the right one when you create a server.
      </p>
      <ul v-else class="divide-y divide-default">
        <li
          v-for="r in runtimes"
          :key="r.major"
          class="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0"
        >
          <div class="min-w-0">
            <p class="font-medium">
              Java {{ r.major }}
              <span class="font-mono text-xs text-muted">{{ r.installed }}</span>
            </p>
            <p class="text-xs text-muted">
              {{ r.servers.length ? `Used by ${r.servers.join(', ')}` : 'Not used by any server' }}
            </p>
          </div>
          <UBadge
            v-if="r.latest"
            color="info"
            variant="subtle"
            icon="i-lucide-arrow-up-circle"
            :label="`${r.latest} available`"
          />
          <UBadge v-else color="neutral" variant="subtle" label="Up to date" />
        </li>
      </ul>
      <p v-if="runtimes.some((r) => r.latest)" class="text-xs text-muted">
        Newer Java builds bring security and bug fixes. Updating Java from the panel is coming in a
        later release; until then the servers keep running on the build they have.
      </p>
      <p v-if="failed" class="text-xs text-muted">
        Couldn't check for newer Java: {{ failed.error.replace(/\.$/, '') }}.
      </p>
    </div>
  </UCard>
</template>
