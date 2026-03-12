import type { IpcMainInvokeEvent } from 'electron'
import type { Message, MessageListItem, MessageFlags, EmailAddress } from '../../shared/types'
import { getDb } from '../services/db/connection'
import { messages } from '../services/db/schema/messages'
import { folders } from '../services/db/schema/folders'
import { eq, desc, and, sql } from 'drizzle-orm'
import { syncFolderMessages, fetchMessageBody } from '../services/imap/sync'

export const messagesHandlers = {
  'messages:list': async (
    _event: IpcMainInvokeEvent,
    folderId: number,
    page: number = 1,
    limit: number = 50,
    filters?: { unreadOnly?: boolean; dateFrom?: string; dateTo?: string }
  ): Promise<MessageListItem[]> => {
    const db = getDb()
    const offset = (page - 1) * limit

    const conditions = [eq(messages.folderId, folderId)]

    if (filters?.unreadOnly) {
      conditions.push(sql`(${messages.flags}->>'seen')::text = 'false'`)
    }
    if (filters?.dateFrom) {
      conditions.push(sql`${messages.date} >= ${new Date(filters.dateFrom)}`)
    }
    if (filters?.dateTo) {
      // Include the entire end day
      const endDate = new Date(filters.dateTo)
      endDate.setHours(23, 59, 59, 999)
      conditions.push(sql`${messages.date} <= ${endDate}`)
    }

    const rows = await db
      .select()
      .from(messages)
      .where(and(...conditions))
      .orderBy(desc(messages.date))
      .limit(limit)
      .offset(offset)

    return rows.map((row): MessageListItem => ({
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
    }))
  },

  'messages:count': async (
    _event: IpcMainInvokeEvent,
    folderId: number,
    filters?: { unreadOnly?: boolean; dateFrom?: string; dateTo?: string }
  ): Promise<number> => {
    const db = getDb()

    const conditions = [eq(messages.folderId, folderId)]

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
    if (!bodyText && !bodyHtml) {
      try {
        const body = await fetchMessageBody(row.accountId, row.folderId, row.id)
        bodyText = body.bodyText
        bodyHtml = body.bodyHtml
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
    await db.delete(messages).where(eq(messages.id, messageId))
  },

  'messages:sync': async (_event: IpcMainInvokeEvent, folderId: number): Promise<void> => {
    const db = getDb()
    const [folder] = await db.select().from(folders).where(eq(folders.id, folderId))
    if (!folder) throw new Error(`Folder ${folderId} not found`)

    console.log(`[Messages] Starting sync for folder: ${folder.name} (id=${folderId})`)
    const synced = await syncFolderMessages(folder.accountId, folderId)
    console.log(`[Messages] Synced ${synced} new messages for folder: ${folder.name}`)
  },

  'messages:move': async (
    _event: IpcMainInvokeEvent,
    messageId: number,
    targetFolderId: number
  ): Promise<void> => {
    const db = getDb()
    await db.update(messages).set({ folderId: targetFolderId }).where(eq(messages.id, messageId))
  }
}
