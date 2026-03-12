import { createReadStream, readdirSync, statSync, existsSync } from 'fs'
import { join, basename } from 'path'
import { createInterface } from 'readline'
import { simpleParser, type AddressObject } from 'mailparser'
import { getDb } from '../db/connection'
import { folders } from '../db/schema/folders'
import { messages } from '../db/schema/messages'
import { eq, and, sql } from 'drizzle-orm'
import type { FolderType } from '../../../shared/types'
import { computeDedupHash } from '../dedup'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MboxFileInfo {
  /** Full path to the mbox file */
  path: string
  /** Display name (e.g. "Inbox", "Sent") */
  name: string
  /** Relative path within the mail directory (e.g. "INBOX", "Archives.2019") */
  relativePath: string
  /** Size in bytes */
  size: number
  /** Estimated message count (rough, based on "From " line counting) */
  estimatedMessages: number
}

export interface ThunderbirdProfile {
  /** Path to the mail store directory (e.g. ImapMail/imap.example.com or Mail/Local Folders) */
  path: string
  /** Account label from directory name */
  label: string
  /** List of detected mbox files */
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

export type ImportProgressCallback = (progress: ImportProgress) => void

// ─── Thunderbird Profile Detection ──────────────────────────────────────────

/**
 * Detect Thunderbird profile directories.
 * Looks in the standard Thunderbird profile location for the current OS.
 */
export function getDefaultThunderbirdProfilePaths(): string[] {
  const home = process.env.HOME || process.env.USERPROFILE || ''
  const paths: string[] = []

  if (process.platform === 'linux') {
    paths.push(join(home, '.thunderbird'))
  } else if (process.platform === 'darwin') {
    paths.push(join(home, 'Library', 'Thunderbird', 'Profiles'))
  } else if (process.platform === 'win32') {
    const appData = process.env.APPDATA || join(home, 'AppData', 'Roaming')
    paths.push(join(appData, 'Thunderbird', 'Profiles'))
  }

  return paths.filter(p => existsSync(p))
}

/**
 * Scan a directory for mbox files.
 * Thunderbird mbox files are files without an extension (or without .msf)
 * that sit alongside .msf index files.
 * Also handles subdirectory structures like "Inbox.sbd/Subfolder".
 */
export async function scanForMboxFiles(dirPath: string): Promise<MboxFileInfo[]> {
  const results: MboxFileInfo[] = []

  function scanDir(currentPath: string, relativeParts: string[]): void {
    let entries: string[]
    try {
      entries = readdirSync(currentPath)
    } catch {
      return
    }

    for (const entry of entries) {
      const fullPath = join(currentPath, entry)
      let stat
      try {
        stat = statSync(fullPath)
      } catch {
        continue
      }

      if (stat.isDirectory()) {
        // Thunderbird uses .sbd directories for subfolders
        if (entry.endsWith('.sbd')) {
          const folderName = entry.replace(/\.sbd$/, '')
          scanDir(fullPath, [...relativeParts, folderName])
        }
        continue
      }

      // Skip non-mbox files:
      // - .msf files are index files
      // - .dat, .html, .json etc. are not mbox
      // - files starting with . are hidden
      if (
        entry.endsWith('.msf') ||
        entry.endsWith('.dat') ||
        entry.endsWith('.html') ||
        entry.endsWith('.json') ||
        entry.endsWith('.sqlite') ||
        entry.endsWith('.log') ||
        entry.startsWith('.') ||
        entry === 'msgFilterRules.dat' ||
        entry === 'filterlog.html'
      ) {
        continue
      }

      // A file is likely mbox if there's a corresponding .msf file,
      // or if it has no extension and is reasonably sized
      const hasMsfIndex = entries.includes(entry + '.msf')
      const hasNoExtension = !entry.includes('.')

      if (hasMsfIndex || (hasNoExtension && stat.size > 0)) {
        const relPath = [...relativeParts, entry].join('/')
        results.push({
          path: fullPath,
          name: entry,
          relativePath: relPath,
          size: stat.size,
          estimatedMessages: 0 // Will be populated if user requests scan
        })
      }
    }
  }

  scanDir(dirPath, [])

  // Quick estimate of message count by counting "From " lines at start of lines
  for (const mbox of results) {
    mbox.estimatedMessages = await quickCountMessages(mbox.path)
  }

  return results
}

/**
 * Quickly count approximate messages in an mbox file
 * by counting lines starting with "From ".
 */
async function quickCountMessages(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    let count = 0
    const stream = createReadStream(filePath, { encoding: 'utf-8' })
    const rl = createInterface({ input: stream, crlfDelay: Infinity })

    rl.on('line', (line) => {
      if (line.startsWith('From ')) {
        count++
      }
    })

    rl.on('close', () => resolve(count))
    rl.on('error', () => resolve(0))
  })
}

/**
 * Detect the recipient email address(es) from mbox files.
 * Reads the first N messages from the largest mbox file and looks at
 * To/Delivered-To/X-Original-To headers. The most frequent address
 * is likely the account owner.
 *
 * Strategy: sample "Inbox" first (most reliable), fallback to the largest file.
 * Only reads headers (stops at blank line per message), so it's fast.
 */
async function detectRecipientEmails(mboxFiles: MboxFileInfo[]): Promise<string[]> {
  if (mboxFiles.length === 0) return []

  // Prefer Inbox, then largest file
  const inboxFile = mboxFiles.find(f => f.name.toLowerCase() === 'inbox')
  const sorted = [...mboxFiles].sort((a, b) => b.size - a.size)
  const targetFile = inboxFile || sorted[0]

  const emailCounts = new Map<string, number>()
  const MAX_SAMPLES = 20

  return new Promise((resolve) => {
    const stream = createReadStream(targetFile.path, { encoding: 'utf-8' })
    const rl = createInterface({ input: stream, crlfDelay: Infinity })

    let messagesSeen = 0
    let inHeaders = false
    let lastHeaderKey = ''

    rl.on('line', (line) => {
      if (messagesSeen >= MAX_SAMPLES) {
        rl.close()
        stream.destroy()
        return
      }

      if (line.startsWith('From ')) {
        messagesSeen++
        inHeaders = true
        lastHeaderKey = ''
        return
      }

      if (!inHeaders) return

      // Blank line = end of headers
      if (line === '') {
        inHeaders = false
        return
      }

      // Header continuation (starts with whitespace)
      if (/^\s/.test(line)) {
        // Continuation of previous header — skip, we only need the first line value
        return
      }

      // Parse header
      const colonIdx = line.indexOf(':')
      if (colonIdx < 1) return

      const key = line.slice(0, colonIdx).toLowerCase().trim()
      const value = line.slice(colonIdx + 1).trim()
      lastHeaderKey = key

      // Look at recipient-related headers
      if (key === 'to' || key === 'delivered-to' || key === 'x-original-to') {
        // Extract email addresses from the value
        const addrs = extractEmailAddresses(value)
        for (const addr of addrs) {
          const lower = addr.toLowerCase()
          emailCounts.set(lower, (emailCounts.get(lower) || 0) + 1)
        }
      }
    })

    rl.on('close', () => {
      // Sort by frequency, most common first
      const sorted = [...emailCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([email]) => email)
      resolve(sorted)
    })

    rl.on('error', () => resolve([]))
  })
}

/**
 * Extract email addresses from a header value like:
 * "John Doe <john@example.com>, jane@example.com"
 */
function extractEmailAddresses(headerValue: string): string[] {
  const emails: string[] = []

  // Match <email> patterns
  const angleBracketRegex = /<([^>]+@[^>]+)>/g
  let match
  while ((match = angleBracketRegex.exec(headerValue)) !== null) {
    emails.push(match[1].trim())
  }

  // If no angle-bracket addresses found, try bare email
  if (emails.length === 0) {
    const parts = headerValue.split(',')
    for (const part of parts) {
      const trimmed = part.trim()
      if (trimmed.includes('@') && !trimmed.includes(' ')) {
        emails.push(trimmed)
      }
    }
  }

  return emails
}

/**
 * Scan a Thunderbird profile or mail root for importable mail stores.
 * This handles both:
 * - A full Thunderbird profile dir (contains ImapMail/, Mail/ subdirs)
 * - A direct mail store dir (e.g. ImapMail/imap.example.com)
 */
export async function scanThunderbirdPath(rootPath: string): Promise<ThunderbirdProfile[]> {
  const profiles: ThunderbirdProfile[] = []

  // Check if this is a Thunderbird profile root (has ImapMail/ or Mail/)
  const imapMailPath = join(rootPath, 'ImapMail')
  const localMailPath = join(rootPath, 'Mail')

  if (existsSync(imapMailPath)) {
    // Scan each server directory under ImapMail/
    const serverDirs = readdirSync(imapMailPath).filter(name => {
      const fullPath = join(imapMailPath, name)
      return statSync(fullPath).isDirectory()
    })

    for (const serverDir of serverDirs) {
      const serverPath = join(imapMailPath, serverDir)
      const mboxFiles = await scanForMboxFiles(serverPath)
      if (mboxFiles.length > 0) {
        const detectedEmails = await detectRecipientEmails(mboxFiles)
        profiles.push({
          path: serverPath,
          label: serverDir,
          mboxFiles,
          detectedEmails
        })
      }
    }
  }

  if (existsSync(localMailPath)) {
    const serverDirs = readdirSync(localMailPath).filter(name => {
      const fullPath = join(localMailPath, name)
      return statSync(fullPath).isDirectory()
    })

    for (const serverDir of serverDirs) {
      const serverPath = join(localMailPath, serverDir)
      const mboxFiles = await scanForMboxFiles(serverPath)
      if (mboxFiles.length > 0) {
        const detectedEmails = await detectRecipientEmails(mboxFiles)
        profiles.push({
          path: serverPath,
          label: `Local - ${serverDir}`,
          mboxFiles,
          detectedEmails
        })
      }
    }
  }

  // If neither ImapMail/ nor Mail/ found, treat the dir itself as a mail store
  if (profiles.length === 0) {
    const mboxFiles = await scanForMboxFiles(rootPath)
    if (mboxFiles.length > 0) {
      const detectedEmails = await detectRecipientEmails(mboxFiles)
      profiles.push({
        path: rootPath,
        label: basename(rootPath),
        mboxFiles,
        detectedEmails
      })
    }
  }

  return profiles
}

// ─── Mbox Parser ────────────────────────────────────────────────────────────

/**
 * Parse an mbox file and yield individual raw email messages.
 * Mbox format: messages separated by lines starting with "From "
 * (the mbox "From_" separator line).
 */
async function* parseMboxFile(filePath: string): AsyncGenerator<Buffer> {
  const stream = createReadStream(filePath)
  const rl = createInterface({ input: stream, crlfDelay: Infinity })

  let currentMessage: string[] = []
  let inMessage = false

  for await (const line of rl) {
    if (line.startsWith('From ')) {
      // If we have a previous message, yield it
      if (inMessage && currentMessage.length > 0) {
        yield Buffer.from(currentMessage.join('\r\n'))
      }
      currentMessage = []
      inMessage = true
      continue
    }

    if (inMessage) {
      // Unescape mbox "From " escaping: ">From " → "From "
      if (line.startsWith('>From ')) {
        currentMessage.push(line.slice(1))
      } else {
        currentMessage.push(line)
      }
    }
  }

  // Yield the last message
  if (currentMessage.length > 0) {
    yield Buffer.from(currentMessage.join('\r\n'))
  }
}

// ─── Import Logic ───────────────────────────────────────────────────────────

/**
 * Guess folder type from the mbox file name / path.
 */
function guessFolderType(name: string): FolderType {
  const lower = name.toLowerCase()
  if (lower === 'inbox') return 'inbox'
  if (lower === 'sent' || lower.includes('sent')) return 'sent'
  if (lower === 'drafts' || lower.includes('draft')) return 'drafts'
  if (lower === 'trash' || lower.includes('trash') || lower.includes('deleted')) return 'trash'
  if (lower === 'junk' || lower === 'spam' || lower.includes('spam')) return 'spam'
  if (lower.includes('archive')) return 'archive'
  return 'custom'
}

/**
 * Extract address info from mailparser AddressObject.
 */
function extractAddresses(addr: AddressObject | AddressObject[] | undefined): Array<{ name: string; address: string }> {
  if (!addr) return []
  const objects = Array.isArray(addr) ? addr : [addr]
  const result: Array<{ name: string; address: string }> = []
  for (const obj of objects) {
    if (obj.value) {
      for (const val of obj.value) {
        result.push({
          name: val.name || '',
          address: val.address || ''
        })
      }
    }
  }
  return result
}

/**
 * Import selected mbox files into the database, associating with the given account.
 * Creates folders as needed and inserts all messages.
 * Uses dedup_hash (SHA-256 of Message-ID or from+date+subject) to skip duplicates.
 */
export async function importMboxFiles(
  accountId: number,
  mboxFiles: MboxFileInfo[],
  onProgress?: ImportProgressCallback
): Promise<{ totalImported: number; duplicatesSkipped: number; foldersCreated: number }> {
  const db = getDb()
  let totalImported = 0
  let duplicatesSkipped = 0
  let foldersCreated = 0

  for (let fileIdx = 0; fileIdx < mboxFiles.length; fileIdx++) {
    const mbox = mboxFiles[fileIdx]

    onProgress?.({
      phase: 'parsing',
      currentFile: mbox.name,
      totalFiles: mboxFiles.length,
      currentFileIndex: fileIdx,
      messagesImported: totalImported,
      messagesTotal: mboxFiles.reduce((sum, f) => sum + f.estimatedMessages, 0)
    })

    // Find or create the folder for this mbox
    const folderName = mbox.name
    const folderPath = mbox.relativePath
    const folderType = guessFolderType(folderName)

    let [existingFolder] = await db
      .select()
      .from(folders)
      .where(and(eq(folders.accountId, accountId), eq(folders.path, folderPath)))

    if (!existingFolder) {
      const [newFolder] = await db
        .insert(folders)
        .values({
          accountId,
          name: folderName,
          path: folderPath,
          type: folderType,
          delimiter: '/',
          unreadCount: 0,
          totalCount: 0
        })
        .returning()
      existingFolder = newFolder
      foldersCreated++
    }

    const folderId = existingFolder.id

    // Parse and insert messages in batches
    const BATCH_SIZE = 50
    let batch: Array<typeof messages.$inferInsert> = []
    let uidCounter = 1 // Synthetic UIDs for imported messages

    // Find the max existing UID in this folder to continue from there
    const [maxUidRow] = await db
      .select({ maxUid: sql<number>`COALESCE(MAX(${messages.uid}), 0)` })
      .from(messages)
      .where(eq(messages.folderId, folderId))

    uidCounter = (maxUidRow?.maxUid ?? 0) + 1

    for await (const rawMessage of parseMboxFile(mbox.path)) {
      try {
        const parsed = await simpleParser(rawMessage)
        const fromAddrs = extractAddresses(parsed.from)
        const toAddrs = extractAddresses(parsed.to)
        const ccAddrs = extractAddresses(parsed.cc)
        const bccAddrs = extractAddresses(parsed.bcc)

        const bodyText = parsed.text || ''
        const bodyHtml = parsed.html || ''
        const preview = bodyText.slice(0, 280).replace(/\s+/g, ' ').trim()

        // Compute dedup hash
        const dedupHash = computeDedupHash({
          messageId: parsed.messageId,
          fromAddress: fromAddrs[0]?.address || '',
          date: parsed.date ?? null,
          subject: parsed.subject || ''
        })

        // Determine flags from email headers
        const flags = {
          seen: true, // Imported messages default to read
          flagged: false,
          answered: false,
          draft: folderType === 'drafts',
          deleted: false
        }

        // Check X-Mozilla-Status header for Thunderbird flags
        const mozStatus = parsed.headers.get('x-mozilla-status')
        if (mozStatus) {
          const statusHex = parseInt(String(mozStatus), 16)
          if (!isNaN(statusHex)) {
            flags.seen = (statusHex & 0x0001) !== 0
            flags.answered = (statusHex & 0x0002) !== 0
            flags.flagged = (statusHex & 0x0004) !== 0
            flags.deleted = (statusHex & 0x0008) !== 0
          }
        }

        const hasAttachments = (parsed.attachments?.length ?? 0) > 0

        batch.push({
          accountId,
          folderId,
          messageId: parsed.messageId || null,
          dedupHash,
          uid: uidCounter++,
          subject: parsed.subject || '(no subject)',
          fromAddress: fromAddrs[0]?.address || '',
          fromName: fromAddrs[0]?.name || '',
          toAddresses: toAddrs,
          ccAddresses: ccAddrs,
          bccAddresses: bccAddrs,
          date: parsed.date ?? null,
          bodyText,
          bodyHtml: bodyHtml || '',
          preview,
          flags,
          size: rawMessage.length,
          hasAttachments
        })

        if (batch.length >= BATCH_SIZE) {
          const inserted = await insertBatchWithDedup(db, batch)
          totalImported += inserted
          duplicatesSkipped += batch.length - inserted
          batch = []

          onProgress?.({
            phase: 'parsing',
            currentFile: mbox.name,
            totalFiles: mboxFiles.length,
            currentFileIndex: fileIdx,
            messagesImported: totalImported,
            messagesTotal: mboxFiles.reduce((sum, f) => sum + f.estimatedMessages, 0)
          })
        }
      } catch (err) {
        // Skip unparseable messages but log the error
        console.error(`[Import] Failed to parse message in ${mbox.name}:`, err instanceof Error ? err.message : err)
        continue
      }
    }

    // Insert remaining batch
    if (batch.length > 0) {
      const inserted = await insertBatchWithDedup(db, batch)
      totalImported += inserted
      duplicatesSkipped += batch.length - inserted
    }

    // Update folder counts
    const [countResult] = await db
      .select({ cnt: sql<number>`COUNT(*)::int` })
      .from(messages)
      .where(eq(messages.folderId, folderId))

    const totalCount = countResult?.cnt ?? 0

    const [unreadResult] = await db
      .select({ cnt: sql<number>`COUNT(*)::int` })
      .from(messages)
      .where(and(
        eq(messages.folderId, folderId),
        sql`(${messages.flags}->>'seen')::text = 'false'`
      ))

    const unreadCount = unreadResult?.cnt ?? 0

    await db.update(folders)
      .set({ totalCount, unreadCount })
      .where(eq(folders.id, folderId))
  }

  onProgress?.({
    phase: 'done',
    currentFile: '',
    totalFiles: mboxFiles.length,
    currentFileIndex: mboxFiles.length,
    messagesImported: totalImported,
    messagesTotal: totalImported
  })

  return { totalImported, duplicatesSkipped, foldersCreated }
}

/**
 * Insert a batch of messages with dedup — uses ON CONFLICT DO NOTHING
 * on the (account_id, dedup_hash) unique index.
 * Returns the number of rows actually inserted (excluding duplicates).
 */
async function insertBatchWithDedup(
  db: ReturnType<typeof getDb>,
  batch: Array<typeof messages.$inferInsert>
): Promise<number> {
  const result = await db
    .insert(messages)
    .values(batch)
    .onConflictDoNothing({
      target: [messages.accountId, messages.dedupHash]
    })
    .returning({ id: messages.id })

  return result.length
}
