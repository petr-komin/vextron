// ─── Account types ───────────────────────────────────────────────────────────

export interface Account {
  id: number
  name: string
  email: string
  imapHost: string
  imapPort: number
  smtpHost: string
  smtpPort: number
  username: string
  password?: string // never sent to renderer, only used in main
  authType: 'password' | 'oauth2'
  security: 'tls' | 'starttls' | 'none'
  smtpSecurity: 'tls' | 'starttls' | 'none'
  isActive: boolean
  color: string
  createdAt: string
}

export interface AccountFormData {
  name: string
  email: string
  imapHost: string
  imapPort: number
  smtpHost: string
  smtpPort: number
  username: string
  password: string
  authType: 'password' | 'oauth2'
  security: 'tls' | 'starttls' | 'none'
  smtpSecurity: 'tls' | 'starttls' | 'none'
  color: string
}

// ─── Folder types ────────────────────────────────────────────────────────────

export type FolderType = 'inbox' | 'sent' | 'drafts' | 'trash' | 'spam' | 'archive' | 'custom'

export interface Folder {
  id: number
  accountId: number
  name: string
  path: string
  type: FolderType
  unreadCount: number
  totalCount: number
  delimiter: string
}

// ─── Message types ───────────────────────────────────────────────────────────

export interface EmailAddress {
  name: string
  address: string
}

export interface Message {
  id: number
  accountId: number
  folderId: number
  messageId: string
  uid: number
  subject: string
  from: EmailAddress
  to: EmailAddress[]
  cc: EmailAddress[]
  bcc: EmailAddress[]
  date: string
  bodyText: string
  bodyHtml: string
  flags: MessageFlags
  size: number
  hasAttachments: boolean
  // AI fields
  aiCategory?: string
  aiPriority?: 'high' | 'medium' | 'low'
  aiSummary?: string
}

export interface MessageFlags {
  seen: boolean
  flagged: boolean
  answered: boolean
  draft: boolean
  deleted: boolean
}

export interface MessageListItem {
  id: number
  accountId: number
  folderId: number
  uid: number
  subject: string
  from: EmailAddress
  date: string
  flags: MessageFlags
  hasAttachments: boolean
  preview: string
  aiCategory?: string
  aiPriority?: 'high' | 'medium' | 'low'
}

// ─── Attachment types ────────────────────────────────────────────────────────

export interface Attachment {
  id: number
  messageId: number
  filename: string
  contentType: string
  size: number
}

// ─── AI types ────────────────────────────────────────────────────────────────

export type AiProvider = 'openai' | 'anthropic' | 'ollama'

export interface AiConfig {
  id: number
  provider: AiProvider
  apiKey?: string
  model: string
  baseUrl?: string
  embeddingModel?: string
  isActive: boolean
}

export interface AiClassification {
  category: string
  priority: 'high' | 'medium' | 'low'
  summary: string
  labels: string[]
}

// ─── Filter types ────────────────────────────────────────────────────────────

export interface MessageFilters {
  unreadOnly?: boolean
  dateFrom?: string  // ISO date string
  dateTo?: string    // ISO date string
}

// ─── Import types ────────────────────────────────────────────────────────────

export interface MboxFileInfo {
  path: string
  name: string
  relativePath: string
  size: number
  estimatedMessages: number
}

export interface ThunderbirdProfile {
  path: string
  label: string
  mboxFiles: MboxFileInfo[]
  /** Detected recipient email addresses (most frequent first) */
  detectedEmails: string[]
}

export interface ImportProgress {
  phase: 'scanning' | 'parsing' | 'done' | 'error'
  currentFile: string
  totalFiles: number
  currentFileIndex: number
  messagesImported: number
  messagesTotal: number
  error?: string
}

// ─── IPC Channel types ──────────────────────────────────────────────────────

export interface IpcChannels {
  // Accounts
  'accounts:list': () => Promise<Account[]>
  'accounts:create': (data: AccountFormData) => Promise<Account>
  'accounts:update': (id: number, data: Partial<AccountFormData>) => Promise<Account>
  'accounts:delete': (id: number) => Promise<void>
  'accounts:test': (data: AccountFormData) => Promise<{ success: boolean; error?: string }>

  // Folders
  'folders:list': (accountId: number) => Promise<Folder[]>
  'folders:sync': (accountId: number) => Promise<Folder[]>

  // Messages
  'messages:list': (folderId: number, page: number, limit: number, filters?: MessageFilters) => Promise<MessageListItem[]>
  'messages:count': (folderId: number, filters?: MessageFilters) => Promise<number>
  'messages:get': (messageId: number) => Promise<Message>
  'messages:sync': (folderId: number) => Promise<void>
  'messages:setFlags': (messageId: number, flags: Partial<MessageFlags>) => Promise<void>
  'messages:move': (messageId: number, targetFolderId: number) => Promise<void>
  'messages:delete': (messageId: number) => Promise<void>

  // Sync
  'sync:fullAccount': (accountId: number, inboxOnly?: boolean) => Promise<{ foldersCount: number; messagesCount: number }>

  // Import
  'import:scan': (path?: string) => Promise<ThunderbirdProfile[]>
  'import:defaultPaths': () => Promise<string[]>
  'import:run': (accountId: number, mboxFiles: MboxFileInfo[]) => Promise<{ totalImported: number; duplicatesSkipped: number; foldersCreated: number }>

  // AI
  'ai:classify': (messageId: number) => Promise<AiClassification>
  'ai:summarize': (messageId: number) => Promise<string>
  'ai:search': (query: string, accountId?: number) => Promise<MessageListItem[]>
  'ai:getConfig': () => Promise<AiConfig | null>
  'ai:setConfig': (config: Omit<AiConfig, 'id'>) => Promise<AiConfig>
}

// ─── Connection status ───────────────────────────────────────────────────────

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface AccountStatus {
  accountId: number
  imap: ConnectionStatus
  smtp: ConnectionStatus
  error?: string
}
