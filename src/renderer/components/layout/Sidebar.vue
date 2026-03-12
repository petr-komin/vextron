<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAccountsStore } from '../../stores/accounts'
import { useFoldersStore } from '../../stores/folders'
import type { Account, Folder, FolderType } from '../../../shared/types'
import Button from 'primevue/button'
import Badge from 'primevue/badge'
import AccountEditDialog from '../AccountEditDialog.vue'

const router = useRouter()
const accountsStore = useAccountsStore()
const foldersStore = useFoldersStore()

const editDialogVisible = ref(false)
const editingAccount = ref<Account | null>(null)

function openEditDialog(account: Account, event: Event): void {
  event.stopPropagation()
  editingAccount.value = account
  editDialogVisible.value = true
}

function onAccountDeleted(_accountId: number): void {
  editDialogVisible.value = false
  editingAccount.value = null
}

const folderIcons: Record<FolderType, string> = {
  inbox: 'pi pi-inbox',
  sent: 'pi pi-send',
  drafts: 'pi pi-file-edit',
  trash: 'pi pi-trash',
  spam: 'pi pi-ban',
  archive: 'pi pi-box',
  custom: 'pi pi-folder'
}

function folderIcon(type: FolderType): string {
  return folderIcons[type] || 'pi pi-folder'
}

function selectFolder(folder: Folder): void {
  foldersStore.setActiveFolder(folder.id)
}

function isActive(folderId: number): boolean {
  return foldersStore.activeFolderId === folderId
}

// When active account changes, load its folders (from DB first, then sync from IMAP)
watch(
  () => accountsStore.activeAccountId,
  async (accountId) => {
    if (!accountId) return

    const existing = foldersStore.getFolders(accountId)
    if (existing.length === 0) {
      // No cached folders — sync from IMAP
      try {
        await foldersStore.syncFolders(accountId)
      } catch (error) {
        console.error('Failed to sync folders:', error)
        // Fallback: try loading from DB
        await foldersStore.fetchFolders(accountId)
      }
    }

    // Auto-select inbox
    const inbox = foldersStore.getInbox(accountId)
    if (inbox && !foldersStore.activeFolderId) {
      foldersStore.setActiveFolder(inbox.id)
    }
  },
  { immediate: true }
)
</script>

<template>
  <nav class="sidebar vx-no-select">
    <!-- Account sections -->
    <div
      v-for="account in accountsStore.accounts"
      :key="account.id"
      class="account-section"
    >
      <div
        class="account-header"
        :class="{ active: accountsStore.activeAccountId === account.id }"
        @click="accountsStore.setActiveAccount(account.id)"
      >
        <span
          class="account-dot"
          :style="{ backgroundColor: account.color }"
        />
        <span class="account-name vx-truncate">{{ account.name }}</span>
        <button
          class="account-edit-btn"
          @click="openEditDialog(account, $event)"
          title="Edit account"
        >
          <i class="pi pi-cog" />
        </button>
      </div>

      <!-- Folders for this account -->
      <div
        v-if="accountsStore.activeAccountId === account.id"
        class="folder-list"
      >
        <div v-if="foldersStore.loading" class="folder-loading">
          <i class="pi pi-spin pi-spinner" />
          <span>Loading folders...</span>
        </div>
        <div
          v-for="folder in foldersStore.getFolders(account.id)"
          :key="folder.id"
          class="folder-item"
          :class="{ active: isActive(folder.id) }"
          @click="selectFolder(folder)"
        >
          <i :class="folderIcon(folder.type)" class="folder-icon" />
          <span class="folder-name vx-truncate">{{ folder.name }}</span>
          <Badge
            v-if="folder.unreadCount > 0"
            :value="folder.unreadCount"
            severity="info"
            class="folder-badge"
          />
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-if="!accountsStore.hasAccounts" class="sidebar-empty">
      <p>No accounts configured</p>
      <Button
        label="Add Account"
        icon="pi pi-plus"
        size="small"
        @click="router.push({ name: 'account-setup' })"
      />
    </div>

    <!-- Bottom: Add account button -->
    <div class="sidebar-footer" v-if="accountsStore.hasAccounts">
      <Button
        icon="pi pi-plus"
        label="Add Account"
        severity="secondary"
        text
        size="small"
        class="add-account-btn"
        @click="router.push({ name: 'account-setup' })"
      />
    </div>

    <!-- Account edit dialog (inside nav root — PrimeVue Dialog teleports to body anyway) -->
    <AccountEditDialog
      v-model:visible="editDialogVisible"
      :account="editingAccount"
      @deleted="onAccountDeleted"
    />
  </nav>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 8px 0;
}

.account-section {
  margin-bottom: 4px;
}

.account-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  font-weight: 600;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--vx-text-secondary);
  transition: background-color 0.15s;
}

.account-header:hover {
  background-color: var(--vx-bg-hover);
}

.account-header.active {
  color: var(--vx-text-primary);
}

.account-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.account-name {
  flex: 1;
}

.account-edit-btn {
  background: none;
  border: none;
  color: var(--vx-text-muted);
  cursor: pointer;
  padding: 2px;
  font-size: 11px;
  opacity: 0;
  transition: opacity 0.15s, color 0.15s;
  flex-shrink: 0;
}

.account-header:hover .account-edit-btn {
  opacity: 1;
}

.account-edit-btn:hover {
  color: var(--vx-accent);
}

.folder-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 28px;
  font-size: 12px;
  color: var(--vx-text-muted);
}

.folder-list {
  padding: 2px 0;
}

.folder-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px 6px 28px;
  cursor: pointer;
  color: var(--vx-text-secondary);
  transition: all 0.15s;
  font-size: 13px;
}

.folder-item:hover {
  background-color: var(--vx-bg-hover);
  color: var(--vx-text-primary);
}

.folder-item.active {
  background-color: var(--vx-bg-tertiary);
  color: var(--vx-text-primary);
  border-left: 2px solid var(--vx-accent);
  padding-left: 26px;
}

.folder-icon {
  font-size: 14px;
  width: 18px;
  text-align: center;
  flex-shrink: 0;
}

.folder-name {
  flex: 1;
}

.folder-badge {
  font-size: 10px;
}

.sidebar-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 24px;
  color: var(--vx-text-muted);
  flex: 1;
}

.sidebar-footer {
  margin-top: auto;
  padding: 8px 12px;
  border-top: 1px solid var(--vx-border);
}

.add-account-btn {
  width: 100%;
  justify-content: flex-start;
}
</style>
