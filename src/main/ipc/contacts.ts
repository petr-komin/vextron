import type { IpcMainInvokeEvent } from 'electron'
import type { Contact, MessageListItem, MessageFlags } from '../../shared/types'
import { getDb } from '../services/db/connection'
import { contacts } from '../services/db/schema/ai'
import { messages } from '../services/db/schema/messages'
import { eq, and, desc, sql, isNull, ilike } from 'drizzle-orm'

export const contactsHandlers = {
  /**
   * List all favorite contacts across all accounts, sorted by most recently contacted.
   */
  'contacts:listFavorites': async (
    _event: IpcMainInvokeEvent
  ): Promise<Contact[]> => {
    const db = getDb()

    const rows = await db
      .select()
      .from(contacts)
      .where(eq(contacts.isFavorite, true))
      .orderBy(desc(contacts.lastContacted))

    return rows.map((row) => ({
      id: row.id,
      accountId: row.accountId,
      email: row.email,
      name: row.name,
      frequency: row.frequency,
      lastContacted: row.lastContacted?.toISOString(),
      isFavorite: row.isFavorite,
      createdAt: row.createdAt.toISOString()
    }))
  },

  /**
   * Add a sender as a favorite contact.
   * Uses ON CONFLICT to upsert — if the contact already exists, marks it as favorite.
   */
  'contacts:add': async (
    _event: IpcMainInvokeEvent,
    accountId: number,
    email: string,
    name: string
  ): Promise<Contact> => {
    const db = getDb()

    const [row] = await db
      .insert(contacts)
      .values({
        accountId,
        email: email.toLowerCase().trim(),
        name: name || '',
        isFavorite: true,
        frequency: 0
      })
      .onConflictDoUpdate({
        target: [contacts.accountId, contacts.email],
        set: {
          isFavorite: sql`true`,
          name: sql`CASE WHEN ${contacts.name} = '' THEN ${name || ''} ELSE ${contacts.name} END`
        }
      })
      .returning()

    return {
      id: row.id,
      accountId: row.accountId,
      email: row.email,
      name: row.name,
      frequency: row.frequency,
      lastContacted: row.lastContacted?.toISOString(),
      isFavorite: row.isFavorite,
      createdAt: row.createdAt.toISOString()
    }
  },

  /**
   * Remove a contact from favorites (deletes the row entirely).
   */
  'contacts:remove': async (
    _event: IpcMainInvokeEvent,
    id: number
  ): Promise<void> => {
    const db = getDb()
    await db.delete(contacts).where(eq(contacts.id, id))
  },

  /**
   * Check if a sender email is already in the favorite contacts list (across any account).
   */
  'contacts:check': async (
    _event: IpcMainInvokeEvent,
    accountId: number,
    email: string
  ): Promise<boolean> => {
    const db = getDb()
    const [row] = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(
        and(
          eq(contacts.accountId, accountId),
          ilike(contacts.email, email.toLowerCase().trim()),
          eq(contacts.isFavorite, true)
        )
      )
    return !!row
  },

  /**
   * List messages from a specific sender email (across all accounts/folders).
   * Paginated, sorted by date descending.
   */
  'contacts:messages': async (
    _event: IpcMainInvokeEvent,
    email: string,
    page: number = 1,
    limit: number = 50
  ): Promise<MessageListItem[]> => {
    const db = getDb()
    const offset = (page - 1) * limit

    const rows = await db
      .select()
      .from(messages)
      .where(
        and(
          ilike(messages.fromAddress, email.toLowerCase().trim()),
          isNull(messages.deletedAt)
        )
      )
      .orderBy(desc(messages.date))
      .limit(limit)
      .offset(offset)

    return rows.map((row) => ({
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

  /**
   * Count messages from a specific sender email.
   */
  'contacts:messagesCount': async (
    _event: IpcMainInvokeEvent,
    email: string
  ): Promise<number> => {
    const db = getDb()

    const [result] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(messages)
      .where(
        and(
          ilike(messages.fromAddress, email.toLowerCase().trim()),
          isNull(messages.deletedAt)
        )
      )

    return result?.count ?? 0
  }
}
