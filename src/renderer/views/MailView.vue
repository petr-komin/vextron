<script setup lang="ts">
import { onMounted, onUnmounted, ref, provide } from 'vue'
import { useMessagesStore } from '../stores/messages'
import { useFoldersStore, isUnifiedFolder } from '../stores/folders'
import AppLayout from '../components/layout/AppLayout.vue'

const messagesStore = useMessagesStore()
const foldersStore = useFoldersStore()

/** View mode: 'mail' = normal 3-panel, 'ai' = AI Overview grouped view */
const viewMode = ref<'mail' | 'ai'>('mail')
provide('viewMode', viewMode)

/**
 * Central listener for periodic sync:complete events.
 * Refreshes both folder counts (sidebar) and message list when relevant.
 */
onMounted(() => {
  window.electronAPI.on('sync:complete', (data: unknown) => {
    const { accountId } = data as { accountId: number }

    // Always refresh folder counts for the synced account
    foldersStore.fetchFolders(accountId)

    // Refresh message list if the active folder belongs to this account
    const folderId = foldersStore.activeFolderId
    if (!folderId) return

    if (isUnifiedFolder(folderId)) {
      // Unified views aggregate all accounts — any sync is relevant
      messagesStore.fetchMessages(folderId)
    } else {
      const folder = foldersStore.activeFolder
      if (folder && folder.accountId === accountId) {
        messagesStore.fetchMessages(folderId)
      }
    }
  })
})

onUnmounted(() => {
  window.electronAPI.removeAllListeners('sync:complete')
})
</script>

<template>
  <AppLayout />
</template>
