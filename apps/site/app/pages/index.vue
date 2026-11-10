<script setup lang="ts">
const site = useAppConfig().site
useSeoMeta({ title: site.name, description: site.tagline })

const features = [
  {
    icon: 'i-lucide-terminal-square',
    title: 'One install, then the browser',
    description:
      'A single command sets up the panel on a fresh Ubuntu or Debian VPS. Java, servers, mods and datapacks are all managed from the browser after that, and you sign in with a passkey.',
  },
  {
    icon: 'i-lucide-file-code-2',
    title: 'Specs, not scripts',
    description:
      'Each server is a short YAML spec. Edit it as a form or paste the YAML, see what will change, then apply it.',
  },
  {
    icon: 'i-lucide-shield-check',
    title: 'Trusted sources, no lock-in',
    description:
      'Mojang, Fabric, PaperMC, Modrinth, Hangar and Vanilla Tweaks are built in. Every server folder is an ordinary server folder that still runs without Flytower.',
  },
  {
    icon: 'i-lucide-server',
    title: 'Many servers per box',
    description:
      'Each server gets its own user, folder, memory limit, port and hostname, so a survival world and a test server can share one machine safely.',
  },
  {
    icon: 'i-lucide-life-buoy',
    title: 'Looked after',
    description:
      'Scheduled backups with off-site copies, performance history, an activity log, notifications to Discord or ntfy, and signed self-updates that roll back if they fail.',
  },
  {
    icon: 'i-lucide-eye-off',
    title: 'Yours, not ours',
    description:
      'Flytower runs on your VPS and has no telemetry. It is free software under the AGPL-3.0, so you can read, change and share every line.',
  },
]

const parts = [
  {
    title: 'The panel',
    description:
      'The web app. It runs as an unprivileged user, listens only on localhost, and Caddy puts it on HTTPS with your domain.',
  },
  {
    title: 'The agent',
    description:
      'A small root helper that does a fixed list of jobs over a Unix socket: creating server users and folders, systemd units, Java, firewall ports and updates.',
  },
  {
    title: 'Your servers',
    description:
      'Each runs as its own user from its own folder under systemd, with a fixed memory limit. Nothing about them depends on Flytower.',
  },
]
</script>

<template>
  <div>
    <UPageHero
      :description="
        site.tagline +
        ' Install it once, then create, configure and look after any number of servers without SSH.'
      "
      orientation="vertical"
      :links="[
        { label: 'Install Flytower', to: '/docs/install', icon: 'i-lucide-download', size: 'xl' },
        {
          label: 'Read the docs',
          to: '/docs',
          color: 'neutral',
          variant: 'subtle',
          size: 'xl',
          trailingIcon: 'i-lucide-arrow-right',
        },
      ]"
    >
      <template #title>
        <span class="font-display block text-5xl sm:text-7xl">Your servers.</span>
        <span class="font-display block text-5xl text-primary sm:text-7xl">Your box.</span>
      </template>
      <div class="flex flex-col items-center gap-2">
        <InstallCommand />
        <p class="text-sm text-muted">
          Ubuntu 24.04+ or Debian 12+, amd64 or arm64.
          <ULink to="/docs/install" class="text-primary">Installer options</ULink>
        </p>
      </div>
    </UPageHero>

    <UPageSection
      title="Everything a small community server needs"
      description="Built for clubs, societies and groups of friends who want a proper panel on a VPS they control."
    >
      <UPageGrid>
        <UPageCard
          v-for="f in features"
          :key="f.title"
          :icon="f.icon"
          :title="f.title"
          :description="f.description"
          variant="subtle"
        />
      </UPageGrid>
    </UPageSection>

    <UPageSection
      title="How it fits together"
      description="Three parts, each doing one job. If Flytower stopped tomorrow, your servers would carry on."
    >
      <UPageColumns class="md:columns-3">
        <UPageCard
          v-for="(p, i) in parts"
          :key="p.title"
          :title="`${i + 1}. ${p.title}`"
          :description="p.description"
        />
      </UPageColumns>
    </UPageSection>

    <UPageSection>
      <UPageCTA
        title="Why “Flytower”?"
        description="A theatre's fly tower is the tall space above the stage where scenery hangs, ready to fly in on cue. Read where the name comes from."
        :links="[
          {
            label: 'Read the story',
            to: '/why-flytower',
            trailingIcon: 'i-lucide-arrow-right',
            color: 'neutral',
            variant: 'subtle',
          },
        ]"
        variant="soft"
      />
    </UPageSection>

    <UPageSection
      title="Sponsors"
      description="Flytower is free. Sponsors pay for the time it takes to build and maintain it."
    >
      <div class="flex flex-col items-center gap-4 text-center">
        <p class="text-muted">No sponsors yet. Your logo could be the first here.</p>
        <UButton to="/sponsor" icon="i-lucide-heart" color="neutral" variant="outline"
          >Become a sponsor</UButton
        >
      </div>
    </UPageSection>
  </div>
</template>
