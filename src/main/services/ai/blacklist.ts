import { eq, and } from 'drizzle-orm'
import { getDb } from '../db/connection'
import { aiBlacklist } from '../db/schema'
import type { AiBlacklistRule, AiBlacklistPatternType } from '../../../shared/types'

// ─── In-memory cache ─────────────────────────────────────────────────────────

let cachedRules: AiBlacklistRule[] | null = null

function invalidateCache(): void {
  cachedRules = null
}

async function getRules(): Promise<AiBlacklistRule[]> {
  if (cachedRules) return cachedRules

  const db = getDb()
  const rows = await db
    .select()
    .from(aiBlacklist)
    .orderBy(aiBlacklist.createdAt)

  cachedRules = rows.map((r) => ({
    id: r.id,
    pattern: r.pattern,
    patternType: r.patternType as AiBlacklistPatternType,
    createdAt: r.createdAt.toISOString()
  }))

  return cachedRules
}

// ─── Pattern matching ────────────────────────────────────────────────────────

/**
 * Match a simple wildcard pattern against a string (case-insensitive).
 * Supports '*' as a wildcard for zero or more characters.
 * e.g. "Your order*" matches "Your order #12345"
 *      "*shipping*" matches "Your shipping update"
 */
function wildcardMatch(pattern: string, value: string): boolean {
  const escaped = pattern
    .toLowerCase()
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex chars except *
    .replace(/\*/g, '.*') // convert * to .*

  const regex = new RegExp(`^${escaped}$`, 'i')
  return regex.test(value)
}

/**
 * Extract domain from an email address.
 * "user@example.com" → "example.com"
 */
function extractDomain(email: string): string {
  const atIndex = email.lastIndexOf('@')
  return atIndex >= 0 ? email.substring(atIndex + 1).toLowerCase() : email.toLowerCase()
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Check if a message should be excluded from AI processing based on blacklist rules.
 */
export async function isBlacklisted(fromAddress: string, subject: string): Promise<boolean> {
  const rules = await getRules()
  const senderDomain = extractDomain(fromAddress)
  const senderAddress = fromAddress.toLowerCase()

  for (const rule of rules) {
    switch (rule.patternType) {
      case 'domain':
        if (wildcardMatch(rule.pattern, senderDomain)) return true
        break
      case 'address':
        if (senderAddress === rule.pattern.toLowerCase()) return true
        break
      case 'subject':
        if (wildcardMatch(rule.pattern, subject)) return true
        break
    }
  }

  return false
}

/**
 * Add a new blacklist rule. Returns the created rule.
 */
export async function addRule(
  pattern: string,
  patternType: AiBlacklistPatternType
): Promise<AiBlacklistRule> {
  const db = getDb()
  const [row] = await db
    .insert(aiBlacklist)
    .values({ pattern, patternType })
    .onConflictDoNothing()
    .returning()

  if (!row) {
    // Already exists — fetch it
    const [existing] = await db
      .select()
      .from(aiBlacklist)
      .where(and(eq(aiBlacklist.pattern, pattern), eq(aiBlacklist.patternType, patternType)))

    invalidateCache()
    return {
      id: existing.id,
      pattern: existing.pattern,
      patternType: existing.patternType as AiBlacklistPatternType,
      createdAt: existing.createdAt.toISOString()
    }
  }

  invalidateCache()
  return {
    id: row.id,
    pattern: row.pattern,
    patternType: row.patternType as AiBlacklistPatternType,
    createdAt: row.createdAt.toISOString()
  }
}

/**
 * Remove a blacklist rule by ID.
 */
export async function removeRule(id: number): Promise<void> {
  const db = getDb()
  await db.delete(aiBlacklist).where(eq(aiBlacklist.id, id))
  invalidateCache()
}

/**
 * List all blacklist rules.
 */
export async function listRules(): Promise<AiBlacklistRule[]> {
  return getRules()
}
