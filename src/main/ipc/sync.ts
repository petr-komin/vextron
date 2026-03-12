import { ipcMain, BrowserWindow } from 'electron'
import { fullAccountSync } from '../services/imap/sync'
import type { SyncProgress } from '../services/imap/sync'

/**
 * Sync IPC handlers.
 * These run long operations and send progress events to the renderer.
 */
export function registerSyncHandlers(): void {
  ipcMain.handle(
    'sync:fullAccount',
    async (_event, accountId: number, inboxOnly: boolean = true) => {
      console.log(`[Sync] Starting full account sync for account ${accountId}`)

      const win = BrowserWindow.getAllWindows()[0]

      const onProgress: (progress: SyncProgress) => void = (progress) => {
        if (win && !win.isDestroyed()) {
          // Send as plain object to avoid clone issues
          win.webContents.send('sync:progress', JSON.parse(JSON.stringify(progress)))
        }
      }

      try {
        const result = await fullAccountSync(accountId, onProgress, inboxOnly)
        console.log(`[Sync] Complete: ${result.foldersCount} folders, ${result.messagesCount} messages`)

        const plainResult = {
          accountId,
          foldersCount: result.foldersCount,
          messagesCount: result.messagesCount
        }

        if (win && !win.isDestroyed()) {
          win.webContents.send('sync:complete', plainResult)
        }

        return plainResult
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error('[Sync] Full account sync failed:', message)
        throw new Error(message)
      }
    }
  )
}
