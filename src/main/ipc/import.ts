import { ipcMain, dialog, BrowserWindow } from 'electron'
import {
  scanThunderbirdPath,
  importMboxFiles,
  getDefaultThunderbirdProfilePaths,
  type MboxFileInfo,
  type ThunderbirdProfile,
  type ImportProgress
} from '../services/import/thunderbird'

export function registerImportHandlers(): void {
  /**
   * Open a directory picker dialog and scan for Thunderbird mbox files.
   * If no path is provided, opens the native folder picker.
   */
  ipcMain.handle(
    'import:scan',
    async (_event, providedPath?: string): Promise<ThunderbirdProfile[]> => {
      let scanPath = providedPath

      if (!scanPath) {
        // Open native folder picker
        const win = BrowserWindow.getAllWindows()[0]
        const result = await dialog.showOpenDialog(win, {
          title: 'Select Thunderbird profile or mail directory',
          defaultPath: getDefaultThunderbirdProfilePaths()[0] || undefined,
          properties: ['openDirectory']
        })

        if (result.canceled || result.filePaths.length === 0) {
          return []
        }
        scanPath = result.filePaths[0]
      }

      return await scanThunderbirdPath(scanPath)
    }
  )

  /**
   * Get default Thunderbird profile paths for the current OS.
   */
  ipcMain.handle(
    'import:defaultPaths',
    async (): Promise<string[]> => {
      return getDefaultThunderbirdProfilePaths()
    }
  )

  /**
   * Run the actual import of selected mbox files into an account.
   * Sends progress events to the renderer.
   */
  ipcMain.handle(
    'import:run',
    async (_event, accountId: number, mboxFiles: MboxFileInfo[]) => {
      const win = BrowserWindow.getAllWindows()[0]

      const onProgress = (progress: ImportProgress): void => {
        if (win && !win.isDestroyed()) {
          win.webContents.send('import:progress', JSON.parse(JSON.stringify(progress)))
        }
      }

      try {
        const result = await importMboxFiles(accountId, mboxFiles, onProgress)
        return result
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error('[Import] Import failed:', message)
        throw new Error(message)
      }
    }
  )
}
