import type { IpcMainInvokeEvent } from 'electron'
import { getDb } from '../services/db/connection'
import { imageAllowlist } from '../services/db/schema/settings'
import { eq } from 'drizzle-orm'

/**
 * In-memory cache of allowed domains for fast lookup.
 * Loaded once at startup, updated on add/remove.
 */
let allowedDomains: Set<string> | null = null

async function ensureCache(): Promise<Set<string>> {
  if (allowedDomains) return allowedDomains
  const db = getDb()
  const rows = await db.select({ domain: imageAllowlist.domain }).from(imageAllowlist)
  allowedDomains = new Set(rows.map((r) => r.domain.toLowerCase()))
  return allowedDomains
}

export const settingsHandlers = {
  'settings:imageAllowlist:list': async (
    _event: IpcMainInvokeEvent
  ): Promise<{ id: number; domain: string; createdAt: string }[]> => {
    const db = getDb()
    const rows = await db.select().from(imageAllowlist)
    return rows.map((r) => ({
      id: r.id,
      domain: r.domain,
      createdAt: r.createdAt.toISOString()
    }))
  },

  'settings:imageAllowlist:add': async (
    _event: IpcMainInvokeEvent,
    domain: string
  ): Promise<void> => {
    const normalized = domain.toLowerCase().trim()
    if (!normalized) return
    const db = getDb()
    await db
      .insert(imageAllowlist)
      .values({ domain: normalized })
      .onConflictDoNothing()
    // Update cache
    const cache = await ensureCache()
    cache.add(normalized)
  },

  'settings:imageAllowlist:remove': async (
    _event: IpcMainInvokeEvent,
    domain: string
  ): Promise<void> => {
    const normalized = domain.toLowerCase().trim()
    const db = getDb()
    await db.delete(imageAllowlist).where(eq(imageAllowlist.domain, normalized))
    // Update cache
    const cache = await ensureCache()
    cache.delete(normalized)
  },

  'settings:imageAllowlist:check': async (
    _event: IpcMainInvokeEvent,
    domain: string
  ): Promise<boolean> => {
    const cache = await ensureCache()
    return cache.has(domain.toLowerCase().trim())
  }
}
