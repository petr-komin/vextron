import type { IpcMainInvokeEvent } from 'electron'
import type { Message, MessageListItem, MessageFlags, EmailAddress, MessageFilters, SearchField, FolderType, AnalyzedMessageItem, Attachment } from '../../shared/types'
import { getDb } from '../services/db/connection'
import { messages } from '../services/db/schema/messages'
import { folders } from '../services/db/schema/folders'
import { accounts } from '../services/db/schema/accounts'
import { eq, desc, and, or, sql, ilike, inArray, isNull, isNotNull, type SQL } from 'drizzle-orm'
import { syncFolderMessages, fetchMessageBody } from '../services/imap/sync'
import { imapManager } from '../services/imap/connection-manager'

/** Build shared WHERE conditions from filters (date, unread, search). */
export function buildCommonConditions(filters?: MessageFilters): SQL[] {
  const conditions: SQL[] = [
    // Always exclude soft-deleted messages
    isNull(messages.deletedAt)
  ]

  if (filters?.unreadOnly) {
    conditions.push(sql`(${messages.flags}->>'seen')::text = 'false'`)
  }
  if (filters?.dateFrom) {
    conditions.push(sql`${messages.date} >= ${new Date(filters.dateFrom)}`)
  }
  if (filters?.dateTo) {
    const endDate = new Date(filters.dateTo)
    endDate.setHours(23, 59, 59, 999)
    conditions.push(sql`${messages.date} <= ${endDate}`)
  }

  // Search: each word must match (AND), but each word can match any selected field (OR)
  if (filters?.searchQuery && filters.searchQuery.trim()) {
    const words = filters.searchQuery.trim().split(/\s+/).filter(Boolean)
    const fields: SearchField[] = filters.searchFields?.length
      ? filters.searchFields
      : ['from', 'subject', 'body']

    for (const word of words) {
      const pattern = `%${word}%`
      const fieldConditions: SQL[] = []
      for (const field of fields) {
        if (field === 'from') {
          fieldConditions.push(ilike(messages.fromName, pattern))
          fieldConditions.push(ilike(messages.fromAddress, pattern))
        } else if (field === 'subject') {
          fieldConditions.push(ilike(messages.subject, pattern))
        } else if (field === 'body') {
          fieldConditions.push(ilike(messages.bodyText, pattern))
        }
      }
      if (fieldConditions.length > 0) {
        conditions.push(or(...fieldConditions)!)
      }
    }
  }

  return conditions
}

/** Build WHERE conditions for a single folder. */
function buildFilterConditions(folderId: number, filters?: MessageFilters): SQL[] {
  return [eq(messages.folderId, folderId), ...buildCommonConditions(filters)]
}

/** Map row to MessageListItem */
function rowToListItem(row: typeof messages.$inferSelect): MessageListItem {
  return {
    id: row.id,
    accountId: row.accountId,
    folderId: row.folderId,
    uid: row.uid,
    subject: row.subject,
    from: { name: row.fromName, address: row.fromAddress },
    date: row.date?.toISOString() ?? '',
    flags: row.flags as MessageFlags,
    hasAttachments: row.hasAttachments,
    preview: row.preview,
    aiCategory: row.aiCategory ?? undefined,
    aiPriority: row.aiPriority as MessageListItem['aiPriority']
  }
}

export const messagesHandlers = {
  'messages:list': async (
    _event: IpcMainInvokeEvent,
    folderId: number,
    page: number = 1,
    limit: number = 50,
    filters?: MessageFilters
  ): Promise<MessageListItem[]> => {
    const db = getDb()
    const offset = (page - 1) * limit
    const conditions = buildFilterConditions(folderId, filters)

    const rows = await db
      .select()
      .from(messages)
      .where(and(...conditions))
      .orderBy(desc(messages.date))
      .limit(limit)
      .offset(offset)

    return rows.map(rowToListItem)
  },

  'messages:count': async (
    _event: IpcMainInvokeEvent,
    folderId: number,
    filters?: MessageFilters
  ): Promise<number> => {
    const db = getDb()
    const conditions = buildFilterConditions(folderId, filters)

    const [result] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(messages)
      .where(and(...conditions))

    return result?.count ?? 0
  },

  /** Unified list: messages across ALL accounts for a given folder type (inbox/sent) */
  'messages:listUnified': async (
    _event: IpcMainInvokeEvent,
    folderType: FolderType,
    page: number = 1,
    limit: number = 50,
    filters?: MessageFilters
  ): Promise<MessageListItem[]> => {
    const db = getDb()
    const offset = (page - 1) * limit

    // Get all folder IDs of the requested type across all accounts
    const matchingFolders = await db
      .select({ id: folders.id })
      .from(folders)
      .where(eq(folders.type, folderType))
    const folderIds = matchingFolders.map((f) => f.id)
    if (folderIds.length === 0) return []

    const conditions: SQL[] = [
      inArray(messages.folderId, folderIds),
      ...buildCommonConditions(filters)
    ]

    const rows = await db
      .select()
      .from(messages)
      .where(and(...conditions))
      .orderBy(desc(messages.date))
      .limit(limit)
      .offset(offset)

    return rows.map(rowToListItem)
  },

  /** Unified count: messages across ALL accounts for a given folder type */
  'messages:countUnified': async (
    _event: IpcMainInvokeEvent,
    folderType: FolderType,
    filters?: MessageFilters
  ): Promise<number> => {
    const db = getDb()

    const matchingFolders = await db
      .select({ id: folders.id })
      .from(folders)
      .where(eq(folders.type, folderType))
    const folderIds = matchingFolders.map((f) => f.id)
    if (folderIds.length === 0) return 0

    const conditions: SQL[] = [
      inArray(messages.folderId, folderIds),
      ...buildCommonConditions(filters)
    ]

    const [result] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(messages)
      .where(and(...conditions))

    return result?.count ?? 0
  },

  'messages:get': async (_event: IpcMainInvokeEvent, messageId: number): Promise<Message> => {
    const db = getDb()
    const [row] = await db.select().from(messages).where(eq(messages.id, messageId))
    if (!row) throw new Error(`Message ${messageId} not found`)

    // Lazy body loading: if body is empty, fetch from IMAP
    let bodyText = row.bodyText
    let bodyHtml = row.bodyHtml
    let attachments = (row.attachments ?? []) as Attachment[]
    if (!bodyText && !bodyHtml) {
      try {
        const body = await fetchMessageBody(row.accountId, row.folderId, row.id)
        bodyText = body.bodyText
        bodyHtml = body.bodyHtml
        attachments = body.attachments as Attachment[]
      } catch (error) {
        console.error(`[Messages] Failed to fetch body for message ${messageId}:`, error)
        // Return empty body rather than failing the whole get
      }
    }

    return {
      id: row.id,
      accountId: row.accountId,
      folderId: row.folderId,
      messageId: row.messageId ?? '',
      uid: row.uid,
      subject: row.subject,
      from: { name: row.fromName, address: row.fromAddress },
      to: (row.toAddresses ?? []) as EmailAddress[],
      cc: (row.ccAddresses ?? []) as EmailAddress[],
      bcc: (row.bccAddresses ?? []) as EmailAddress[],
      date: row.date?.toISOString() ?? '',
      bodyText,
      bodyHtml,
      flags: row.flags as MessageFlags,
      size: row.size,
      hasAttachments: row.hasAttachments,
      attachments,
      aiCategory: row.aiCategory ?? undefined,
      aiPriority: row.aiPriority as Message['aiPriority'],
      aiSummary: row.aiSummary ?? undefined
    }
  },

  'messages:setFlags': async (
    _event: IpcMainInvokeEvent,
    messageId: number,
    flags: Partial<MessageFlags>
  ): Promise<void> => {
    const db = getDb()
    const [existing] = await db.select().from(messages).where(eq(messages.id, messageId))
    if (!existing) throw new Error(`Message ${messageId} not found`)

    const currentFlags = existing.flags as MessageFlags
    const newFlags = { ...currentFlags, ...flags }

    await db.update(messages).set({ flags: newFlags }).where(eq(messages.id, messageId))
  },

  'messages:delete': async (_event: IpcMainInvokeEvent, messageId: number): Promise<void> => {
    const db = getDb()

    // Look up message details needed for IMAP move
    const [msg] = await db
      .select({
        id: messages.id,
        uid: messages.uid,
        folderId: messages.folderId,
        accountId: messages.accountId
      })
      .from(messages)
      .where(eq(messages.id, messageId))
    if (!msg) return

    // Soft-delete immediately — hides from UI and prevents sync re-import
    await db.update(messages)
      .set({ deletedAt: new Date() })
      .where(eq(messages.id, messageId))

    // Attempt IMAP move to Trash (best-effort — will retry on next sync if it fails)
    try {
      // Find the Trash folder for this account
      const [trashFolder] = await db
        .select()
        .from(folders)
        .where(and(eq(folders.accountId, msg.accountId), eq(folders.type, 'trash')))

      if (!trashFolder) {
        console.warn('[delete] No Trash folder found for account', msg.accountId)
        return
      }

      // Already in trash? Nothing to move on IMAP.
      if (msg.folderId === trashFolder.id) return

      // Get source folder IMAP path
      const [srcFolder] = await db
        .select({ path: folders.path })
        .from(folders)
        .where(eq(folders.id, msg.folderId))
      if (!srcFolder) return

      if (imapManager.isConnected(msg.accountId)) {
        await imapManager.withClient(msg.accountId, async (client) => {
          const lock = await client.getMailboxLock(srcFolder.path)
          try {
            await client.messageMove(msg.uid.toString(), trashFolder.path, { uid: true })
          } finally {
            lock.release()
          }
        })
        // IMAP move succeeded — update local folderId to Trash
        await db.update(messages)
          .set({ folderId: trashFolder.id })
          .where(eq(messages.id, messageId))
      }
    } catch (err) {
      console.warn('[delete] IMAP move to Trash failed, will retry on next sync:', err)
      // Soft-delete is already done — message hidden from UI.
      // processPendingDeletes() in sync.ts will retry later.
    }
  },

  'messages:sync': async (_event: IpcMainInvokeEvent, folderId: number): Promise<void> => {
    const db = getDb()
    const [folder] = await db.select().from(folders).where(eq(folders.id, folderId))
    if (!folder) throw new Error(`Folder ${folderId} not found`)

    console.log(`[Messages] Starting sync for folder: ${folder.name} (id=${folderId})`)
    const result = await syncFolderMessages(folder.accountId, folderId)
    console.log(`[Messages] Synced ${result.count} new messages for folder: ${folder.name}`)
  },

  'messages:move': async (
    _event: IpcMainInvokeEvent,
    messageId: number,
    targetFolderId: number
  ): Promise<void> => {
    const db = getDb()
    await db.update(messages).set({ folderId: targetFolderId }).where(eq(messages.id, messageId))
  },

  /**
   * List all AI-analyzed messages (those with ai_summary IS NOT NULL).
   * Returns messages sorted by date descending, with account email for multi-account display.
   */
  'messages:listAnalyzed': async (
    _event: IpcMainInvokeEvent
  ): Promise<AnalyzedMessageItem[]> => {
    const db = getDb()

    const rows = await db
      .select({
        msg: messages,
        accountEmail: accounts.email
      })
      .from(messages)
      .innerJoin(accounts, eq(messages.accountId, accounts.id))
      .where(and(isNotNull(messages.aiSummary), isNull(messages.deletedAt)))
      .orderBy(desc(messages.date))

    return rows.map(({ msg, accountEmail }) => ({
      id: msg.id,
      accountId: msg.accountId,
      folderId: msg.folderId,
      uid: msg.uid,
      subject: msg.subject,
      from: { name: msg.fromName, address: msg.fromAddress },
      date: msg.date?.toISOString() ?? '',
      flags: msg.flags as MessageFlags,
      hasAttachments: msg.hasAttachments,
      preview: msg.preview,
      aiCategory: msg.aiCategory!,
      aiPriority: msg.aiPriority as 'high' | 'medium' | 'low',
      aiSummary: msg.aiSummary!,
      accountEmail
    }))
  }
}
