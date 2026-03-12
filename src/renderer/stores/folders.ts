import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Folder } from '../../shared/types'

export const useFoldersStore = defineStore('folders', () => {
  /** All folders keyed by accountId */
  const foldersByAccount = ref<Map<number, Folder[]>>(new Map())
  const activeFolderId = ref<number | null>(null)
  /** True while loading folders from DB (blocking — shows spinner) */
  const loading = ref(false)
  /** True while syncing folders from IMAP (background — non-blocking) */
  const syncing = ref(false)

  const activeFolder = computed((): Folder | null => {
    for (const folders of foldersByAccount.value.values()) {
      const found = folders.find((f) => f.id === activeFolderId.value)
      if (found) return found
    }
    return null
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

  function setActiveFolder(folderId: number): void {
    activeFolderId.value = folderId
  }

  return {
    foldersByAccount,
    activeFolderId,
    activeFolder,
    loading,
    syncing,
    getFolders,
    getInbox,
    fetchFolders,
    syncFolders,
    setActiveFolder
  }
})
