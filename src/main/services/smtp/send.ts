import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import { getDb } from '../db/connection'
import { accounts, folders } from '../db/schema'
import { eq, and } from 'drizzle-orm'
import { imapManager } from '../imap/connection-manager'

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

  return { transporter, fromAddress: account.email }
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

    // 3. Send via SMTP
    console.log(`[SMTP] Sending email from ${fromAddress} to ${to.join(', ')} (subject: "${subject}")`)
    const info = await transporter.sendMail(mailOptions)
    console.log(`[SMTP] Sent successfully, messageId: ${info.messageId}`)

    // 4. Append to Sent folder via IMAP (best-effort)
    try {
      await appendToSentFolder(accountId, info.envelope, mailOptions, info.messageId)
    } catch (appendErr) {
      const msg = appendErr instanceof Error ? appendErr.message : String(appendErr)
      console.warn(`[SMTP] Failed to append to Sent folder: ${msg}`)
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
 * Build a raw RFC822 message and append it to the Sent folder via IMAP APPEND.
 * This ensures the sent message shows up in the user's Sent folder.
 */
async function appendToSentFolder(
  accountId: number,
  _envelope: unknown,
  mailOptions: nodemailer.SendMailOptions,
  messageId: string
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

  // Build a minimal RFC822 message for IMAP APPEND
  const date = new Date()
  const rawParts: string[] = [
    `From: ${mailOptions.from}`,
    `To: ${mailOptions.to}`,
    `Subject: ${mailOptions.subject || '(no subject)'}`,
    `Date: ${date.toUTCString()}`,
    `Message-ID: ${messageId}`,
    `MIME-Version: 1.0`
  ]

  if (mailOptions.cc) rawParts.push(`Cc: ${mailOptions.cc}`)
  if (mailOptions.headers) {
    const hdrs = mailOptions.headers as Record<string, string>
    if (hdrs['In-Reply-To']) rawParts.push(`In-Reply-To: ${hdrs['In-Reply-To']}`)
    if (hdrs['References']) rawParts.push(`References: ${hdrs['References']}`)
  }

  if (mailOptions.html) {
    rawParts.push(`Content-Type: text/html; charset=utf-8`)
    rawParts.push(`Content-Transfer-Encoding: quoted-printable`)
    rawParts.push('')
    rawParts.push(String(mailOptions.html))
  } else {
    rawParts.push(`Content-Type: text/plain; charset=utf-8`)
    rawParts.push('')
    rawParts.push(String(mailOptions.text || ''))
  }

  const rawMessage = rawParts.join('\r\n')

  await imapManager.withClient(accountId, async (client) => {
    await client.append(sentFolder.path, Buffer.from(rawMessage), ['\\Seen'])
    console.log(`[SMTP] Appended sent message to "${sentFolder.path}" folder`)
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
