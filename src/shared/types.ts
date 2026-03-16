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
  /** Periodic sync interval in minutes. 0 = disabled (manual sync only). */
  syncIntervalMinutes: number
  /** Whether to automatically analyze new emails with AI after sync. */
  autoAnalyze: boolean
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
  /** Periodic sync interval in minutes. 0 = disabled. */
  syncIntervalMinutes: number
  /** Whether to automatically analyze new emails with AI after sync. */
  autoAnalyze: boolean
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
  attachments: Attachment[]
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

/** Extended list item for AI Overview — includes summary + account email for multi-account display */
export interface AnalyzedMessageItem extends MessageListItem {
  aiSummary: string
  aiCategory: string
  aiPriority: 'high' | 'medium' | 'low'
  accountEmail?: string
}

/** Semantic search result — analyzed message with similarity score */
export interface SemanticSearchResult extends AnalyzedMessageItem {
  /** Cosine similarity score (0-1, higher = more similar) */
  similarity: number
}

// ─── Attachment types ────────────────────────────────────────────────────────

export interface Attachment {
  filename: string
  contentType: string
  size: number
  /** MIME part number for on-demand IMAP download (e.g. "1.2", "2") */
  partNumber: string
  /** Content-ID for inline images (cid: references) */
  contentId?: string
}

export interface AttachmentSaveResult {
  success: boolean
  filePath?: string
  error?: string
}

// ─── AI types ────────────────────────────────────────────────────────────────

export type AiProvider = 'together' | 'openai' | 'anthropic' | 'ollama'

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

export interface AiBatchResult {
  total: number
  analyzed: number
  skipped: number
  failed: number
}

export type AiBlacklistPatternType = 'domain' | 'address' | 'subject'

export interface AiBlacklistRule {
  id: number
  pattern: string
  patternType: AiBlacklistPatternType
  createdAt: string
}

// ─── Filter types ────────────────────────────────────────────────────────────

export type SearchField = 'from' | 'subject' | 'body'

export interface MessageFilters {
  unreadOnly?: boolean
  dateFrom?: string  // ISO date string
  dateTo?: string    // ISO date string
  searchQuery?: string
  searchFields?: SearchField[]  // defaults to all fields if omitted
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
  /** Messages actually inserted into DB */
  messagesImported: number
  /** Messages processed so far (imported + skipped duplicates) */
  messagesProcessed: number
  /** Duplicates skipped so far */
  duplicatesSkipped: number
  /** Estimated total messages across all selected files */
  messagesTotal: number
  error?: string
}

// ─── Settings types ──────────────────────────────────────────────────────────

export interface ImageAllowlistEntry {
  id: number
  domain: string
  createdAt: string
}

// ─── Contact types ───────────────────────────────────────────────────────────

export interface Contact {
  id: number
  accountId: number
  email: string
  name: string
  frequency: number
  lastContacted?: string
  isFavorite: boolean
  createdAt: string
}

// ─── Avatar types ─────────────────────────────────────────────────────────────

export type AvatarSource = 'gravatar' | 'favicon-im' | 'google-favicon' | 'identicon'

export interface AvatarResult {
  url: string
  source: AvatarSource
}

// ─── Todo types ───────────────────────────────────────────────────────────────

export interface TodoItem {
  id: number
  messageId: number
  text: string
  done: boolean
  createdAt: string
  /** Populated when fetching with message context */
  messageSubject?: string
  messageFrom?: string
}

// ─── Mail Compose types ─────────────────────────────────────────────────────

export interface ComposeMailData {
  accountId: number
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject: string
  bodyText?: string
  bodyHtml?: string
  /** In-Reply-To header for threading */
  inReplyTo?: string
  /** References header for threading */
  references?: string[]
}

export interface SendMailResult {
  success: boolean
  messageId?: string
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
  'messages:listUnified': (folderType: FolderType, page: number, limit: number, filters?: MessageFilters) => Promise<MessageListItem[]>
  'messages:countUnified': (folderType: FolderType, filters?: MessageFilters) => Promise<number>
  'messages:get': (messageId: number) => Promise<Message>
  'messages:sync': (folderId: number) => Promise<void>
  'messages:setFlags': (messageId: number, flags: Partial<MessageFlags>) => Promise<void>
  'messages:move': (messageId: number, targetFolderId: number) => Promise<void>
  'messages:delete': (messageId: number) => Promise<void>
  'messages:listAnalyzed': () => Promise<AnalyzedMessageItem[]>

  // Sync
  'sync:fullAccount': (accountId: number, inboxOnly?: boolean) => Promise<{ foldersCount: number; messagesCount: number }>

  // Import
  'import:scan': (path?: string) => Promise<ThunderbirdProfile[]>
  'import:defaultPaths': () => Promise<string[]>
  'import:run': (accountId: number, mboxFiles: MboxFileInfo[]) => Promise<{ totalImported: number; duplicatesSkipped: number; foldersCreated: number }>

  // AI
  'ai:analyze': (messageId: number) => Promise<AiClassification>
  'ai:analyzeBatch': (params: { folderId?: number; folderType?: FolderType; filters?: MessageFilters }) => Promise<AiBatchResult>
  'ai:search': (query: string, accountId?: number) => Promise<SemanticSearchResult[]>
  'ai:getConfig': () => Promise<AiConfig | null>
  'ai:setConfig': (config: Omit<AiConfig, 'id'>) => Promise<AiConfig>

  // AI Blacklist
  'ai:blacklist:list': () => Promise<AiBlacklistRule[]>
  'ai:blacklist:add': (pattern: string, patternType: AiBlacklistPatternType) => Promise<AiBlacklistRule>
  'ai:blacklist:remove': (id: number) => Promise<void>
  'ai:blacklist:check': (messageId: number) => Promise<boolean>

  // Settings — Image Allowlist
  'settings:imageAllowlist:list': () => Promise<ImageAllowlistEntry[]>
  'settings:imageAllowlist:add': (domain: string) => Promise<void>
  'settings:imageAllowlist:remove': (domain: string) => Promise<void>
  'settings:imageAllowlist:check': (domain: string) => Promise<boolean>

  // Mail — Compose & Send
  'mail:send': (data: ComposeMailData) => Promise<SendMailResult>

  // Contacts
  'contacts:listFavorites': () => Promise<Contact[]>
  'contacts:add': (accountId: number, email: string, name: string) => Promise<Contact>
  'contacts:remove': (id: number) => Promise<void>
  'contacts:check': (accountId: number, email: string) => Promise<boolean>
  'contacts:messages': (email: string, page: number, limit: number) => Promise<MessageListItem[]>
  'contacts:messagesCount': (email: string) => Promise<number>

  // Attachments
  'attachments:download': (messageId: number, partNumber: string, filename: string) => Promise<AttachmentSaveResult>
  'attachments:open': (messageId: number, partNumber: string, filename: string) => Promise<AttachmentSaveResult>

  // Avatars
  'avatars:resolve': (email: string) => Promise<AvatarResult>
  'avatars:batch': (emails: string[]) => Promise<Record<string, AvatarResult>>

  // Todos
  'todos:extract': (messageId: number) => Promise<TodoItem[]>
  'todos:list': () => Promise<TodoItem[]>
  'todos:toggle': (id: number, done: boolean) => Promise<void>
  'todos:delete': (id: number) => Promise<void>
}

// ─── Connection status ───────────────────────────────────────────────────────

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface AccountStatus {
  accountId: number
  imap: ConnectionStatus
  smtp: ConnectionStatus
  error?: string
}
