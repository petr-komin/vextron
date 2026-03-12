import { contextBridge, ipcRenderer } from 'electron'
import type { AccountFormData, MessageFlags, MessageFilters, FolderType } from '../shared/types'

/**
 * Strip Vue/Pinia reactive proxies by converting to plain JSON.
 * Structured clone (used by Electron IPC) cannot handle Proxy objects.
 */
function toRaw<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

/**
 * Preload bridge — exposes safe IPC methods to the renderer.
 * This is the only way for the Vue.js frontend to communicate
 * with the Electron main process.
 */
const api = {
  // ── Accounts ────────────────────────────────────────────────────────────
  accounts: {
    list: () => ipcRenderer.invoke('accounts:list'),
    create: (data: AccountFormData) => {
      return ipcRenderer.invoke('accounts:create', toRaw(data))
    },
    update: (id: number, data: Partial<AccountFormData>) =>
      ipcRenderer.invoke('accounts:update', id, toRaw(data)),
    delete: (id: number) => ipcRenderer.invoke('accounts:delete', id),
    test: (data: AccountFormData) => {
      return ipcRenderer.invoke('accounts:test', toRaw(data))
    }
  },

  // ── Folders ─────────────────────────────────────────────────────────────
  folders: {
    list: (accountId: number) => ipcRenderer.invoke('folders:list', accountId),
    sync: (accountId: number) => ipcRenderer.invoke('folders:sync', accountId)
  },

  // ── Messages ────────────────────────────────────────────────────────────
  messages: {
    list: (folderId: number, page?: number, limit?: number, filters?: MessageFilters) =>
      ipcRenderer.invoke('messages:list', folderId, page, limit, filters ? toRaw(filters) : undefined),
    count: (folderId: number, filters?: MessageFilters) =>
      ipcRenderer.invoke('messages:count', folderId, filters ? toRaw(filters) : undefined),
    listUnified: (folderType: FolderType, page?: number, limit?: number, filters?: MessageFilters) =>
      ipcRenderer.invoke('messages:listUnified', folderType, page, limit, filters ? toRaw(filters) : undefined),
    countUnified: (folderType: FolderType, filters?: MessageFilters) =>
      ipcRenderer.invoke('messages:countUnified', folderType, filters ? toRaw(filters) : undefined),
    get: (messageId: number) => ipcRenderer.invoke('messages:get', messageId),
    sync: (folderId: number) => ipcRenderer.invoke('messages:sync', folderId),
    setFlags: (messageId: number, flags: Partial<MessageFlags>) =>
      ipcRenderer.invoke('messages:setFlags', messageId, toRaw(flags)),
    move: (messageId: number, targetFolderId: number) =>
      ipcRenderer.invoke('messages:move', messageId, targetFolderId),
    delete: (messageId: number) => ipcRenderer.invoke('messages:delete', messageId)
  },

  // ── Sync ────────────────────────────────────────────────────────────────
  sync: {
    fullAccount: (accountId: number, inboxOnly: boolean = true) =>
      ipcRenderer.invoke('sync:fullAccount', accountId, inboxOnly)
  },

  // ── AI ──────────────────────────────────────────────────────────────────
  ai: {
    classify: (messageId: number) => ipcRenderer.invoke('ai:classify', messageId),
    summarize: (messageId: number) => ipcRenderer.invoke('ai:summarize', messageId),
    search: (query: string, accountId?: number) =>
      ipcRenderer.invoke('ai:search', query, accountId),
    getConfig: () => ipcRenderer.invoke('ai:getConfig'),
    setConfig: (config: unknown) => ipcRenderer.invoke('ai:setConfig', toRaw(config))
  },

  // ── Import ──────────────────────────────────────────────────────────────
  import: {
    scan: (path?: string) => ipcRenderer.invoke('import:scan', path),
    defaultPaths: () => ipcRenderer.invoke('import:defaultPaths'),
    run: (accountId: number, mboxFiles: unknown[]) =>
      ipcRenderer.invoke('import:run', accountId, toRaw(mboxFiles))
  },

  // ── Events (main → renderer) ───────────────────────────────────────────
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const validChannels = [
      'account:status',
      'sync:progress',
      'sync:complete',
      'notification:new-mail',
      'import:progress'
    ]
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (_event, ...args) => callback(...args))
    }
  },

  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel)
  }
}

export type ElectronApi = typeof api

contextBridge.exposeInMainWorld('electronAPI', api)
