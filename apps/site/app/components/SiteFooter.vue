<script setup lang="ts">
const site = useAppConfig().site
const columns = [
  {
    label: 'Flytower',
    children: [
      { label: 'Docs', to: '/docs' },
      { label: 'Install', to: '/docs/install' },
      { label: 'Changelog', to: '/changelog' },
      { label: 'Why Flytower?', to: '/why-flytower' },
    ],
  },
  {
    label: 'Community',
    children: [
      { label: 'GitHub', to: site.repo, target: '_blank' },
      ...(site.discord ? [{ label: 'Discord', to: site.discord, target: '_blank' }] : []),
      { label: 'Sponsor', to: '/sponsor' },
      { label: 'Advertise', to: '/advertise' },
    ],
  },
  {
    label: 'Legal',
    children: [
      { label: 'Privacy', to: '/legal/privacy' },
      { label: 'Terms', to: '/legal/terms' },
      { label: 'Sponsorship terms', to: '/legal/sponsorship' },
      { label: 'Advertising policy', to: '/legal/advertising' },
      { label: 'Accessibility', to: '/legal/accessibility' },
      { label: 'Minecraft notice', to: '/legal/minecraft' },
    ],
  },
]
</script>

<template>
  <USeparator class="h-px" />
  <UFooter :ui="{ top: 'border-b border-default' }">
    <template #top>
      <UContainer>
        <UFooterColumns :columns="columns" />
      </UContainer>
    </template>

    <template #left>
      <div class="text-sm text-muted">
        <p>
          Flytower is free software under the
          <ULink :to="`${site.repo}/blob/main/LICENSE`" target="_blank" class="underline"
            >AGPL-3.0</ULink
          >.
        </p>
        <p>
          <ULink to="/legal/minecraft" class="hover:text-default">
            Flytower is not an official Minecraft product. It is not approved by or associated with
            Mojang or Microsoft.
          </ULink>
        </p>
      </div>
    </template>
  </UFooter>
</template>
