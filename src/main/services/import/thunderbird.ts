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
  messagesProcessed: number
  duplicatesSkipped: number
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
 * Lightweight header extraction from a raw email buffer.
 * Only parses header lines until the first blank line (end of headers).
 * Returns the four fields needed for dedup hash computation.
 * This is ~100x faster than simpleParser for messages we'll skip as duplicates.
 */
function extractQuickHeaders(raw: Buffer): {
  messageId: string | null
  from: string
  date: string | null
  subject: string
} {
  const result = { messageId: null as string | null, from: '', date: null as string | null, subject: '' }

  // Only read up to the first blank line (end of headers).
  // Convert just the header portion to string to avoid decoding large bodies.
  const headerEndIdx = raw.indexOf('\r\n\r\n')
  const altHeaderEndIdx = raw.indexOf('\n\n')
  const endIdx = headerEndIdx >= 0
    ? (altHeaderEndIdx >= 0 ? Math.min(headerEndIdx, altHeaderEndIdx) : headerEndIdx)
    : altHeaderEndIdx
  const headerStr = endIdx >= 0
    ? raw.subarray(0, endIdx).toString('utf-8')
    : raw.toString('utf-8') // no blank line found — entire buffer is headers (unlikely)

  // Unfold headers: lines starting with whitespace are continuations
  const unfolded = headerStr.replace(/\r?\n[ \t]+/g, ' ')

  for (const line of unfolded.split(/\r?\n/)) {
    const colonIdx = line.indexOf(':')
    if (colonIdx < 1) continue

    const key = line.slice(0, colonIdx).toLowerCase().trim()
    const value = line.slice(colonIdx + 1).trim()

    switch (key) {
      case 'message-id':
        result.messageId = value
        break
      case 'from': {
        // Extract bare email from "Name <email>" or just "email"
        const match = value.match(/<([^>]+@[^>]+)>/)
        result.from = match ? match[1].trim() : (value.includes('@') ? value.trim() : '')
        break
      }
      case 'date':
        result.date = value
        break
      case 'subject':
        result.subject = value
        break
    }

    // Early exit once we have all four
    if (result.messageId && result.from && result.date && result.subject) break
  }

  return result
}

/**
 * Parse an mbox file and yield individual raw email messages.
 * Mbox format: messages separated by lines starting with "From "
 * (the mbox "From_" separator line).
 *
 * Messages larger than MAX_MESSAGE_SIZE are skipped (logged and discarded)
 * to avoid freezing on huge attachments.
 * Periodically yields the event loop so IPC messages can flush.
 */
const MAX_MESSAGE_SIZE = 25 * 1024 * 1024 // 25 MB

async function* parseMboxFile(filePath: string): AsyncGenerator<Buffer> {
  const stream = createReadStream(filePath)
  const rl = createInterface({ input: stream, crlfDelay: Infinity })

  let currentMessage: string[] = []
  let currentSize = 0
  let inMessage = false
  let skipping = false  // true when current message exceeds size limit
  let lineCount = 0

  for await (const line of rl) {
    if (line.startsWith('From ')) {
      // If we have a previous message, yield it (unless it was too large)
      if (inMessage && currentMessage.length > 0 && !skipping) {
        yield Buffer.from(currentMessage.join('\r\n'))
      } else if (skipping) {
        console.warn(`[Import] Skipped oversized message (${(currentSize / (1024 * 1024)).toFixed(1)} MB) in ${filePath}`)
      }
      currentMessage = []
      currentSize = 0
      inMessage = true
      skipping = false
      continue
    }

    if (inMessage) {
      // Check size limit — if exceeded, just drain lines without storing
      currentSize += line.length + 2 // +2 for \r\n
      if (currentSize > MAX_MESSAGE_SIZE) {
        if (!skipping) {
          skipping = true
          currentMessage = [] // free memory
        }
        continue
      }

      // Unescape mbox "From " escaping: ">From " → "From "
      if (line.startsWith('>From ')) {
        currentMessage.push(line.slice(1))
      } else {
        currentMessage.push(line)
      }
    }

    // Yield event loop every 10 000 lines so IPC doesn't starve
    lineCount++
    if (lineCount % 10000 === 0) {
      await new Promise(resolve => setImmediate(resolve))
    }
  }

  // Yield the last message
  if (currentMessage.length > 0 && !skipping) {
    yield Buffer.from(currentMessage.join('\r\n'))
  } else if (skipping) {
    console.warn(`[Import] Skipped oversized message (${(currentSize / (1024 * 1024)).toFixed(1)} MB) at end of ${filePath}`)
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
 *
 * Optimization: loads all existing dedup hashes for the account upfront, then
 * does a lightweight header-only extraction to compute the hash before deciding
 * whether to run the expensive full simpleParser. Known duplicates are skipped
 * without any heavy parsing.
 */
export async function importMboxFiles(
  accountId: number,
  mboxFiles: MboxFileInfo[],
  onProgress?: ImportProgressCallback
): Promise<{ totalImported: number; duplicatesSkipped: number; foldersCreated: number }> {
  const db = getDb()
  let totalImported = 0
  let duplicatesSkipped = 0
  let messagesProcessed = 0
  let foldersCreated = 0
  const estimatedTotal = mboxFiles.reduce((sum, f) => sum + f.estimatedMessages, 0)

  // ── Pre-load all existing dedup hashes for this account ──────────────────
  // Single query, builds an in-memory Set for O(1) lookup.
  const existingRows = await db
    .select({ hash: messages.dedupHash })
    .from(messages)
    .where(eq(messages.accountId, accountId))

  const existingHashes = new Set(existingRows.map(r => r.hash).filter(Boolean))
  console.log(`[Import] Pre-loaded ${existingHashes.size} existing dedup hashes for account ${accountId}`)

  for (let fileIdx = 0; fileIdx < mboxFiles.length; fileIdx++) {
    const mbox = mboxFiles[fileIdx]

    onProgress?.({
      phase: 'parsing',
      currentFile: mbox.name,
      totalFiles: mboxFiles.length,
      currentFileIndex: fileIdx,
      messagesImported: totalImported,
      messagesProcessed,
      duplicatesSkipped,
      messagesTotal: estimatedTotal
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

    // Throttle progress updates — at most every 200ms
    let lastProgressTime = 0

    for await (const rawMessage of parseMboxFile(mbox.path)) {
      let countedThisMessage = false
      try {
        const msgSizeMB = (rawMessage.length / (1024 * 1024)).toFixed(1)
        if (rawMessage.length > 5 * 1024 * 1024) {
          console.log(`[Import] Large message #${messagesProcessed + 1} in ${mbox.name}: ${msgSizeMB} MB`)
        }

        // ── Lightweight dedup check ──────────────────────────────────────
        // Extract just the headers we need (Message-ID, From, Date, Subject)
        // without running the full MIME parser. This is ~100x faster than
        // simpleParser for messages we're going to skip anyway.
        const quickHeaders = extractQuickHeaders(rawMessage)
        const dedupHash = computeDedupHash({
          messageId: quickHeaders.messageId,
          fromAddress: quickHeaders.from,
          date: quickHeaders.date ? new Date(quickHeaders.date) : null,
          subject: quickHeaders.subject
        })

        messagesProcessed++
        countedThisMessage = true

        if (existingHashes.has(dedupHash)) {
          // Already in DB — skip expensive full parse entirely
          duplicatesSkipped++

          // Throttled progress update + event loop yield so IPC messages
          // actually reach the renderer (without this, the tight skip loop
          // starves the event loop and progress events queue but never flush)
          const now = Date.now()
          if (now - lastProgressTime >= 200) {
            lastProgressTime = now
            onProgress?.({
              phase: 'parsing',
              currentFile: mbox.name,
              totalFiles: mboxFiles.length,
              currentFileIndex: fileIdx,
              messagesImported: totalImported,
              messagesProcessed,
              duplicatesSkipped,
              messagesTotal: estimatedTotal
            })
            // Yield event loop so IPC send() actually flushes to renderer
            await new Promise(resolve => setImmediate(resolve))
          }
          continue
        }

        // ── Full parse (only for genuinely new messages) ─────────────────
        // Timeout after 10s to avoid hanging on malformed/huge messages
        const parsePromise = simpleParser(rawMessage)
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`simpleParser timeout (${msgSizeMB} MB)`)), 10000)
        )
        const parsed = await Promise.race([parsePromise, timeoutPromise])
        const fromAddrs = extractAddresses(parsed.from)
        const toAddrs = extractAddresses(parsed.to)
        const ccAddrs = extractAddresses(parsed.cc)
        const bccAddrs = extractAddresses(parsed.bcc)

        const bodyText = parsed.text || ''
        const bodyHtml = parsed.html || ''
        const preview = bodyText.slice(0, 280).replace(/\s+/g, ' ').trim()

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

        // Add to local set so duplicates within the same import are caught too
        existingHashes.add(dedupHash)

        if (batch.length >= BATCH_SIZE) {
          const { inserted, failed } = await insertBatchSafe(db, batch)
          totalImported += inserted
          duplicatesSkipped += batch.length - inserted - failed
          batch = []
        }

        // Throttled progress update
        const now = Date.now()
        if (now - lastProgressTime >= 200) {
          lastProgressTime = now
          onProgress?.({
            phase: 'parsing',
            currentFile: mbox.name,
            totalFiles: mboxFiles.length,
            currentFileIndex: fileIdx,
            messagesImported: totalImported,
            messagesProcessed,
            duplicatesSkipped,
            messagesTotal: estimatedTotal
          })
        }
      } catch (err) {
        if (!countedThisMessage) {
          messagesProcessed++
        }
        // Log truncated error — avoid dumping raw email content to console
        const errMsg = err instanceof Error ? err.message : String(err)
        console.error(`[Import] Failed to parse message #${messagesProcessed} in ${mbox.name}: ${errMsg.slice(0, 200)}`)

        // Throttled progress + event loop yield in error path too
        const now = Date.now()
        if (now - lastProgressTime >= 200) {
          lastProgressTime = now
          onProgress?.({
            phase: 'parsing',
            currentFile: mbox.name,
            totalFiles: mboxFiles.length,
            currentFileIndex: fileIdx,
            messagesImported: totalImported,
            messagesProcessed,
            duplicatesSkipped,
            messagesTotal: estimatedTotal
          })
          await new Promise(resolve => setImmediate(resolve))
        }
        continue
      }
    }

    // Insert remaining batch
    if (batch.length > 0) {
      const { inserted, failed } = await insertBatchSafe(db, batch)
      totalImported += inserted
      duplicatesSkipped += batch.length - inserted - failed
    }

    // Final progress for this file
    onProgress?.({
      phase: 'parsing',
      currentFile: mbox.name,
      totalFiles: mboxFiles.length,
      currentFileIndex: fileIdx,
      messagesImported: totalImported,
      messagesProcessed,
      duplicatesSkipped,
      messagesTotal: estimatedTotal
    })

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
    messagesProcessed,
    duplicatesSkipped,
    messagesTotal: messagesProcessed
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

/**
 * Safe batch insert wrapper. Tries the full batch first (fast path).
 * If the batch INSERT fails (e.g. value too long, constraint violation),
 * falls back to inserting one-by-one to skip only the problematic messages.
 */
async function insertBatchSafe(
  db: ReturnType<typeof getDb>,
  batch: Array<typeof messages.$inferInsert>
): Promise<{ inserted: number; failed: number }> {
  try {
    const inserted = await insertBatchWithDedup(db, batch)
    return { inserted, failed: 0 }
  } catch (batchErr) {
    // Batch failed — fall back to one-by-one to find the bad message(s)
    console.warn(`[Import] Batch insert failed, falling back to one-by-one: ${
      batchErr instanceof Error ? batchErr.message.slice(0, 150) : 'unknown error'
    }`)
    let inserted = 0
    let failed = 0
    for (const msg of batch) {
      try {
        const result = await insertBatchWithDedup(db, [msg])
        inserted += result
      } catch (singleErr) {
        failed++
        console.error(`[Import] Skipping bad message (subject: ${
          (msg.subject || '').slice(0, 80)
        }): ${singleErr instanceof Error ? singleErr.message.slice(0, 150) : 'unknown error'}`)
      }
    }
    return { inserted, failed }
  }
}
