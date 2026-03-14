import type { IpcMainInvokeEvent } from 'electron'
import { eq, and, inArray, desc } from 'drizzle-orm'
import { getDb } from '../services/db/connection'
import { aiConfig, messages, folders } from '../services/db/schema'
import { analyzeMessage, batchAnalyzeMessages } from '../services/ai/analyze'
import { semanticSearch } from '../services/ai/search'
import { isBlacklisted } from '../services/ai/blacklist'
import * as blacklistService from '../services/ai/blacklist'
import { buildCommonConditions } from './messages'
import type { AiConfig, AiBlacklistPatternType, FolderType, MessageFilters } from '../../shared/types'

export const aiHandlers = {
  // ─── Config ──────────────────────────────────────────────────────────────

  'ai:getConfig': async (_event: IpcMainInvokeEvent) => {
    const db = getDb()
    const [row] = await db
      .select()
      .from(aiConfig)
      .where(eq(aiConfig.isActive, true))
      .limit(1)

    if (!row) return null

    return {
      id: row.id,
      provider: row.provider,
      apiKey: row.apiKey || undefined,
      model: row.model,
      baseUrl: row.baseUrl || undefined,
      embeddingModel: row.embeddingModel || undefined,
      isActive: row.isActive
    } as AiConfig
  },

  'ai:setConfig': async (
    _event: IpcMainInvokeEvent,
    config: Omit<AiConfig, 'id'>
  ) => {
    const db = getDb()

    // Deactivate all existing configs first
    await db.update(aiConfig).set({ isActive: false })

    // Upsert: check if any config exists
    const [existing] = await db.select().from(aiConfig).limit(1)

    if (existing) {
      const [updated] = await db
        .update(aiConfig)
        .set({
          provider: config.provider,
          apiKey: config.apiKey || null,
          model: config.model,
          baseUrl: config.baseUrl || null,
          embeddingModel: config.embeddingModel || null,
          isActive: config.isActive
        })
        .where(eq(aiConfig.id, existing.id))
        .returning()

      return {
        id: updated.id,
        provider: updated.provider,
        apiKey: updated.apiKey || undefined,
        model: updated.model,
        baseUrl: updated.baseUrl || undefined,
        embeddingModel: updated.embeddingModel || undefined,
        isActive: updated.isActive
      } as AiConfig
    }

    // Create new
    const [created] = await db
      .insert(aiConfig)
      .values({
        provider: config.provider,
        apiKey: config.apiKey || null,
        model: config.model,
        baseUrl: config.baseUrl || null,
        embeddingModel: config.embeddingModel || null,
        isActive: config.isActive
      })
      .returning()

    return {
      id: created.id,
      provider: created.provider,
      apiKey: created.apiKey || undefined,
      model: created.model,
      baseUrl: created.baseUrl || undefined,
      embeddingModel: created.embeddingModel || undefined,
      isActive: created.isActive
    } as AiConfig
  },

  // ─── Analyze ─────────────────────────────────────────────────────────────

  'ai:analyze': async (_event: IpcMainInvokeEvent, messageId: number) => {
    return analyzeMessage(messageId)
  },

  /**
   * Batch-analyze all messages matching the given folder + filters.
   * Used by the "Analyze All with AI" button on search results.
   */
  'ai:analyzeBatch': async (
    _event: IpcMainInvokeEvent,
    params: { folderId?: number; folderType?: FolderType; filters?: MessageFilters }
  ) => {
    const db = getDb()
    const conditions = buildCommonConditions(params.filters)

    if (params.folderType) {
      // Unified folder — find all folder IDs of this type
      const matchingFolders = await db
        .select({ id: folders.id })
        .from(folders)
        .where(eq(folders.type, params.folderType))
      const folderIds = matchingFolders.map((f) => f.id)
      if (folderIds.length === 0) return { total: 0, analyzed: 0, skipped: 0, failed: 0 }
      conditions.unshift(inArray(messages.folderId, folderIds))
    } else if (params.folderId) {
      conditions.unshift(eq(messages.folderId, params.folderId))
    } else {
      throw new Error('Either folderId or folderType is required')
    }

    // Fetch all matching message IDs
    const rows = await db
      .select({ id: messages.id })
      .from(messages)
      .where(and(...conditions))
      .orderBy(desc(messages.date))

    const messageIds = rows.map((r) => r.id)
    console.log(`[AI] Batch analyze: ${messageIds.length} messages match the criteria`)

    return batchAnalyzeMessages(messageIds)
  },

  // ─── Semantic Search ─────────────────────────────────────────────────────

  'ai:search': async (
    _event: IpcMainInvokeEvent,
    query: string,
    accountId?: number
  ) => {
    return semanticSearch(query, accountId)
  },

  // ─── Blacklist ───────────────────────────────────────────────────────────

  'ai:blacklist:list': async (_event: IpcMainInvokeEvent) => {
    return blacklistService.listRules()
  },

  'ai:blacklist:add': async (
    _event: IpcMainInvokeEvent,
    pattern: string,
    patternType: AiBlacklistPatternType
  ) => {
    return blacklistService.addRule(pattern, patternType)
  },

  'ai:blacklist:remove': async (_event: IpcMainInvokeEvent, id: number) => {
    return blacklistService.removeRule(id)
  },

  'ai:blacklist:check': async (_event: IpcMainInvokeEvent, messageId: number) => {
    const db = getDb()
    const [msg] = await db
      .select({ fromAddress: messages.fromAddress, subject: messages.subject })
      .from(messages)
      .where(eq(messages.id, messageId))

    if (!msg) return false
    return isBlacklisted(msg.fromAddress, msg.subject)
  }
}
