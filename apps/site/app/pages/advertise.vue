<script setup lang="ts">
const site = useAppConfig().site
useSeoMeta({ title: 'Advertise', description: 'One quiet, labelled ad slot in the Flytower docs.' })
</script>

<template>
  <UContainer class="max-w-3xl py-12">
    <UPageHeader
      title="Advertise on Flytower"
      description="The Flytower docs are read by people who run their own Minecraft servers on a VPS: club and society admins, groups of friends and small communities."
    />

    <div class="mt-8 space-y-6">
      <UPageCard title="What you get" variant="subtle">
        <template #description>
          <ul class="list-disc space-y-1 pl-5">
            <li>One text-and-image ad in the docs sidebar, below the table of contents.</li>
            <li>Labelled “Ad”, with no animation and no tracking.</li>
            <li>
              Never on the home page, the install guide or the sponsor page, and never inside the
              panel itself.
            </li>
          </ul>
        </template>
      </UPageCard>

      <UPageCard title="What we accept" variant="subtle">
        <template #description>
          <p>
            Hosting, developer tools and services that are useful to server owners. No gambling,
            crypto, adult content, or anything aimed at children. See the
            <ULink to="/legal/advertising" class="text-primary">advertising policy</ULink>.
          </p>
        </template>
      </UPageCard>

      <UPageCard title="Get in touch" variant="outline">
        <template #description>
          <p>
            Email
            <ULink :to="`mailto:${site.email.hello}`" class="text-primary">{{
              site.email.hello
            }}</ULink>
            with what you would like to show. Hosting companies may prefer to
            <ULink to="/sponsor" class="text-primary">sponsor</ULink> instead.
          </p>
        </template>
      </UPageCard>
    </div>
  </UContainer>
</template>
