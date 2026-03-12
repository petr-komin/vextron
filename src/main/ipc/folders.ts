import type { IpcMainInvokeEvent } from 'electron'
import type { Folder, FolderType } from '../../shared/types'
import { getDb } from '../services/db/connection'
import { folders } from '../services/db/schema/folders'
import { eq } from 'drizzle-orm'
import { syncAccountFolders } from '../services/imap/sync'

export const foldersHandlers = {
  'folders:list': async (_event: IpcMainInvokeEvent, accountId: number): Promise<Folder[]> => {
    const db = getDb()
    const rows = await db.select().from(folders).where(eq(folders.accountId, accountId))
    return rows.map(mapFolderRow)
  },

  'folders:sync': async (_event: IpcMainInvokeEvent, accountId: number): Promise<Folder[]> => {
    console.log(`[Folders] Syncing folders for account ${accountId}`)
    const syncedRows = await syncAccountFolders(accountId)
    console.log(`[Folders] Synced ${syncedRows.length} folders`)
    return syncedRows.map(mapFolderRow)
  }
}

function mapFolderRow(row: typeof folders.$inferSelect): Folder {
  return {
    id: row.id,
    accountId: row.accountId,
    name: row.name,
    path: row.path,
    type: row.type as FolderType,
    unreadCount: row.unreadCount,
    totalCount: row.totalCount,
    delimiter: row.delimiter
  }
}
