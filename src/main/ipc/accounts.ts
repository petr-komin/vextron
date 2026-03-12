import type { IpcMainInvokeEvent } from 'electron'
import type { AccountFormData, Account } from '../../shared/types'
import { getDb } from '../services/db/connection'
import { accounts } from '../services/db/schema/accounts'
import { eq } from 'drizzle-orm'
import { imapManager } from '../services/imap/connection-manager'

export const accountsHandlers = {
  'accounts:list': async (_event: IpcMainInvokeEvent): Promise<Account[]> => {
    const db = getDb()
    const rows = await db.select().from(accounts)
    return rows.map(mapAccountRow)
  },

  'accounts:create': async (
    _event: IpcMainInvokeEvent,
    data: AccountFormData
  ): Promise<Account> => {
    const db = getDb()
    const [row] = await db
      .insert(accounts)
      .values({
        name: data.name,
        email: data.email,
        imapHost: data.imapHost,
        imapPort: data.imapPort,
        smtpHost: data.smtpHost,
        smtpPort: data.smtpPort,
        username: data.username,
        encryptedPassword: data.password, // TODO: encrypt
        authType: data.authType,
        security: data.security,
        smtpSecurity: data.smtpSecurity,
        isActive: true,
        color: data.color
      })
      .returning()
    return mapAccountRow(row)
  },

  'accounts:update': async (
    _event: IpcMainInvokeEvent,
    id: number,
    data: Partial<AccountFormData>
  ): Promise<Account> => {
    const db = getDb()
    const updateData: Record<string, unknown> = {}
    if (data.name !== undefined) updateData.name = data.name
    if (data.email !== undefined) updateData.email = data.email
    if (data.imapHost !== undefined) updateData.imapHost = data.imapHost
    if (data.imapPort !== undefined) updateData.imapPort = data.imapPort
    if (data.smtpHost !== undefined) updateData.smtpHost = data.smtpHost
    if (data.smtpPort !== undefined) updateData.smtpPort = data.smtpPort
    if (data.username !== undefined) updateData.username = data.username
    if (data.password !== undefined) updateData.encryptedPassword = data.password
    if (data.authType !== undefined) updateData.authType = data.authType
    if (data.security !== undefined) updateData.security = data.security
    if (data.smtpSecurity !== undefined) updateData.smtpSecurity = data.smtpSecurity
    if (data.color !== undefined) updateData.color = data.color

    const [row] = await db
      .update(accounts)
      .set(updateData)
      .where(eq(accounts.id, id))
      .returning()
    return mapAccountRow(row)
  },

  'accounts:delete': async (_event: IpcMainInvokeEvent, id: number): Promise<void> => {
    // Disconnect IMAP connection before deleting account data
    await imapManager.disconnect(id)
    const db = getDb()
    await db.delete(accounts).where(eq(accounts.id, id))
  },

  'accounts:test': async (
    _event: IpcMainInvokeEvent,
    data: AccountFormData
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      // Dynamic import to avoid loading imapflow at startup
      const { testImapConnection } = await import('../services/imap/connection')
      await testImapConnection({
        host: data.imapHost,
        port: data.imapPort,
        secure: data.security === 'tls',
        auth: {
          user: data.username,
          pass: data.password
        }
      })
      return { success: true }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error'
      return {
        success: false,
        error: msg
      }
    }
  }
}

function mapAccountRow(row: typeof accounts.$inferSelect): Account {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    imapHost: row.imapHost,
    imapPort: row.imapPort,
    smtpHost: row.smtpHost,
    smtpPort: row.smtpPort,
    username: row.username,
    authType: row.authType as Account['authType'],
    security: row.security as Account['security'],
    smtpSecurity: row.smtpSecurity as Account['smtpSecurity'],
    isActive: row.isActive,
    color: row.color,
    createdAt: row.createdAt.toISOString()
    // password is intentionally omitted
  }
}
