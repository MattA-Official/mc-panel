<script setup lang="ts">
/** The records to create with the DNS provider, checked against public DNS. */
interface Checked {
  type: 'A' | 'AAAA' | 'SRV'
  name: string
  value: string
  status: 'ok' | 'missing' | 'wrong' | 'unknown'
  found: string[]
  hint?: string
}
const props = defineProps<{ server: string; hostname: string }>()
const { data, refresh, status } = await useFetch<{ records: Checked[] }>(
  () => `/api/servers/${props.server}/dns`,
  { watch: [() => props.hostname], default: () => ({ records: [] }) },
)
const BADGE = {
  ok: { label: 'Right', color: 'success' },
  missing: { label: 'Missing', color: 'warning' },
  wrong: { label: 'Wrong', color: 'error' },
  unknown: { label: "Couldn't check", color: 'neutral' },
} as const
const copyText = useCopy()
const copy = (s: string) => copyText(s, 'Value')
const srvParts = (v: string) => {
  const [priority, weight, port, target] = v.split(' ')
  return { priority, weight, port, target }
}
</script>

<template>
  <div class="space-y-3" data-e2e="dns-records">
    <div class="flex items-center justify-between gap-2">
      <h3 class="text-sm font-medium">DNS records</h3>
      <UButton
        label="Check again"
        icon="i-lucide-refresh-cw"
        size="xs"
        color="neutral"
        variant="outline"
        :loading="status === 'pending'"
        @click="refresh()"
      />
    </div>
    <p v-if="!data.records.length" class="text-sm text-muted">
      Couldn't work out this machine's public address. Set NUXT_MACHINE_IPV4 for the panel.
    </p>
    <div
      v-for="r in data.records"
      :key="r.type + r.name"
      class="space-y-1 rounded-md border border-default p-3 text-sm"
    >
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="font-medium">{{ r.type }} record</span>
        <UBadge :label="BADGE[r.status].label" :color="BADGE[r.status].color" variant="subtle" />
      </div>
      <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt class="text-muted">Name</dt>
        <dd class="flex min-w-0 items-center gap-1">
          <span class="truncate font-mono">{{ r.name }}</span>
          <UButton
            icon="i-lucide-copy"
            size="xs"
            color="neutral"
            variant="ghost"
            aria-label="Copy name"
            @click="copy(r.name)"
          />
        </dd>
        <template v-if="r.type === 'SRV'">
          <template v-for="(v, k) in srvParts(r.value)" :key="k">
            <dt class="text-muted capitalize">{{ k }}</dt>
            <dd class="flex items-center gap-1">
              <span class="font-mono">{{ v }}</span>
              <UButton
                icon="i-lucide-copy"
                size="xs"
                color="neutral"
                variant="ghost"
                :aria-label="`Copy ${k}`"
                @click="copy(v ?? '')"
              />
            </dd>
          </template>
        </template>
        <template v-else>
          <dt class="text-muted">Points to</dt>
          <dd class="flex items-center gap-1">
            <span class="font-mono">{{ r.value }}</span>
            <UButton
              icon="i-lucide-copy"
              size="xs"
              color="neutral"
              variant="ghost"
              aria-label="Copy address"
              @click="copy(r.value)"
            />
          </dd>
        </template>
      </dl>
      <p v-if="r.status === 'wrong'" class="text-muted">Points at {{ r.found.join(', ') }} now.</p>
      <p v-if="r.hint" class="text-warning">{{ r.hint }}</p>
    </div>
    <p class="text-xs text-muted">
      Create these with whoever runs your domain. If it's Cloudflare, set each to DNS only (grey
      cloud). Changes can take a few minutes to show here.
    </p>
  </div>
</template>
