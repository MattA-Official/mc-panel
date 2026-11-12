<script setup lang="ts">
// The mailing list sign-up in the footer. Until the sign-up endpoint is live
// (app.config `site.newsletter`), the form shows but can't be sent.
const site = useAppConfig().site
const open = site.newsletter
const email = ref('')
</script>

<template>
  <section aria-labelledby="newsletter-heading" class="max-w-sm">
    <h2 id="newsletter-heading" class="text-sm font-semibold">Mailing list</h2>
    <p class="mt-2 text-sm text-muted">
      Occasional news about Flytower releases. No tracking, and you can unsubscribe at any time.
    </p>

    <form class="mt-4 flex gap-2" @submit.prevent>
      <label for="newsletter-email" class="sr-only">Email address</label>
      <UInput
        id="newsletter-email"
        v-model="email"
        type="email"
        name="email"
        autocomplete="email"
        placeholder="you@example.com"
        required
        :disabled="!open"
        class="min-w-0 flex-1"
      />
      <UButton type="submit" label="Subscribe" :disabled="!open" />
    </form>

    <p class="mt-3 text-xs text-dimmed">
      <template v-if="open">
        We only keep your email address. See the
        <ULink to="/legal/privacy" class="underline hover:text-default">privacy policy</ULink>.
      </template>
      <template v-else>Sign-ups open soon.</template>
    </p>
  </section>
</template>
