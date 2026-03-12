/**
 * API abstraction layer.
 * Currently uses Electron IPC. In the future, a web (REST) adapter
 * can be added without changing any component code.
 */

import type {
  Account,
  AccountFormData,
  Folder,
  Message,
  MessageListItem,
  MessageFlags,
  MessageFilters,
  AiClassification,
  AiConfig
} from '../../shared/types'

export interface MailApi {
  accounts: {
    list(): Promise<Account[]>
    create(data: AccountFormData): Promise<Account>
    update(id: number, data: Partial<AccountFormData>): Promise<Account>
    delete(id: number): Promise<void>
    test(data: AccountFormData): Promise<{ success: boolean; error?: string }>
  }
  folders: {
    list(accountId: number): Promise<Folder[]>
    sync(accountId: number): Promise<Folder[]>
  }
  messages: {
    list(folderId: number, page?: number, limit?: number, filters?: MessageFilters): Promise<MessageListItem[]>
    count(folderId: number, filters?: MessageFilters): Promise<number>
    get(messageId: number): Promise<Message>
    sync(folderId: number): Promise<void>
    setFlags(messageId: number, flags: Partial<MessageFlags>): Promise<void>
    move(messageId: number, targetFolderId: number): Promise<void>
    delete(messageId: number): Promise<void>
  }
  sync: {
    fullAccount(accountId: number, inboxOnly?: boolean): Promise<{ foldersCount: number; messagesCount: number }>
  }
  import: {
    scan(path?: string): Promise<unknown[]>
    defaultPaths(): Promise<string[]>
    run(accountId: number, mboxFiles: unknown[]): Promise<{ totalImported: number; duplicatesSkipped: number; foldersCreated: number }>
  }
  ai: {
    classify(messageId: number): Promise<AiClassification>
    summarize(messageId: number): Promise<string>
    search(query: string, accountId?: number): Promise<MessageListItem[]>
    getConfig(): Promise<AiConfig | null>
    setConfig(config: Omit<AiConfig, 'id'>): Promise<AiConfig>
  }
}

function isElectron(): boolean {
  return typeof window !== 'undefined' && typeof window.electronAPI !== 'undefined'
}

function createElectronApi(): MailApi {
  const api = window.electronAPI
  return {
    accounts: api.accounts,
    folders: api.folders,
    messages: api.messages,
    sync: api.sync,
    import: api.import,
    ai: api.ai
  } as MailApi
}

// Placeholder for future web API
function createWebApi(): MailApi {
  throw new Error('Web API not yet implemented. Please run in Electron.')
}

export const api: MailApi = isElectron() ? createElectronApi() : createWebApi()

// Also export individual sections for convenience
export const accountsApi = isElectron() ? window.electronAPI.accounts : null
export const foldersApi = isElectron() ? window.electronAPI.folders : null
export const messagesApi = isElectron() ? window.electronAPI.messages : null
export const syncApi = isElectron() ? window.electronAPI.sync : null
export const importApi = isElectron() ? window.electronAPI.import : null
export const aiApi = isElectron() ? window.electronAPI.ai : null
