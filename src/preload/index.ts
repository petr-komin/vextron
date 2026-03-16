import { contextBridge, ipcRenderer } from 'electron'
import type {
  AccountFormData,
  MessageFlags,
  MessageFilters,
  FolderType,
  AiBlacklistPatternType,
  ComposeMailData
} from '../shared/types'

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
    delete: (messageId: number) => ipcRenderer.invoke('messages:delete', messageId),
    listAnalyzed: () => ipcRenderer.invoke('messages:listAnalyzed')
  },

  // ── Sync ────────────────────────────────────────────────────────────────
  sync: {
    fullAccount: (accountId: number, inboxOnly: boolean = true) =>
      ipcRenderer.invoke('sync:fullAccount', accountId, inboxOnly)
  },

  // ── AI ──────────────────────────────────────────────────────────────────
  ai: {
    analyze: (messageId: number) => ipcRenderer.invoke('ai:analyze', messageId),
    analyzeBatch: (params: { folderId?: number; folderType?: FolderType; filters?: MessageFilters }) =>
      ipcRenderer.invoke('ai:analyzeBatch', toRaw(params)),
    search: (query: string, accountId?: number) =>
      ipcRenderer.invoke('ai:search', query, accountId),
    getConfig: () => ipcRenderer.invoke('ai:getConfig'),
    setConfig: (config: unknown) => ipcRenderer.invoke('ai:setConfig', toRaw(config)),
    blacklist: {
      list: () => ipcRenderer.invoke('ai:blacklist:list'),
      add: (pattern: string, patternType: AiBlacklistPatternType) =>
        ipcRenderer.invoke('ai:blacklist:add', pattern, patternType),
      remove: (id: number) => ipcRenderer.invoke('ai:blacklist:remove', id),
      check: (messageId: number) => ipcRenderer.invoke('ai:blacklist:check', messageId)
    }
  },

  // ── Import ──────────────────────────────────────────────────────────────
  import: {
    scan: (path?: string) => ipcRenderer.invoke('import:scan', path),
    defaultPaths: () => ipcRenderer.invoke('import:defaultPaths'),
    run: (accountId: number, mboxFiles: unknown[]) =>
      ipcRenderer.invoke('import:run', accountId, toRaw(mboxFiles))
  },

  // ── Mail (Compose & Send) ────────────────────────────────────────────
  mail: {
    send: (data: ComposeMailData) => ipcRenderer.invoke('mail:send', toRaw(data))
  },

  // ── Contacts ───────────────────────────────────────────────────────────
  contacts: {
    listFavorites: () => ipcRenderer.invoke('contacts:listFavorites'),
    add: (accountId: number, email: string, name: string) =>
      ipcRenderer.invoke('contacts:add', accountId, email, name),
    remove: (id: number) => ipcRenderer.invoke('contacts:remove', id),
    check: (accountId: number, email: string) =>
      ipcRenderer.invoke('contacts:check', accountId, email),
    messages: (email: string, page?: number, limit?: number) =>
      ipcRenderer.invoke('contacts:messages', email, page, limit),
    messagesCount: (email: string) => ipcRenderer.invoke('contacts:messagesCount', email)
  },

  // ── Attachments ────────────────────────────────────────────────────────
  attachments: {
    download: (messageId: number, partNumber: string, filename: string) =>
      ipcRenderer.invoke('attachments:download', messageId, partNumber, filename),
    open: (messageId: number, partNumber: string, filename: string) =>
      ipcRenderer.invoke('attachments:open', messageId, partNumber, filename)
  },

  // ── Avatars ────────────────────────────────────────────────────────────
  avatars: {
    resolve: (email: string) => ipcRenderer.invoke('avatars:resolve', email),
    batch: (emails: string[]) => ipcRenderer.invoke('avatars:batch', toRaw(emails))
  },

  // ── Todos ──────────────────────────────────────────────────────────────
  todos: {
    extract: (messageId: number) => ipcRenderer.invoke('todos:extract', messageId),
    list: () => ipcRenderer.invoke('todos:list'),
    toggle: (id: number, done: boolean) => ipcRenderer.invoke('todos:toggle', id, done),
    delete: (id: number) => ipcRenderer.invoke('todos:delete', id)
  },

  // ── Settings ───────────────────────────────────────────────────────────
  settings: {
    imageAllowlist: {
      list: () => ipcRenderer.invoke('settings:imageAllowlist:list'),
      add: (domain: string) => ipcRenderer.invoke('settings:imageAllowlist:add', domain),
      remove: (domain: string) => ipcRenderer.invoke('settings:imageAllowlist:remove', domain),
      check: (domain: string) => ipcRenderer.invoke('settings:imageAllowlist:check', domain)
    }
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
