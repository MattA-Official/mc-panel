<script setup lang="ts">
useHead({ title: 'Your account' })
</script>

<template>
  <UDashboardPanel id="account">
    <template #header>
      <UDashboardNavbar title="Your account" />
    </template>
    <template #body>
      <div class="mx-auto w-full max-w-5xl space-y-6">
        <AccountProfile />
        <AccountSecurity />
        <AccountSessions />
      </div>
    </template>
  </UDashboardPanel>
</template>
