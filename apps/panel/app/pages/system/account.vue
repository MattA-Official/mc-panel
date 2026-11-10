<script setup lang="ts">
useHead({ title: 'Account and security' })
const can = useCan()
</script>

<template>
  <AccountSecurity />
  <SshAccess v-if="can('system.manage')" />
</template>
