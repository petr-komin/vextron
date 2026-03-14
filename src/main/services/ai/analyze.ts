import { eq } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import { getDb } from '../db/connection'
import { messages, aiConfig, messageEmbeddings } from '../db/schema'
import { createProvider } from './provider'
import { isBlacklisted } from './blacklist'
import { fetchMessageBody } from '../imap/sync'
import type { AiClassification, AiConfig } from '../../../shared/types'
import type { ChatMessage } from './provider'

// ─── Constants ───────────────────────────────────────────────────────────────

/** Only process emails from the last 7 days */
const MAX_AGE_DAYS = 7

/** Max body length sent to AI (chars) — keeps token usage reasonable */
const MAX_BODY_LENGTH = 4000

/**
 * Max character length for embedding input text.
 * The multilingual-e5-large-instruct model has a 512 token limit.
 * Czech text tokenizes at roughly 2-3 chars/token, so 1000 chars ≈ 350-500 tokens,
 * leaving room for the model's instruction prefix overhead.
 */
const MAX_EMBEDDING_LENGTH = 1000

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Strip HTML tags from a string, leaving only text content.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '') // remove <style> blocks
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // remove <script> blocks
    .replace(/<[^>]+>/g, ' ') // remove tags
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'")
    .replace(/\s+/g, ' ') // collapse whitespace
    .trim()
}

/**
 * Load the active AI config from DB.
 */
async function getActiveConfig(): Promise<AiConfig | null> {
  const db = getDb()
  const [row] = await db
    .select()
    .from(aiConfig)
    .where(eq(aiConfig.isActive, true))
    .limit(1)

  if (!row) return null

  return {
    id: row.id,
    provider: row.provider as AiConfig['provider'],
    apiKey: row.apiKey || undefined,
    model: row.model,
    baseUrl: row.baseUrl || undefined,
    embeddingModel: row.embeddingModel || undefined,
    isActive: row.isActive
  }
}

// ─── System prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an email analysis assistant. Analyze the email below and return a JSON object with these fields:

- "summary": A concise 2-3 sentence summary of the email content. Write the summary in the same language as the email.
- "category": One of: "personal", "work", "finance", "shopping", "social", "newsletter", "notification", "spam", "travel", "health", "education", "other"
- "priority": One of: "high", "medium", "low"
  - "high": Requires immediate attention or action (urgent requests, deadlines, important personal messages)
  - "medium": Important but not urgent (regular work emails, expected deliveries, appointments)
  - "low": Informational only, no action needed (newsletters, notifications, marketing)

Return ONLY a valid JSON object. No markdown, no code fences, no explanation.

Example:
{"summary": "John is asking about the project deadline for Q4 report and needs a response by Friday.", "category": "work", "priority": "high"}`

/** Default embedding model per provider */
const defaultEmbeddingModels: Record<string, string> = {
  together: 'intfloat/multilingual-e5-large-instruct',
  openai: 'text-embedding-3-small',
  ollama: 'nomic-embed-text'
}

// ─── Embedding helper ────────────────────────────────────────────────────────

/**
 * Generate and store an embedding vector for a message.
 * Called after successful AI analysis. Non-blocking — errors are logged but not thrown.
 *
 * @param messageId The message ID to embed
 * @param emailText The email text to generate an embedding from
 * @param config The active AI config (to get embedding model + provider)
 */
async function generateAndStoreEmbedding(
  messageId: number,
  emailText: string,
  config: AiConfig
): Promise<void> {
  const embeddingModel = config.embeddingModel || defaultEmbeddingModels[config.provider]
  if (!embeddingModel) {
    console.log(`[AI] No embedding model configured for provider "${config.provider}", skipping embedding`)
    return
  }

  try {
    // Truncate to stay within the embedding model's token limit (512 tokens).
    // We keep subject + beginning of body which carries the most semantic meaning.
    const truncatedText = emailText.length > MAX_EMBEDDING_LENGTH
      ? emailText.substring(0, MAX_EMBEDDING_LENGTH)
      : emailText

    const provider = createProvider(config)
    const [embedding] = await provider.embed([truncatedText], embeddingModel)

    if (!embedding?.length) {
      console.warn(`[AI] Empty embedding returned for message ${messageId}`)
      return
    }

    const db = getDb()

    // Upsert: insert or update if embedding already exists for this message
    await db
      .insert(messageEmbeddings)
      .values({
        messageId,
        embedding,
        model: embeddingModel
      })
      .onConflictDoUpdate({
        target: messageEmbeddings.messageId,
        set: {
          embedding: sql`excluded.embedding`,
          model: sql`excluded.model`,
          createdAt: sql`now()`
        }
      })

    console.log(`[AI] Stored embedding for message ${messageId} (${embedding.length} dims, model: ${embeddingModel})`)
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    console.warn(`[AI] Failed to generate embedding for message ${messageId}: ${errMsg}`)
    // Non-fatal: analysis results are already saved, embedding is a bonus
  }
}

// ─── Main API ────────────────────────────────────────────────────────────────

export interface AnalyzeOptions {
  /** Skip the 7-day age limit check (used by auto-AI since messages are fresh) */
  skipAgeCheck?: boolean
}

/**
 * Analyze a message: generate summary + classification in a single AI call.
 * Results are saved to the message's ai_summary, ai_category, ai_priority columns.
 *
 * @throws Error if AI is not configured, message is too old, or sender is blacklisted
 */
export async function analyzeMessage(messageId: number, options?: AnalyzeOptions): Promise<AiClassification> {
  const db = getDb()

  // 1. Load AI config
  const config = await getActiveConfig()
  if (!config) {
    throw new Error('AI is not configured. Please set up your AI provider in Settings.')
  }

  // 2. Load the message
  const [msg] = await db
    .select({
      id: messages.id,
      subject: messages.subject,
      fromAddress: messages.fromAddress,
      date: messages.date,
      bodyText: messages.bodyText,
      bodyHtml: messages.bodyHtml
    })
    .from(messages)
    .where(eq(messages.id, messageId))

  if (!msg) {
    throw new Error(`Message not found: ${messageId}`)
  }

  // 3. Check 7-day age limit (skipped for auto-AI)
  if (!options?.skipAgeCheck && msg.date) {
    const ageMs = Date.now() - new Date(msg.date).getTime()
    const ageDays = ageMs / (1000 * 60 * 60 * 24)
    if (ageDays > MAX_AGE_DAYS) {
      throw new Error(`Email is older than ${MAX_AGE_DAYS} days. AI analysis is limited to recent emails to save tokens.`)
    }
  }

  // 4. Check blacklist
  const blocked = await isBlacklisted(msg.fromAddress, msg.subject)
  if (blocked) {
    throw new Error('This sender or subject is on the AI blacklist.')
  }

  // 5. Build the prompt
  let body = msg.bodyText
  if (!body && msg.bodyHtml) {
    body = stripHtml(msg.bodyHtml)
  }
  if (body.length > MAX_BODY_LENGTH) {
    body = body.substring(0, MAX_BODY_LENGTH) + '\n[... truncated]'
  }

  const emailContent = [
    `From: ${msg.fromAddress}`,
    `Subject: ${msg.subject}`,
    `Date: ${msg.date ? new Date(msg.date).toISOString() : 'unknown'}`,
    '',
    body || '(empty body)'
  ].join('\n')

  const chatMessages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: emailContent }
  ]

  // 6. Call AI provider
  const provider = createProvider(config)
  const response = await provider.chatCompletion(chatMessages, {
    temperature: 0.2,
    maxTokens: 512,
    jsonMode: true
  })

  // 7. Parse the JSON response
  let parsed: { summary: string; category: string; priority: string }
  try {
    // Handle potential markdown code fences in response
    const cleaned = response.replace(/^```json\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim()
    parsed = JSON.parse(cleaned)
  } catch {
    console.error('[AI] Failed to parse JSON response:', response)
    throw new Error('AI returned an invalid response. Please try again.')
  }

  // Validate and normalize
  const validCategories = [
    'personal', 'work', 'finance', 'shopping', 'social',
    'newsletter', 'notification', 'spam', 'travel', 'health', 'education', 'other'
  ]
  const validPriorities = ['high', 'medium', 'low']

  const category = validCategories.includes(parsed.category) ? parsed.category : 'other'
  const priority = validPriorities.includes(parsed.priority)
    ? (parsed.priority as 'high' | 'medium' | 'low')
    : 'medium'
  const summary = typeof parsed.summary === 'string' ? parsed.summary : 'Unable to generate summary.'

  // 8. Save results to DB
  await db
    .update(messages)
    .set({
      aiSummary: summary,
      aiCategory: category,
      aiPriority: priority
    })
    .where(eq(messages.id, messageId))

  const result: AiClassification = {
    category,
    priority,
    summary,
    labels: [] // labels will be implemented later
  }

  console.log(`[AI] Analyzed message ${messageId}: ${category} / ${priority}`)

  // 9. Generate and store embedding (awaited but error-tolerant)
  // Errors don't fail the analysis — embedding is a bonus for semantic search
  try {
    await generateAndStoreEmbedding(messageId, emailContent, config)
  } catch (embErr) {
    const embMsg = embErr instanceof Error ? embErr.message : String(embErr)
    console.error(`[AI] Embedding failed for message ${messageId}: ${embMsg}`)
  }

  return result
}

// ─── Auto-AI Pipeline ────────────────────────────────────────────────────────

export interface AutoAnalyzeResult {
  total: number
  analyzed: number
  skipped: number
  failed: number
}

/**
 * Auto-analyze a batch of newly synced messages.
 * For each message:
 *   1. Fetch its body from IMAP (since sync only stores headers)
 *   2. Run AI analysis (skip age check, respect blacklist)
 *
 * Error-tolerant: one message failure does not abort the rest.
 */
export async function autoAnalyzeMessages(
  accountId: number,
  messageIds: number[]
): Promise<AutoAnalyzeResult> {
  const result: AutoAnalyzeResult = { total: messageIds.length, analyzed: 0, skipped: 0, failed: 0 }

  if (messageIds.length === 0) return result

  // 1. Check AI config once upfront
  const config = await getActiveConfig()
  if (!config) {
    console.log('[AutoAI] No active AI config, skipping auto-analysis')
    result.skipped = messageIds.length
    return result
  }

  const db = getDb()

  for (const msgId of messageIds) {
    try {
      // 2. Load basic message info to check blacklist and get folderId
      const [msg] = await db
        .select({
          id: messages.id,
          folderId: messages.folderId,
          fromAddress: messages.fromAddress,
          subject: messages.subject,
          bodyText: messages.bodyText,
          bodyHtml: messages.bodyHtml,
          aiSummary: messages.aiSummary
        })
        .from(messages)
        .where(eq(messages.id, msgId))

      if (!msg) {
        console.warn(`[AutoAI] Message ${msgId} not found, skipping`)
        result.skipped++
        continue
      }

      // Skip if already analyzed
      if (msg.aiSummary) {
        result.skipped++
        continue
      }

      // 3. Check blacklist
      const blocked = await isBlacklisted(msg.fromAddress, msg.subject)
      if (blocked) {
        console.log(`[AutoAI] Message ${msgId} is blacklisted, skipping`)
        result.skipped++
        continue
      }

      // 4. Fetch body from IMAP if not already loaded
      if (!msg.bodyText && !msg.bodyHtml) {
        try {
          await fetchMessageBody(accountId, msg.folderId, msgId)
        } catch (fetchError) {
          const fetchMsg = fetchError instanceof Error ? fetchError.message : String(fetchError)
          console.warn(`[AutoAI] Failed to fetch body for message ${msgId}: ${fetchMsg}`)
          result.failed++
          continue
        }
      }

      // 5. Run AI analysis (skip age check)
      await analyzeMessage(msgId, { skipAgeCheck: true })
      result.analyzed++
      console.log(`[AutoAI] Analyzed message ${msgId} (${result.analyzed}/${messageIds.length})`)
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      console.warn(`[AutoAI] Failed to analyze message ${msgId}: ${errMsg}`)
      result.failed++
    }
  }

  console.log(
    `[AutoAI] Complete for account ${accountId}: ` +
    `${result.analyzed} analyzed, ${result.skipped} skipped, ${result.failed} failed ` +
    `(out of ${result.total} total)`
  )

  return result
}

/**
 * Batch-analyze a list of messages (from user-initiated action, e.g. search results).
 * Unlike autoAnalyzeMessages, this does NOT require a single accountId —
 * it reads each message's accountId from DB, so it works across multiple accounts.
 * Skips age check (user explicitly requested analysis). Respects blacklist.
 * Error-tolerant: one message failure does not abort the rest.
 */
export async function batchAnalyzeMessages(
  messageIds: number[]
): Promise<AutoAnalyzeResult> {
  const result: AutoAnalyzeResult = { total: messageIds.length, analyzed: 0, skipped: 0, failed: 0 }

  if (messageIds.length === 0) return result

  // Check AI config once upfront
  const config = await getActiveConfig()
  if (!config) {
    throw new Error('AI is not configured. Please set up your AI provider in Settings.')
  }

  const db = getDb()

  for (const msgId of messageIds) {
    try {
      // Load basic message info
      const [msg] = await db
        .select({
          id: messages.id,
          accountId: messages.accountId,
          folderId: messages.folderId,
          fromAddress: messages.fromAddress,
          subject: messages.subject,
          bodyText: messages.bodyText,
          bodyHtml: messages.bodyHtml,
          aiSummary: messages.aiSummary
        })
        .from(messages)
        .where(eq(messages.id, msgId))

      if (!msg) {
        result.skipped++
        continue
      }

      // If already analyzed, check if embedding is missing and generate it
      if (msg.aiSummary) {
        // Check if embedding already exists
        const [existingEmb] = await db
          .select({ id: messageEmbeddings.id })
          .from(messageEmbeddings)
          .where(eq(messageEmbeddings.messageId, msgId))
          .limit(1)

        if (existingEmb) {
          result.skipped++
          continue
        }

        // Generate embedding for already-analyzed message
        try {
          // Build email text for embedding (same format as analyzeMessage)
          let body = msg.bodyText
          if (!body && msg.bodyHtml) {
            body = stripHtml(msg.bodyHtml)
          }
          // Fetch body from IMAP if not loaded
          if (!body) {
            try {
              await fetchMessageBody(msg.accountId, msg.folderId, msgId)
              // Re-read the message to get the fetched body
              const [refreshed] = await db
                .select({ bodyText: messages.bodyText, bodyHtml: messages.bodyHtml })
                .from(messages)
                .where(eq(messages.id, msgId))
              body = refreshed?.bodyText || (refreshed?.bodyHtml ? stripHtml(refreshed.bodyHtml) : '')
            } catch {
              // If we can't fetch body, use subject only
              body = ''
            }
          }

          const emailText = [
            `From: ${msg.fromAddress}`,
            `Subject: ${msg.subject}`,
            '',
            body || '(empty body)'
          ].join('\n')

          await generateAndStoreEmbedding(msgId, emailText, config)
          result.analyzed++
          console.log(`[BatchAI] Generated embedding for already-analyzed message ${msgId}`)
        } catch (embError) {
          const embMsg = embError instanceof Error ? embError.message : String(embError)
          console.warn(`[BatchAI] Failed to generate embedding for message ${msgId}: ${embMsg}`)
          result.failed++
        }
        continue
      }

      // Check blacklist
      const blocked = await isBlacklisted(msg.fromAddress, msg.subject)
      if (blocked) {
        result.skipped++
        continue
      }

      // Fetch body from IMAP if not already loaded
      if (!msg.bodyText && !msg.bodyHtml) {
        try {
          await fetchMessageBody(msg.accountId, msg.folderId, msgId)
        } catch (fetchError) {
          const fetchMsg = fetchError instanceof Error ? fetchError.message : String(fetchError)
          console.warn(`[BatchAI] Failed to fetch body for message ${msgId}: ${fetchMsg}`)
          result.failed++
          continue
        }
      }

      // Run AI analysis (skip age check — user explicitly requested)
      await analyzeMessage(msgId, { skipAgeCheck: true })
      result.analyzed++
      console.log(`[BatchAI] Analyzed message ${msgId} (${result.analyzed}/${messageIds.length})`)
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      console.warn(`[BatchAI] Failed to analyze message ${msgId}: ${errMsg}`)
      result.failed++
    }
  }

  console.log(
    `[BatchAI] Complete: ${result.analyzed} analyzed, ${result.skipped} skipped, ${result.failed} failed ` +
    `(out of ${result.total} total)`
  )

  return result
}

/**
 * Get the active AI config (for UI display).
 */
export { getActiveConfig }
