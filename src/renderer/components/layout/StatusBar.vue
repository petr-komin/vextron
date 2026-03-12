<script setup lang="ts">
import { computed } from 'vue'
import { useAccountsStore } from '../../stores/accounts'
import { useMessagesStore } from '../../stores/messages'

const accountsStore = useAccountsStore()
const messagesStore = useMessagesStore()

const connectedCount = computed(() =>
  accountsStore.accounts.filter((a) => a.isActive).length
)
</script>

<template>
  <footer class="status-bar vx-no-select">
    <div class="status-left">
      <span class="status-item">
        <i class="pi pi-link" style="font-size: 10px" />
        {{ connectedCount }} account{{ connectedCount !== 1 ? 's' : '' }}
      </span>
    </div>
    <div class="status-center">
      <span v-if="messagesStore.unreadCount > 0" class="status-item status-unread">
        {{ messagesStore.unreadCount }} unread
      </span>
    </div>
    <div class="status-right">
      <span class="status-item">
        <i class="pi pi-sparkles" style="font-size: 10px" />
        AI: Standby
      </span>
    </div>
  </footer>
</template>

<style scoped>
.status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  height: 100%;
  font-size: 11px;
  color: var(--vx-text-muted);
}

.status-left,
.status-center,
.status-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.status-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.status-unread {
  color: var(--vx-accent);
  font-weight: 600;
}
</style>
