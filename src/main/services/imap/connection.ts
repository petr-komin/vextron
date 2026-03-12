import { ImapFlow, type ImapFlowOptions } from 'imapflow'

export interface ImapConnectionConfig {
  host: string
  port: number
  secure: boolean
  auth: {
    user: string
    pass: string
  }
}

/**
 * Test IMAP connection with provided credentials.
 * Connects, lists capabilities, and disconnects.
 */
export async function testImapConnection(config: ImapConnectionConfig): Promise<void> {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.auth,
    logger: false
  } as ImapFlowOptions)

  try {
    await client.connect()
    console.log(`[IMAP] Test connection to ${config.host}:${config.port} successful`)
  } finally {
    await client.logout()
  }
}

/**
 * Create a persistent IMAP connection for an account.
 */
export function createImapClient(config: ImapConnectionConfig): ImapFlow {
  return new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.auth,
    logger: false,
    emitLogs: false
  } as ImapFlowOptions)
}

/**
 * List all mailbox folders from IMAP server.
 */
export async function listMailboxes(
  client: ImapFlow
): Promise<Array<{ name: string; path: string; delimiter: string; specialUse?: string; listed: boolean }>> {
  const mailboxes = await client.list()
  return mailboxes.map((mb) => ({
    name: mb.name,
    path: mb.path,
    delimiter: mb.delimiter,
    specialUse: mb.specialUse,
    listed: mb.listed
  }))
}
