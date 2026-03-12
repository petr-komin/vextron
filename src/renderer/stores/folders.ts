import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Folder, FolderType } from '../../shared/types'

/** Virtual folder IDs for unified views */
export const UNIFIED_INBOX = 'unified-inbox' as const
export const UNIFIED_SENT = 'unified-sent' as const
export type UnifiedFolderId = typeof UNIFIED_INBOX | typeof UNIFIED_SENT

/** Active folder can be a real numeric folder ID or a unified virtual ID */
export type ActiveFolderId = number | UnifiedFolderId | null

export function isUnifiedFolder(id: ActiveFolderId): id is UnifiedFolderId {
  return id === UNIFIED_INBOX || id === UNIFIED_SENT
}

/** Map unified folder ID → folder type for DB queries */
export function unifiedFolderType(id: UnifiedFolderId): FolderType {
  return id === UNIFIED_INBOX ? 'inbox' : 'sent'
}

export const useFoldersStore = defineStore('folders', () => {
  /** All folders keyed by accountId */
  const foldersByAccount = ref<Map<number, Folder[]>>(new Map())
  const activeFolderId = ref<ActiveFolderId>(null)
  /** True while loading folders from DB (blocking — shows spinner) */
  const loading = ref(false)
  /** True while syncing folders from IMAP (background — non-blocking) */
  const syncing = ref(false)

  const activeFolder = computed((): Folder | null => {
    if (isUnifiedFolder(activeFolderId.value)) return null
    for (const folders of foldersByAccount.value.values()) {
      const found = folders.find((f) => f.id === activeFolderId.value)
      if (found) return found
    }
    return null
  })

  /** Label for the active folder (works for both real and unified) */
  const activeFolderName = computed((): string => {
    if (activeFolderId.value === UNIFIED_INBOX) return 'Inbox'
    if (activeFolderId.value === UNIFIED_SENT) return 'Sent'
    return activeFolder.value?.name ?? ''
  })

  function getFolders(accountId: number): Folder[] {
    return foldersByAccount.value.get(accountId) ?? []
  }

  function getInbox(accountId: number): Folder | undefined {
    return getFolders(accountId).find((f) => f.type === 'inbox')
  }

  async function fetchFolders(accountId: number): Promise<void> {
    loading.value = true
    try {
      const folders = await window.electronAPI.folders.list(accountId)
      foldersByAccount.value.set(accountId, folders)
    } catch (error) {
      console.error(`Failed to fetch folders for account ${accountId}:`, error)
    } finally {
      loading.value = false
    }
  }

  async function syncFolders(accountId: number): Promise<void> {
    syncing.value = true
    try {
      const folders = await window.electronAPI.folders.sync(accountId)
      foldersByAccount.value.set(accountId, folders)
    } catch (error) {
      console.error(`Failed to sync folders for account ${accountId}:`, error)
      throw error
    } finally {
      syncing.value = false
    }
  }

  function setActiveFolder(folderId: ActiveFolderId): void {
    activeFolderId.value = folderId
  }

  return {
    foldersByAccount,
    activeFolderId,
    activeFolder,
    activeFolderName,
    loading,
    syncing,
    getFolders,
    getInbox,
    fetchFolders,
    syncFolders,
    setActiveFolder
  }
})
