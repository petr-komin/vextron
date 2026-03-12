<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAccountsStore } from './stores/accounts'
import Toast from 'primevue/toast'

const router = useRouter()
const accountsStore = useAccountsStore()

onMounted(async () => {
  try {
    await accountsStore.fetchAccounts()
    if (!accountsStore.hasAccounts) {
      router.push({ name: 'account-setup' })
    }
  } catch {
    // DB not available — stay on setup page
    console.warn('Could not connect to database, showing setup')
    router.push({ name: 'account-setup' })
  }
})
</script>

<template>
  <Toast position="bottom-right" />
  <router-view />
</template>

<style>
/* App-level style overrides if needed */
</style>
