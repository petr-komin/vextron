import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const MailComposer = require('nodemailer/lib/mail-composer')
import { getDb } from '../db/connection'
import { accounts, folders } from '../db/schema'
import { eq, and } from 'drizzle-orm'
import { imapManager } from '../imap/connection-manager'
import { toServerPath } from '../imap/sync'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SendMailOptions {
  accountId: number
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject: string
  bodyText?: string
  bodyHtml?: string
  /** In-Reply-To header (for replies) */
  inReplyTo?: string
  /** References header (for threading) */
  references?: string[]
}

export interface SendMailResult {
  success: boolean
  messageId?: string
  error?: string
}

// ─── SMTP Transport ──────────────────────────────────────────────────────────

/**
 * Create a nodemailer SMTP transport for the given account.
 */
async function createTransport(accountId: number): Promise<{ transporter: Transporter; fromAddress: string }> {
  const db = getDb()
  const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId))
  if (!account) throw new Error(`Account ${accountId} not found`)

  const secure = account.smtpSecurity === 'tls'
  const transporter = nodemailer.createTransport({
    host: account.smtpHost,
    port: account.smtpPort,
    secure,
    auth: {
      user: account.username,
      pass: account.encryptedPassword
    },
    tls: {
      rejectUnauthorized: false // handle self-signed certs
    },
    // If not fully TLS, use STARTTLS upgrade
    ...(account.smtpSecurity === 'starttls' ? { requireTLS: true } : {})
  })

  // Use displayName if set, fall back to account name, then bare email address
  const senderName = account.displayName?.trim() || account.name?.trim() || ''
  return { transporter, fromAddress: senderName ? `${senderName} <${account.email}>` : account.email }
}

// ─── Send ────────────────────────────────────────────────────────────────────

/**
 * Send an email via SMTP and optionally append to Sent folder via IMAP.
 */
export async function sendMail(options: SendMailOptions): Promise<SendMailResult> {
  const { accountId, to, cc, bcc, subject, bodyText, bodyHtml, inReplyTo, references } = options

  try {
    // 1. Create transport
    const { transporter, fromAddress } = await createTransport(accountId)

    // 2. Build the message
    const mailOptions: nodemailer.SendMailOptions = {
      from: fromAddress,
      to: to.join(', '),
      subject,
      text: bodyText || undefined,
      html: bodyHtml || undefined,
      headers: {} as Record<string, string>
    }

    if (cc?.length) mailOptions.cc = cc.join(', ')
    if (bcc?.length) mailOptions.bcc = bcc.join(', ')
    if (inReplyTo) (mailOptions.headers as Record<string, string>)['In-Reply-To'] = inReplyTo
    if (references?.length) (mailOptions.headers as Record<string, string>)['References'] = references.join(' ')

    // 3. Send via SMTP — keep transporter open so we can use buildMessage too
    console.log(`[SMTP] Sending email from ${fromAddress} to ${to.join(', ')} (subject: "${subject}")`)
    const info = await transporter.sendMail(mailOptions)
    console.log(`[SMTP] Sent successfully, messageId: ${info.messageId}`)

    // 4. Append to Sent folder via IMAP (best-effort)
    // Build the raw RFC822 message using nodemailer's own builder so encoding is correct
    try {
      const rawMessage = await buildRawMessage(transporter, mailOptions)
      await appendToSentFolder(accountId, rawMessage)
    } catch (appendErr) {
      const msg = appendErr instanceof Error ? appendErr.message : String(appendErr)
      console.warn(`[SMTP] Failed to append to Sent folder: ${msg}`, appendErr)
      // Non-fatal: email was sent successfully
    }

    transporter.close()

    return { success: true, messageId: info.messageId }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    console.error(`[SMTP] Send failed:`, errMsg)
    return { success: false, error: errMsg }
  }
}

// ─── Append to Sent ──────────────────────────────────────────────────────────

/**
 * Use nodemailer's MailComposer to generate a properly encoded RFC822 raw
 * message buffer — handles subject encoding, MIME multipart, etc. correctly.
 */
function buildRawMessage(_transporter: Transporter, mailOptions: nodemailer.SendMailOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const composer = new MailComposer(mailOptions)
    composer.compile().build((err: Error | null, message: Buffer) => {
      if (err) return reject(err)
      resolve(message)
    })
  })
}

/**
 * Append the sent message to the account's Sent folder via IMAP APPEND.
 */
async function appendToSentFolder(
  accountId: number,
  rawMessage: Buffer
): Promise<void> {
  const db = getDb()

  // Find the Sent folder for this account
  const [sentFolder] = await db
    .select()
    .from(folders)
    .where(and(eq(folders.accountId, accountId), eq(folders.type, 'sent')))
    .limit(1)

  if (!sentFolder) {
    console.log(`[SMTP] No Sent folder found for account ${accountId}, skipping append`)
    return
  }

  const serverPath = toServerPath(sentFolder)
  console.log(`[SMTP] Appending to Sent folder: path="${sentFolder.path}" delimiter="${sentFolder.delimiter}" serverPath="${serverPath}"`)

  await imapManager.withClient(accountId, async (client) => {
    await client.append(serverPath, rawMessage, ['\\Seen'])
    console.log(`[SMTP] Appended sent message to "${serverPath}" folder`)
  })
}

/**
 * Test SMTP connection for an account configuration (without sending).
 */
export async function testSmtpConnection(config: {
  host: string
  port: number
  security: string
  username: string
  password: string
}): Promise<{ success: boolean; error?: string }> {
  try {
    const secure = config.security === 'tls'
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure,
      auth: {
        user: config.username,
        pass: config.password
      },
      tls: {
        rejectUnauthorized: false
      },
      ...(config.security === 'starttls' ? { requireTLS: true } : {})
    })

    await transporter.verify()
    transporter.close()
    return { success: true }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    return { success: false, error: errMsg }
  }
}
