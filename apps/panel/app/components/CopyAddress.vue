<script setup lang="ts">
/** The address players connect with, and a button to copy it. */
const props = defineProps<{ server: Pick<Server, 'hostname' | 'port'> }>()
const machine = useRequestURL().hostname
const address = computed(() => connectAddress(props.server, machine))
const { copied, copy: copyText } = useCopyButton()
const copy = () => copyText(address.value, 'Address')
</script>

<template>
  <span class="inline-flex min-w-0 items-center gap-1">
    <span class="truncate font-mono" data-e2e="connect-address">{{ address }}</span>
    <UButton
      :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
      :aria-label="copied ? 'Copied' : 'Copy address'"
      size="xs"
      color="neutral"
      variant="ghost"
      @click.prevent.stop="copy"
    />
  </span>
</template>
