<script setup lang="ts">
useHead({ title: 'People' })
</script>

<template>
  <UDashboardPanel id="people">
    <template #header>
      <UDashboardNavbar title="People" />
    </template>
    <template #body>
      <div class="mx-auto w-full max-w-5xl space-y-6">
        <PeopleList />
      </div>
    </template>
  </UDashboardPanel>
</template>
