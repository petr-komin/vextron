import { createHash } from 'crypto'

/**
 * Compute a deduplication hash for a message.
 *
 * Strategy:
 * 1. If Message-ID header is present → SHA-256 of the Message-ID
 *    (Message-ID is globally unique per RFC 2822)
 * 2. Fallback → SHA-256 of "from_address|date_iso|subject"
 *    (covers emails without Message-ID, e.g. some old or malformed messages)
 *
 * The hash is scoped per account via a unique index (account_id, dedup_hash),
 * so the same email in different accounts won't conflict.
 */
export function computeDedupHash(params: {
  messageId?: string | null
  fromAddress: string
  date: Date | null | undefined
  subject: string
}): string {
  let input: string

  if (params.messageId) {
    // Normalize: trim angle brackets and whitespace
    input = `msgid:${params.messageId.replace(/^<|>$/g, '').trim()}`
  } else {
    // Fallback: from + date + subject
    const dateStr = params.date ? params.date.toISOString() : 'nodate'
    const from = (params.fromAddress || '').toLowerCase().trim()
    const subject = (params.subject || '').trim()
    input = `fallback:${from}|${dateStr}|${subject}`
  }

  return createHash('sha256').update(input).digest('hex')
}
