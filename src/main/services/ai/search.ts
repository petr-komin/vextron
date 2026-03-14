import { eq, sql, and, isNotNull } from 'drizzle-orm'
import { getDb } from '../db/connection'
import { messages, messageEmbeddings, aiConfig, accounts } from '../db/schema'
import { createProvider } from './provider'
import type { AiConfig, SemanticSearchResult, MessageFlags } from '../../../shared/types'

// ─── Constants ───────────────────────────────────────────────────────────────

/** Maximum number of search results to return */
const MAX_RESULTS = 30

/** Minimum similarity threshold (cosine similarity, 0-1) */
const MIN_SIMILARITY = 0.3

/** Default embedding model per provider */
const defaultEmbeddingModels: Record<string, string> = {
  together: 'intfloat/multilingual-e5-large-instruct',
  openai: 'text-embedding-3-small',
  ollama: 'nomic-embed-text'
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

// ─── Semantic Search ─────────────────────────────────────────────────────────

/**
 * Perform a semantic search on AI-analyzed emails using pgvector.
 *
 * 1. Embed the query text using the configured embedding model
 * 2. Find the most similar message embeddings using cosine distance
 * 3. Return ranked results with similarity scores
 *
 * @param query Natural language search query
 * @param accountId Optional filter: only search within one account
 * @returns Ranked list of matching messages with similarity scores
 */
export async function semanticSearch(
  query: string,
  accountId?: number
): Promise<SemanticSearchResult[]> {
  if (!query.trim()) return []

  // 1. Load AI config
  const config = await getActiveConfig()
  if (!config) {
    throw new Error('AI is not configured. Please set up your AI provider in Settings.')
  }

  const embeddingModel = config.embeddingModel || defaultEmbeddingModels[config.provider]
  if (!embeddingModel) {
    throw new Error(`No embedding model configured for provider "${config.provider}".`)
  }

  // 2. Embed the query
  const provider = createProvider(config)
  const [queryEmbedding] = await provider.embed([query], embeddingModel)

  if (!queryEmbedding?.length) {
    throw new Error('Failed to generate embedding for search query.')
  }

  // 3. Query pgvector for cosine similarity
  // cosine distance = 1 - cosine_similarity, so similarity = 1 - distance
  const db = getDb()
  const embeddingStr = `[${queryEmbedding.join(',')}]`

  // Build conditions
  const conditions = [
    isNotNull(messages.aiSummary)
  ]
  if (accountId) {
    conditions.push(eq(messages.accountId, accountId))
  }

  const rows = await db
    .select({
      msg: messages,
      accountEmail: accounts.email,
      similarity: sql<number>`1 - (${messageEmbeddings.embedding} <=> ${embeddingStr}::vector)`.as('similarity')
    })
    .from(messageEmbeddings)
    .innerJoin(messages, eq(messageEmbeddings.messageId, messages.id))
    .innerJoin(accounts, eq(messages.accountId, accounts.id))
    .where(and(...conditions))
    .orderBy(sql`${messageEmbeddings.embedding} <=> ${embeddingStr}::vector`)
    .limit(MAX_RESULTS)

  // 4. Filter by minimum similarity and map to result type
  return rows
    .filter((row) => row.similarity >= MIN_SIMILARITY)
    .map(({ msg, accountEmail, similarity }) => ({
      id: msg.id,
      accountId: msg.accountId,
      folderId: msg.folderId,
      uid: msg.uid,
      subject: msg.subject,
      from: { name: msg.fromName, address: msg.fromAddress },
      date: msg.date?.toISOString() ?? '',
      flags: msg.flags as MessageFlags,
      hasAttachments: msg.hasAttachments,
      preview: msg.preview,
      aiCategory: msg.aiCategory!,
      aiPriority: msg.aiPriority as 'high' | 'medium' | 'low',
      aiSummary: msg.aiSummary!,
      accountEmail,
      similarity: Math.round(similarity * 1000) / 1000 // 3 decimal places
    }))
}
