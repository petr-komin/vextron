import { ImapFlow, type ImapFlowOptions } from 'imapflow'
import { getDb } from '../db/connection'
import { accounts } from '../db/schema/accounts'
import { eq } from 'drizzle-orm'

export interface ImapConnectionConfig {
  host: string
  port: number
  secure: boolean
  auth: {
    user: string
    pass: string
  }
}

interface ManagedConnection {
  client: ImapFlow
  accountId: number
  config: ImapConnectionConfig
  connected: boolean
  /** Number of operations currently using this connection */
  activeOps: number
  /** Timestamp of last activity */
  lastUsed: number
}

/**
 * Manages persistent IMAP connections — one per account.
 * Connections are reused across sync, fetch, and future IDLE operations.
 * Operations acquire/release the connection to serialize mailbox access.
 */
class ImapConnectionManager {
  private connections = new Map<number, ManagedConnection>()
  /** Queue of waiting operations per account */
  private queues = new Map<number, Array<{
    resolve: (client: ImapFlow) => void
    reject: (err: Error) => void
  }>>()

  /**
   * Get IMAP config from the database for a given account.
   */
  async getConfigForAccount(accountId: number): Promise<ImapConnectionConfig> {
    const db = getDb()
    const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId))
    if (!account) throw new Error(`Account ${accountId} not found`)

    return {
      host: account.imapHost,
      port: account.imapPort,
      secure: account.security === 'tls',
      auth: {
        user: account.username,
        pass: account.encryptedPassword
      }
    }
  }

  /**
   * Create a new ImapFlow client from config.
   */
  private createClient(config: ImapConnectionConfig): ImapFlow {
    return new ImapFlow({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.auth,
      logger: false,
      emitLogs: false,
      // 10s connect timeout — prevents hanging on unreachable hosts (e.g. imported stub accounts)
      greetingTimeout: 10000,
      socketTimeout: 10000
    } as ImapFlowOptions)
  }

  /**
   * Get or create a connected IMAP client for an account.
   * If the connection is dead, it will be recreated.
   */
  async getClient(accountId: number): Promise<ImapFlow> {
    let managed = this.connections.get(accountId)

    // If we have an existing connection, check if it's still alive
    if (managed) {
      if (managed.connected && !managed.client.usable) {
        // Connection died — clean up
        managed.connected = false
        try { await managed.client.logout() } catch { /* ignore */ }
      }

      if (managed.connected && managed.client.usable) {
        managed.lastUsed = Date.now()
        managed.activeOps++
        return managed.client
      }

      // Connection exists but is dead — recreate
      this.connections.delete(accountId)
    }

    // Create new connection
    const config = await this.getConfigForAccount(accountId)
    const client = this.createClient(config)

    managed = {
      client,
      accountId,
      config,
      connected: false,
      activeOps: 1,
      lastUsed: Date.now()
    }

    try {
      await client.connect()
      managed.connected = true
    } catch (error) {
      throw error
    }

    // Handle unexpected disconnections
    client.on('close', () => {
      const m = this.connections.get(accountId)
      if (m && m.client === client) {
        m.connected = false
      }
    })

    client.on('error', (err: Error) => {
      console.error(`[IMAP] Connection error for account ${accountId}:`, err.message)
      const m = this.connections.get(accountId)
      if (m && m.client === client) {
        m.connected = false
      }
    })

    this.connections.set(accountId, managed)
    return client
  }

  /**
   * Signal that an operation is done with the connection.
   * Does NOT close it — the connection stays open for reuse.
   */
  releaseClient(accountId: number): void {
    const managed = this.connections.get(accountId)
    if (managed) {
      managed.activeOps = Math.max(0, managed.activeOps - 1)
      managed.lastUsed = Date.now()
    }
  }

  /**
   * Execute an operation using the managed connection for an account.
   * Handles acquire/release automatically.
   */
  async withClient<T>(accountId: number, operation: (client: ImapFlow) => Promise<T>): Promise<T> {
    const client = await this.getClient(accountId)
    try {
      return await operation(client)
    } catch (error) {
      // If the error is a connection issue, mark as disconnected
      // so next call will reconnect
      const managed = this.connections.get(accountId)
      if (managed && !managed.client.usable) {
        managed.connected = false
      }
      throw error
    } finally {
      this.releaseClient(accountId)
    }
  }

  /**
   * Disconnect a specific account's IMAP connection.
   */
  async disconnect(accountId: number): Promise<void> {
    const managed = this.connections.get(accountId)
    if (managed) {
      this.connections.delete(accountId)
      managed.connected = false
      try {
        await managed.client.logout()
      } catch {
        /* ignore logout errors */
      }
    }
  }

  /**
   * Close all IMAP connections. Call on app quit.
   */
  async closeAll(): Promise<void> {
    const promises: Promise<void>[] = []
    for (const [accountId] of this.connections) {
      promises.push(this.disconnect(accountId))
    }
    await Promise.allSettled(promises)
  }

  /**
   * Check if an account has an active connection.
   */
  isConnected(accountId: number): boolean {
    const managed = this.connections.get(accountId)
    return !!managed?.connected && !!managed.client.usable
  }

  /**
   * Get status of all connections (for UI).
   */
  getStatus(): Array<{ accountId: number; connected: boolean; activeOps: number }> {
    const result: Array<{ accountId: number; connected: boolean; activeOps: number }> = []
    for (const [accountId, managed] of this.connections) {
      result.push({
        accountId,
        connected: managed.connected && !!managed.client.usable,
        activeOps: managed.activeOps
      })
    }
    return result
  }
}

/** Singleton instance */
export const imapManager = new ImapConnectionManager()
