import { getDb } from '../db/connection'
import { accounts } from '../db/schema/accounts'
import { folders } from '../db/schema/folders'
import { messages } from '../db/schema/messages'
import { eq, and } from 'drizzle-orm'
import { imapManager } from './connection-manager'
import { listMailboxes } from './connection'
import { computeDedupHash } from '../dedup'
import type { ImapFlow } from 'imapflow'

type FolderType = 'inbox' | 'sent' | 'drafts' | 'trash' | 'spam' | 'archive' | 'custom'

/** Map IMAP specialUse flags to our folder types */
function mapSpecialUse(specialUse?: string): FolderType {
  switch (specialUse) {
    case '\\Inbox': return 'inbox'
    case '\\Sent': return 'sent'
    case '\\Drafts': return 'drafts'
    case '\\Trash': return 'trash'
    case '\\Junk': return 'spam'
    case '\\Archive': return 'archive'
    default: return 'custom'
  }
}

/** Detect if a message likely has attachments from its structure */
function hasAttachments(struct: Record<string, unknown> | Array<unknown>): boolean {
  if (Array.isArray(struct)) {
    return struct.some((part) => hasAttachments(part as Record<string, unknown>))
  }
  if (struct && typeof struct === 'object') {
    const disposition = struct.disposition as string | undefined
    if (disposition && disposition.toLowerCase() === 'attachment') return true
    const childNodes = struct.childNodes as Array<unknown> | undefined
    if (childNodes) return childNodes.some((child) => hasAttachments(child as Record<string, unknown>))
  }
  return false
}

/**
 * Extract text preview from body text (first ~250 chars, cleaned up).
 */
function extractPreview(text: string): string {
  return text
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 250)
}

/**
 * Parse an IMAP address object to our EmailAddress format.
 */
function parseAddress(addr: { name?: string; address?: string } | undefined): { name: string; address: string } {
  if (!addr) return { name: '', address: '' }
  return {
    name: addr.name || '',
    address: addr.address || ''
  }
}

function parseAddressList(list: Array<{ name?: string; address?: string }> | undefined): Array<{ name: string; address: string }> {
  if (!list || !Array.isArray(list)) return []
  return list.map(parseAddress)
}

export interface SyncProgress {
  accountId: number
  phase: 'folders' | 'messages'
  folderName?: string
  current: number
  total: number
}

export type ProgressCallback = (progress: SyncProgress) => void

/**
 * Sync all folders for an account from IMAP.
 * Uses the shared persistent connection.
 */
export async function syncAccountFolders(
  accountId: number
): Promise<typeof folders.$inferSelect[]> {
  const db = getDb()

  await imapManager.withClient(accountId, async (client) => {
    const mailboxes = await listMailboxes(client)

    for (const mb of mailboxes) {
      const existing = await db
        .select()
        .from(folders)
        .where(and(eq(folders.accountId, accountId), eq(folders.path, mb.path)))

      const folderData = {
        accountId,
        name: mb.name,
        path: mb.path,
        type: mapSpecialUse(mb.specialUse),
        delimiter: mb.delimiter
      }

      if (existing.length > 0) {
        await db.update(folders).set(folderData).where(eq(folders.id, existing[0].id))
      } else {
        await db.insert(folders).values(folderData)
      }
    }
  })

  return db.select().from(folders).where(eq(folders.accountId, accountId))
}

export interface SyncFolderResult {
  /** Number of new messages detected (before dedup at DB level) */
  count: number
  /** DB IDs of actually inserted messages */
  newMessageIds: number[]
}

/**
 * Sync messages for a specific folder from IMAP.
 * Uses IMAP UIDs to perform incremental sync — only fetches new messages.
 * Reuses the shared persistent connection.
 */
export async function syncFolderMessages(
  accountId: number,
  folderId: number,
  onProgress?: ProgressCallback
): Promise<SyncFolderResult> {
  const db = getDb()

  const [folder] = await db.select().from(folders).where(eq(folders.id, folderId))
  if (!folder) throw new Error(`Folder ${folderId} not found`)

  return imapManager.withClient(accountId, async (client) => {
    const newMessageIds: number[] = []

    const lock = await client.getMailboxLock(folder.path)
    try {
      const mailboxStatus = client.mailbox
      if (!mailboxStatus) {
        throw new Error(`Could not open mailbox: ${folder.path}`)
      }

      const totalMessages = mailboxStatus.exists ?? 0

      // Update folder counts
      await db.update(folders).set({
        totalCount: totalMessages,
        uidValidity: mailboxStatus.uidValidity ? Number(mailboxStatus.uidValidity) : null,
        uidNext: mailboxStatus.uidNext ? Number(mailboxStatus.uidNext) : null
      }).where(eq(folders.id, folderId))

      if (totalMessages === 0) {
        return { count: 0, newMessageIds: [] }
      }

      // Pre-load existing dedup hashes for this account to skip already-imported messages.
      // This is the correct dedup mechanism — UID-based skip is unreliable because
      // mbox-imported messages have synthetic UIDs that can collide with real IMAP UIDs.
      const existingHashRows = await db
        .select({ dedupHash: messages.dedupHash })
        .from(messages)
        .where(eq(messages.accountId, accountId))
      const existingHashes = new Set(existingHashRows.map((r) => r.dedupHash))

      // Also load UIDs specifically from this folder for the "initial sync" range optimization.
      // Count only messages that were synced from IMAP (have UIDs within IMAP's uidNext range),
      // not mbox-imported messages with synthetic UIDs that exceed uidNext.
      const imapUidNext = mailboxStatus.uidNext ? Number(mailboxStatus.uidNext) : Infinity
      const existingImapMsgs = await db
        .select({ uid: messages.uid })
        .from(messages)
        .where(and(eq(messages.folderId, folderId), eq(messages.accountId, accountId)))
      const existingImapUids = new Set(
        existingImapMsgs.map((m) => m.uid).filter((uid) => uid < imapUidNext)
      )

      // Fetch envelopes for all messages (UIDs).
      // For initial IMAP sync (no real IMAP UIDs yet), limit to last 1000 messages by sequence number.
      const fetchRange = existingImapUids.size === 0 && totalMessages > 1000
        ? `${Math.max(1, totalMessages - 999)}:*`
        : '1:*'

      let current = 0
      const messagesToInsert: Array<typeof messages.$inferInsert> = []

      for await (const msg of client.fetch(fetchRange, {
        uid: true,
        envelope: true,
        flags: true,
        bodyStructure: true,
        size: true
      })) {
        current++
        if (onProgress) {
          onProgress({
            accountId,
            phase: 'messages',
            folderName: folder.name,
            current,
            total: totalMessages
          })
        }

        // Skip if we already have this message (by dedup hash, not UID)
        const envelope = msg.envelope
        if (!envelope) continue

        const fromAddr = envelope.from?.[0]
        const dedupHash = computeDedupHash({
          messageId: envelope.messageId,
          fromAddress: fromAddr?.address || '',
          date: envelope.date ? new Date(envelope.date) : null,
          subject: envelope.subject || ''
        })
        if (existingHashes.has(dedupHash)) continue

        const flagSet = msg.flags ?? new Set<string>()

        messagesToInsert.push({
          accountId,
          folderId,
          messageId: envelope.messageId || null,
          dedupHash,
          uid: msg.uid,
          subject: envelope.subject || '(no subject)',
          fromAddress: fromAddr?.address || '',
          fromName: fromAddr?.name || '',
          toAddresses: parseAddressList(envelope.to as Array<{ name?: string; address?: string }>),
          ccAddresses: parseAddressList(envelope.cc as Array<{ name?: string; address?: string }>),
          bccAddresses: parseAddressList(envelope.bcc as Array<{ name?: string; address?: string }>),
          date: envelope.date ? new Date(envelope.date) : null,
          bodyText: '', // loaded on demand
          bodyHtml: '', // loaded on demand
          preview: envelope.subject || '', // will be updated when body is fetched
          flags: {
            seen: flagSet.has('\\Seen'),
            flagged: flagSet.has('\\Flagged'),
            answered: flagSet.has('\\Answered'),
            draft: flagSet.has('\\Draft'),
            deleted: flagSet.has('\\Deleted')
          },
          size: msg.size ?? 0,
          hasAttachments: msg.bodyStructure ? hasAttachments(msg.bodyStructure as unknown as Record<string, unknown>) : false,
          rawHeaders: null,
          aiCategory: null,
          aiPriority: null,
          aiSummary: null
        })

      }

      // Batch insert with dedup — ON CONFLICT DO NOTHING on (account_id, dedup_hash)
      // This prevents unique constraint violations when importing mbox + syncing same account
      // .returning() only returns actually inserted rows (not conflicting ones)
      if (messagesToInsert.length > 0) {
        for (let i = 0; i < messagesToInsert.length; i += 100) {
          const batch = messagesToInsert.slice(i, i + 100)
          const inserted = await db
            .insert(messages)
            .values(batch)
            .onConflictDoNothing({
              target: [messages.accountId, messages.dedupHash]
            })
            .returning({ id: messages.id })
          newMessageIds.push(...inserted.map((r) => r.id))
        }
      }

      // Recount unread from DB for accuracy
      const allFolderMsgs = await db
        .select({ flags: messages.flags })
        .from(messages)
        .where(eq(messages.folderId, folderId))
      const unreadCount = allFolderMsgs.filter((m) => {
        const f = m.flags as { seen: boolean }
        return !f.seen
      }).length
      await db.update(folders).set({
        unreadCount,
        totalCount: allFolderMsgs.length
      }).where(eq(folders.id, folderId))

    } finally {
      lock.release()
    }

    return { count: newMessageIds.length, newMessageIds }
  })
}

/**
 * Fetch full message body (text + html) from IMAP and update DB.
 * Called on-demand when user clicks a message.
 * Reuses the shared persistent connection.
 */
export async function fetchMessageBody(
  accountId: number,
  folderId: number,
  messageDbId: number
): Promise<{ bodyText: string; bodyHtml: string }> {
  const db = getDb()

  const [msg] = await db.select().from(messages).where(eq(messages.id, messageDbId))
  if (!msg) throw new Error(`Message ${messageDbId} not found`)

  // If body already fetched, return it from DB
  if (msg.bodyText || msg.bodyHtml) {
    return { bodyText: msg.bodyText, bodyHtml: msg.bodyHtml }
  }

  const [folder] = await db.select().from(folders).where(eq(folders.id, folderId))
  if (!folder) throw new Error(`Folder ${folderId} not found`)

  return imapManager.withClient(accountId, async (client) => {
    let bodyText = ''
    let bodyHtml = ''

    const lock = await client.getMailboxLock(folder.path)
    try {
      const source = await client.download(String(msg.uid), undefined, { uid: true })
      if (source?.content) {
        const chunks: Buffer[] = []
        for await (const chunk of source.content) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        }
        const rawSource = Buffer.concat(chunks).toString('utf-8')

        const { simpleParser } = await import('mailparser')
        const parsed = await simpleParser(rawSource)

        bodyText = parsed.text || ''
        bodyHtml = parsed.html || ''
      }
    } finally {
      lock.release()
    }

    // Update DB with fetched body
    const preview = extractPreview(bodyText || bodyHtml.replace(/<[^>]*>/g, ' '))
    await db.update(messages).set({
      bodyText,
      bodyHtml,
      preview: preview || msg.subject
    }).where(eq(messages.id, messageDbId))

    return { bodyText, bodyHtml }
  })
}

/**
 * Full sync: folders + messages for inbox (and optionally all folders).
 * All operations share one persistent IMAP connection per account.
 */
export async function fullAccountSync(
  accountId: number,
  onProgress?: ProgressCallback,
  inboxOnly: boolean = true
): Promise<{ foldersCount: number; messagesCount: number; newMessageIds: number[] }> {
  // Step 1: Sync folders
  if (onProgress) {
    onProgress({ accountId, phase: 'folders', current: 0, total: 1 })
  }

  const syncedFolders = await syncAccountFolders(accountId)

  if (onProgress) {
    onProgress({ accountId, phase: 'folders', current: 1, total: 1 })
  }

  // Step 2: Sync messages
  let totalSynced = 0
  const allNewMessageIds: number[] = []
  const foldersToSync = inboxOnly
    ? syncedFolders.filter((f) => f.type === 'inbox')
    : syncedFolders.filter((f) => ['inbox', 'sent', 'drafts'].includes(f.type))

  for (let i = 0; i < foldersToSync.length; i++) {
    const folder = foldersToSync[i]
    try {
      const result = await syncFolderMessages(accountId, folder.id, onProgress)
      totalSynced += result.count
      allNewMessageIds.push(...result.newMessageIds)
    } catch (error) {
      console.error(`[Sync] Error syncing folder ${folder.name}:`, error)
    }
  }

  return { foldersCount: syncedFolders.length, messagesCount: totalSynced, newMessageIds: allNewMessageIds }
}
