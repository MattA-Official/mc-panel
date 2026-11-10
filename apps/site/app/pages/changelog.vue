<script setup lang="ts">
const site = useAppConfig().site
useSeoMeta({ title: 'Changelog', description: 'Every Flytower release, newest first.' })

interface Release {
  tag_name: string
  name: string | null
  body: string | null
  html_url: string
  published_at: string
  prerelease: boolean
  draft: boolean
}

// Fetched once at build time and saved in the prerendered page; visitors never call GitHub.
const { data: releases } = await useAsyncData('releases', async () => {
  const headers: Record<string, string> = { accept: 'application/vnd.github+json' }
  const token = import.meta.server ? process.env.GITHUB_TOKEN : undefined
  if (token) headers.authorization = `Bearer ${token}`
  const list = await $fetch<Release[]>(
    'https://api.github.com/repos/MattA-Official/mc-panel/releases',
    {
      query: { per_page: 50 },
      headers,
    },
  )
  return list
    .filter((r) => !r.draft)
    .map((r) => ({
      version: r.tag_name.replace(/^v/, ''),
      date: r.published_at,
      url: r.html_url,
      beta: r.prerelease,
      body: (r.body ?? '').trim(),
    }))
})
</script>

<template>
  <UContainer class="py-12">
    <UPageHeader
      title="Changelog"
      description="Every Flytower release, newest first. Betas are previews of the next version for people on the Beta update channel."
    >
      <template #links>
        <UButton
          :to="site.releases"
          target="_blank"
          color="neutral"
          variant="outline"
          icon="i-simple-icons-github"
          >All releases on GitHub</UButton
        >
      </template>
    </UPageHeader>

    <UChangelogVersions class="mt-10">
      <UChangelogVersion
        v-for="r in releases ?? []"
        :key="r.version"
        :title="r.version"
        :date="r.date"
        :badge="
          r.beta
            ? { label: 'Beta', color: 'warning', variant: 'subtle' }
            : { label: 'Stable', color: 'success', variant: 'subtle' }
        "
        :to="r.url"
        target="_blank"
      >
        <template #body>
          <MDC v-if="r.body" :value="r.body" tag="div" class="prose-sm" />
        </template>
      </UChangelogVersion>
    </UChangelogVersions>
  </UContainer>
</template>
