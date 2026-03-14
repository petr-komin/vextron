import { BrowserWindow } from 'electron'
import { getDb } from './db/connection'
import { accounts } from './db/schema/accounts'
import { fullAccountSync } from './imap/sync'
import { autoAnalyzeMessages } from './ai/analyze'
import { eq, gt } from 'drizzle-orm'

/**
 * Periodic sync scheduler.
 * Manages per-account timers that run `fullAccountSync` at the configured interval.
 * Emits 'sync:complete' events to the renderer when sync finishes.
 */

/** Active timers per account ID */
const timers = new Map<number, ReturnType<typeof setInterval>>()

/** Prevent concurrent syncs for the same account */
const syncing = new Set<number>()

/**
 * Run a single sync cycle for one account.
 * Silently catches errors (connection failures etc.) — periodic sync should never crash the app.
 */
async function syncAccount(accountId: number): Promise<void> {
  if (syncing.has(accountId)) {
    console.log(`[SyncScheduler] Account ${accountId} is already syncing, skipping`)
    return
  }
  syncing.add(accountId)
  try {
    console.log(`[SyncScheduler] Periodic sync starting for account ${accountId}`)
    const result = await fullAccountSync(accountId, undefined, false) // sync inbox + sent + drafts
    console.log(
      `[SyncScheduler] Periodic sync complete for account ${accountId}: ` +
      `${result.foldersCount} folders, ${result.messagesCount} messages`
    )

    // Auto-AI: analyze new messages if enabled for this account
    let aiAnalyzed = 0
    if (result.newMessageIds.length > 0) {
      const db = getDb()
      const [account] = await db
        .select({ autoAnalyze: accounts.autoAnalyze })
        .from(accounts)
        .where(eq(accounts.id, accountId))

      if (account?.autoAnalyze) {
        console.log(
          `[SyncScheduler] Auto-AI enabled for account ${accountId}, ` +
          `analyzing ${result.newMessageIds.length} new message(s)...`
        )
        const aiResult = await autoAnalyzeMessages(accountId, result.newMessageIds)
        aiAnalyzed = aiResult.analyzed
      }
    }

    // Notify the renderer so it can refresh the UI
    const win = BrowserWindow.getAllWindows()[0]
    if (win && !win.isDestroyed()) {
      win.webContents.send('sync:complete', {
        accountId,
        foldersCount: result.foldersCount,
        messagesCount: result.messagesCount,
        aiAnalyzed
      })
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.warn(`[SyncScheduler] Periodic sync failed for account ${accountId}:`, msg)
  } finally {
    syncing.delete(accountId)
  }
}

/**
 * Start or update the periodic timer for a specific account.
 * If intervalMinutes is 0 or less, any existing timer is cleared.
 */
function scheduleAccount(accountId: number, intervalMinutes: number): void {
  // Clear any existing timer
  const existing = timers.get(accountId)
  if (existing) {
    clearInterval(existing)
    timers.delete(accountId)
  }

  if (intervalMinutes <= 0) {
    console.log(`[SyncScheduler] Periodic sync disabled for account ${accountId}`)
    return
  }

  const intervalMs = intervalMinutes * 60 * 1000
  console.log(`[SyncScheduler] Scheduling account ${accountId} every ${intervalMinutes} min`)

  const timer = setInterval(() => {
    syncAccount(accountId)
  }, intervalMs)

  timers.set(accountId, timer)
}

/**
 * Initialize the scheduler: read all accounts from DB and set up timers
 * for those with sync_interval_minutes > 0.
 * Call this once at app startup (after DB is ready).
 */
export async function initSyncScheduler(): Promise<void> {
  console.log('[SyncScheduler] Initializing...')
  const db = getDb()
  const rows = await db
    .select({ id: accounts.id, syncIntervalMinutes: accounts.syncIntervalMinutes })
    .from(accounts)
    .where(gt(accounts.syncIntervalMinutes, 0))

  for (const row of rows) {
    scheduleAccount(row.id, row.syncIntervalMinutes)
  }
  console.log(`[SyncScheduler] Initialized with ${rows.length} scheduled account(s)`)
}

/**
 * Update the schedule for a single account (call after account create/update).
 */
export function updateAccountSchedule(accountId: number, intervalMinutes: number): void {
  scheduleAccount(accountId, intervalMinutes)
}

/**
 * Remove the schedule for a deleted account.
 */
export function removeAccountSchedule(accountId: number): void {
  scheduleAccount(accountId, 0)
}

/**
 * Stop all scheduled timers. Call on app quit.
 */
export function stopAllSchedules(): void {
  for (const [accountId, timer] of timers) {
    clearInterval(timer)
    console.log(`[SyncScheduler] Stopped timer for account ${accountId}`)
  }
  timers.clear()
}
