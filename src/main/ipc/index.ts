import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { accountsHandlers } from './accounts'
import { foldersHandlers } from './folders'
import { messagesHandlers } from './messages'
import { registerSyncHandlers } from './sync'
import { registerImportHandlers } from './import'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IpcHandler = (event: IpcMainInvokeEvent, ...args: any[]) => Promise<any>

interface HandlerMap {
  [channel: string]: IpcHandler
}

/**
 * Ensure a value is safely serializable via structured clone.
 * Strips class instances, circular refs, etc. by round-tripping through JSON.
 */
function safeClone<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return value
  }
}

/**
 * Wrap an IPC handler so its return value is always cloneable,
 * and errors are serialized as plain Error objects with a message string.
 */
function wrapHandler(channel: string, handler: IpcHandler): IpcHandler {
  return async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    try {
      const result = await handler(event, ...args)
      // Ensure the result is structured-clone safe
      return safeClone(result)
    } catch (error) {
      // Re-throw as a plain Error with just the message string.
      // Electron can serialize basic Error objects, but not all subclasses.
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[IPC] Error in ${channel}:`, message)
      throw new Error(message)
    }
  }
}

export function registerIpcHandlers(): void {
  const allHandlers: HandlerMap = {
    ...accountsHandlers,
    ...foldersHandlers,
    ...messagesHandlers
  } as HandlerMap

  for (const [channel, handler] of Object.entries(allHandlers)) {
    ipcMain.handle(channel, wrapHandler(channel, handler))
  }

  // Register sync handlers (these use ipcMain.handle directly with event emitters)
  registerSyncHandlers()

  // Register import handlers (Thunderbird mbox import)
  registerImportHandlers()

  console.log(`[IPC] Registered ${Object.keys(allHandlers).length + 2} handlers`)
}
