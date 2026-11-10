<script setup lang="ts">
const site = useAppConfig().site
useSeoMeta({
  title: 'Sponsor',
  description: 'Flytower is free. Sponsors pay for the time it takes to build and look after it.',
})

const tiers = [
  { title: 'Supporter', price: '£3', description: 'Your name in the thanks list of each release.' },
  { title: 'Backer', price: '£10', description: 'Your name on this page.' },
  { title: 'Company', price: '£50', description: 'A small logo on this page and in the README.' },
  {
    title: 'Partner',
    price: '£200',
    description:
      'Your logo on the home page. Hosting companies are listed as “Tested on” once Flytower is checked on their VPS.',
  },
]
</script>

<template>
  <UContainer class="py-12">
    <UPageHeader
      title="Sponsor Flytower"
      description="Flytower is free software, written and maintained by one person in their spare time. Sponsorship pays for that time, test machines and the domain, and keeps the panel free of ads and nags."
    />

    <UPageGrid class="mt-10 lg:grid-cols-4">
      <UPageCard v-for="t in tiers" :key="t.title" :title="t.title" variant="subtle">
        <template #description>
          <p class="font-display text-3xl text-highlighted">
            {{ t.price
            }}<span class="font-sans text-sm font-normal normal-case text-muted"> a month</span>
          </p>
          <p class="mt-2">{{ t.description }}</p>
        </template>
        <template #footer>
          <UButton :to="site.sponsors" target="_blank" block>Sponsor on GitHub</UButton>
        </template>
      </UPageCard>
    </UPageGrid>

    <UPageCard
      class="mt-6"
      title="Prefer a one-off donation?"
      description="Any amount helps. GitHub Sponsors takes one-time payments, and Ko-fi works without a GitHub account. Donors are only listed if they ask to be."
      orientation="horizontal"
      variant="outline"
    >
      <div class="flex flex-wrap gap-2 lg:justify-end">
        <UButton
          :to="site.sponsors + '?frequency=one-time'"
          target="_blank"
          color="neutral"
          variant="outline"
          icon="i-simple-icons-githubsponsors"
          >One-time on GitHub</UButton
        >
        <UButton
          v-if="site.kofi"
          :to="site.kofi"
          target="_blank"
          color="neutral"
          variant="outline"
          icon="i-simple-icons-kofi"
          >Ko-fi</UButton
        >
      </div>
    </UPageCard>

    <UPageSection
      title="Sponsors"
      description="Thank you to everyone who keeps Flytower going."
      :ui="{ container: 'px-0 sm:px-0 lg:px-0' }"
    >
      <p class="text-center text-muted">No sponsors yet. Be the first.</p>
    </UPageSection>

    <p class="text-sm text-muted">
      Sponsors never buy what the docs say, or a place in any list of recommendations. See the
      <ULink to="/legal/sponsorship" class="text-primary">sponsorship terms</ULink>.
    </p>
  </UContainer>
</template>
