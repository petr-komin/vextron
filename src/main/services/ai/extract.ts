import { eq } from 'drizzle-orm'
import { getDb } from '../db/connection'
import { messages, aiConfig } from '../db/schema'
import { todos } from '../db/schema/todos'
import { createProvider } from './provider'
import { fetchMessageBody } from '../imap/sync'
import type { AiConfig, TodoItem } from '../../../shared/types'
import type { ChatMessage } from './provider'

const MAX_BODY_LENGTH = 4000

// ─── Helpers ─────────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

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
    apiKey: row.apiKey ?? undefined,
    model: row.model,
    baseUrl: row.baseUrl ?? undefined,
    embeddingModel: row.embeddingModel ?? undefined,
    isActive: row.isActive
  }
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an assistant that extracts actionable todo items from emails.

Read the email and extract any concrete actions, tasks, or follow-ups that the recipient needs to do.
Focus on explicit requests, deadlines, and commitments — not vague statements.

Return a JSON object with a single key "todos" containing an array of strings.
Each string is one clear, concise action item (max 120 characters).
If there are no actionable items, return {"todos": []}.

Return ONLY valid JSON. No markdown, no code fences, no explanation.

Example:
{"todos": ["Reply to John about the project deadline by Friday", "Send the updated budget spreadsheet to the team", "Schedule a call with the client next week"]}`

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Extract todo items from an email using AI and persist them in the DB.
 * If todos for this message already exist they are deleted and re-extracted.
 * Returns the newly created TodoItem rows.
 */
export async function extractTodos(messageId: number): Promise<TodoItem[]> {
  const config = await getActiveConfig()
  if (!config) throw new Error('AI is not configured')

  const db = getDb()

  // Load message
  const [row] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1)
  if (!row) throw new Error(`Message ${messageId} not found`)

  // Fetch body if not yet stored
  let bodyText = row.bodyText
  let bodyHtml = row.bodyHtml
  if (!bodyText && !bodyHtml) {
    try {
      const body = await fetchMessageBody(row.accountId, row.folderId, row.id)
      bodyText = body.bodyText
      bodyHtml = body.bodyHtml
    } catch (err) {
      console.error(`[Todos] Failed to fetch body for message ${messageId}:`, err)
    }
  }

  const rawBody = bodyHtml ? stripHtml(bodyHtml) : (bodyText ?? '')
  const body = rawBody.slice(0, MAX_BODY_LENGTH)

  const userContent = [
    `From: ${row.fromName ? `${row.fromName} <${row.fromAddress}>` : row.fromAddress}`,
    `Subject: ${row.subject ?? '(no subject)'}`,
    '',
    body || '(empty body)'
  ].join('\n')

  const chatMessages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userContent }
  ]

  const provider = createProvider(config)
  const raw = await provider.chatCompletion(chatMessages, {
    temperature: 0.1,
    maxTokens: 512,
    jsonMode: true
  })

  let extracted: string[] = []
  try {
    const parsed = JSON.parse(raw) as { todos?: unknown }
    if (Array.isArray(parsed.todos)) {
      extracted = parsed.todos
        .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        .map((t) => t.trim().slice(0, 120))
    }
  } catch (err) {
    throw new Error(`AI returned invalid JSON for todos: ${raw}`)
  }

  // Delete existing todos for this message and re-insert
  await db.delete(todos).where(eq(todos.messageId, messageId))

  if (extracted.length === 0) return []

  const inserted = await db
    .insert(todos)
    .values(extracted.map((text) => ({ messageId, text })))
    .returning()

  return inserted.map((r) => ({
    id: r.id,
    messageId: r.messageId,
    text: r.text,
    done: r.done,
    createdAt: r.createdAt.toISOString()
  }))
}
