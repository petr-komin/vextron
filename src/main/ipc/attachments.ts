import { type IpcMainInvokeEvent, dialog, shell, app } from 'electron'
import { getDb } from '../services/db/connection'
import { messages } from '../services/db/schema/messages'
import { folders } from '../services/db/schema/folders'
import { eq } from 'drizzle-orm'
import { imapManager } from '../services/imap/connection-manager'
import { toServerPath } from '../services/imap/sync'
import type { AttachmentSaveResult } from '../../shared/types'
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Download the full message from IMAP, parse it, and return the attachment
 * content as a Buffer by matching the partNumber (index).
 */
async function fetchAttachmentContent(
  messageDbId: number,
  partNumber: string
): Promise<{ content: Buffer; filename: string; contentType: string }> {
  const db = getDb()

  const [msg] = await db.select().from(messages).where(eq(messages.id, messageDbId))
  if (!msg) throw new Error(`Message ${messageDbId} not found`)

  const [folder] = await db.select().from(folders).where(eq(folders.id, msg.folderId))
  if (!folder) throw new Error(`Folder ${msg.folderId} not found`)

  return imapManager.withClient(msg.accountId, async (client) => {
    const lock = await client.getMailboxLock(toServerPath(folder))
    try {
      const source = await client.download(String(msg.uid), undefined, { uid: true })
      if (!source?.content) {
        throw new Error('Failed to download message from IMAP')
      }

      const chunks: Buffer[] = []
      for await (const chunk of source.content) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      }
      const rawSource = Buffer.concat(chunks).toString('utf-8')

      const { simpleParser } = await import('mailparser')
      const parsed = await simpleParser(rawSource)

      if (!parsed.attachments || parsed.attachments.length === 0) {
        throw new Error('No attachments found in message')
      }

      // partNumber is 1-based index (as we assigned in sync.ts)
      const index = parseInt(partNumber, 10) - 1
      if (index < 0 || index >= parsed.attachments.length) {
        throw new Error(`Attachment with partNumber ${partNumber} not found`)
      }

      const att = parsed.attachments[index]
      return {
        content: att.content,
        filename: att.filename || `attachment-${partNumber}`,
        contentType: att.contentType || 'application/octet-stream'
      }
    } finally {
      lock.release()
    }
  })
}

/**
 * Get MIME type filter label for save dialog.
 */
function getFileExtension(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot > 0 ? filename.substring(dot + 1) : ''
}

export const attachmentsHandlers = {
  /**
   * Download an attachment and prompt the user to save it via native file dialog.
   */
  'attachments:download': async (
    _event: IpcMainInvokeEvent,
    messageId: number,
    partNumber: string,
    filename: string
  ): Promise<AttachmentSaveResult> => {
    try {
      // Show save dialog first — if user cancels, skip the IMAP download
      const ext = getFileExtension(filename)
      const result = await dialog.showSaveDialog({
        defaultPath: filename,
        filters: ext
          ? [{ name: `${ext.toUpperCase()} files`, extensions: [ext] }, { name: 'All files', extensions: ['*'] }]
          : [{ name: 'All files', extensions: ['*'] }]
      })

      if (result.canceled || !result.filePath) {
        return { success: false }
      }

      const { content } = await fetchAttachmentContent(messageId, partNumber)
      await writeFile(result.filePath, content)

      return { success: true, filePath: result.filePath }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[Attachments] Download failed:', message)
      return { success: false, error: message }
    }
  },

  /**
   * Download an attachment to a temp directory and open it with the system default app.
   */
  'attachments:open': async (
    _event: IpcMainInvokeEvent,
    messageId: number,
    partNumber: string,
    filename: string
  ): Promise<AttachmentSaveResult> => {
    try {
      const { content } = await fetchAttachmentContent(messageId, partNumber)

      // Save to temp directory under app-specific folder
      const tempDir = join(app.getPath('temp'), 'vextron-attachments')
      await mkdir(tempDir, { recursive: true })

      // Add timestamp prefix to avoid collisions
      const safeFilename = `${Date.now()}-${filename.replace(/[<>:"/\\|?*]/g, '_')}`
      const tempPath = join(tempDir, safeFilename)
      await writeFile(tempPath, content)

      // Open with system default application
      const errorMessage = await shell.openPath(tempPath)
      if (errorMessage) {
        return { success: false, error: errorMessage }
      }

      return { success: true, filePath: tempPath }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[Attachments] Open failed:', message)
      return { success: false, error: message }
    }
  }
}
