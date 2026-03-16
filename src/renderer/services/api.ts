/**
 * API abstraction layer.
 * Currently uses Electron IPC. In the future, a web (REST) adapter
 * can be added without changing any component code.
 */

import type {
  Account,
  AccountFormData,
  Folder,
  FolderType,
  Message,
  MessageListItem,
  MessageFlags,
  MessageFilters,
  AiClassification,
  AiBatchResult,
  AiConfig,
  AiBlacklistRule,
  AiBlacklistPatternType,
  ImageAllowlistEntry,
  AnalyzedMessageItem,
  SemanticSearchResult,
  ComposeMailData,
  SendMailResult,
  Contact,
  AttachmentSaveResult,
  AvatarResult
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
    listUnified(folderType: FolderType, page?: number, limit?: number, filters?: MessageFilters): Promise<MessageListItem[]>
    countUnified(folderType: FolderType, filters?: MessageFilters): Promise<number>
    get(messageId: number): Promise<Message>
    sync(folderId: number): Promise<void>
    setFlags(messageId: number, flags: Partial<MessageFlags>): Promise<void>
    move(messageId: number, targetFolderId: number): Promise<void>
    delete(messageId: number): Promise<void>
    listAnalyzed(): Promise<AnalyzedMessageItem[]>
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
    analyze(messageId: number): Promise<AiClassification>
    analyzeBatch(params: { folderId?: number; folderType?: FolderType; filters?: MessageFilters }): Promise<AiBatchResult>
    search(query: string, accountId?: number): Promise<SemanticSearchResult[]>
    getConfig(): Promise<AiConfig | null>
    setConfig(config: Omit<AiConfig, 'id'>): Promise<AiConfig>
    blacklist: {
      list(): Promise<AiBlacklistRule[]>
      add(pattern: string, patternType: AiBlacklistPatternType): Promise<AiBlacklistRule>
      remove(id: number): Promise<void>
      check(messageId: number): Promise<boolean>
    }
  }
  settings: {
    imageAllowlist: {
      list(): Promise<ImageAllowlistEntry[]>
      add(domain: string): Promise<void>
      remove(domain: string): Promise<void>
      check(domain: string): Promise<boolean>
    }
  }
  mail: {
    send(data: ComposeMailData): Promise<SendMailResult>
  }
  contacts: {
    listFavorites(): Promise<Contact[]>
    add(accountId: number, email: string, name: string): Promise<Contact>
    remove(id: number): Promise<void>
    check(accountId: number, email: string): Promise<boolean>
    messages(email: string, page?: number, limit?: number): Promise<MessageListItem[]>
    messagesCount(email: string): Promise<number>
  }
  attachments: {
    download(messageId: number, partNumber: string, filename: string): Promise<AttachmentSaveResult>
    open(messageId: number, partNumber: string, filename: string): Promise<AttachmentSaveResult>
  }
  avatars: {
    resolve(email: string): Promise<AvatarResult>
    batch(emails: string[]): Promise<Record<string, AvatarResult>>
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
    ai: api.ai,
    settings: api.settings,
    mail: api.mail,
    contacts: api.contacts,
    attachments: api.attachments,
    avatars: api.avatars
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
export const settingsApi = isElectron() ? window.electronAPI.settings : null
export const mailApi = isElectron() ? window.electronAPI.mail : null
export const contactsApi = isElectron() ? window.electronAPI.contacts : null
export const attachmentsApi = isElectron() ? window.electronAPI.attachments : null
