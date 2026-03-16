import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { getDb } from './db/connection'
import { avatars } from './db/schema/avatars'
import type { AvatarSource } from './db/schema/avatars'

/** How long (ms) before a cached avatar is re-checked. Default: 7 days. */
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** Timeout for external avatar HEAD requests (ms). */
const FETCH_TIMEOUT_MS = 5000

export interface AvatarResult {
  url: string
  source: AvatarSource
}

/**
 * Compute the Gravatar MD5 hash for an email address.
 * Gravatar requires lowercase, trimmed email, then MD5.
 */
function gravatarHash(email: string): string {
  return createHash('md5').update(email.toLowerCase().trim()).digest('hex')
}

/**
 * Attempt an HTTP HEAD request with a timeout.
 * Returns true if the response is 2xx.
 */
async function headOk(url: string): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    const res = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow'
    })
    clearTimeout(timer)
    return res.ok
  } catch {
    return false
  }
}

/**
 * Resolve an avatar URL for an email address using the following chain:
 *  1. Gravatar (d=404 probe) — real user photo if they have one
 *  2. Favicon.im — high-quality PNG icon fetched from the sender's domain website
 *  3. Google Favicon API — broad coverage fallback, Google-cached icon at 64×64
 *  4. Gravatar identicon — always exists, deterministic geometric pattern (last resort)
 *
 * Results are cached in the DB for CACHE_TTL_MS to avoid hammering external services.
 */
export async function resolveAvatar(email: string): Promise<AvatarResult> {
  const normalizedEmail = email.toLowerCase().trim()
  const db = getDb()

  // ── 1. Check DB cache ────────────────────────────────────────────────────
  const [cached] = await db
    .select()
    .from(avatars)
    .where(eq(avatars.email, normalizedEmail))
    .limit(1)

  if (cached) {
    const ageMs = Date.now() - new Date(cached.resolvedAt).getTime()
    if (ageMs < CACHE_TTL_MS) {
      return { url: cached.avatarUrl, source: cached.source as AvatarSource }
    }
  }

  // ── 2. Resolve fresh ─────────────────────────────────────────────────────
  const hash = gravatarHash(normalizedEmail)
  const domain = normalizedEmail.includes('@') ? normalizedEmail.split('@')[1] : null
  let result: AvatarResult

  // Step 1: Gravatar — real photo if the sender registered one
  const gravatarProbeUrl = `https://www.gravatar.com/avatar/${hash}?s=80&d=404`
  if (await headOk(gravatarProbeUrl)) {
    result = {
      url: `https://www.gravatar.com/avatar/${hash}?s=80`,
      source: 'gravatar'
    }
  } else if (domain && await headOk(`https://favicon.im/${domain}`)) {
    // Step 2: Favicon.im — fetches high-quality PNG icon from the domain's website
    result = {
      url: `https://favicon.im/${domain}`,
      source: 'favicon-im'
    }
  } else if (domain) {
    // Step 3: Google Favicon API — excellent coverage, Google-cached, returns 64×64
    // No HEAD probe needed — Google always returns an image (at worst a generic globe),
    // which is still preferable to the identicon geometric pattern.
    result = {
      url: `https://www.google.com/s2/favicons?domain=${domain}&sz=64`,
      source: 'google-favicon'
    }
  } else {
    // Step 4: Gravatar identicon — deterministic geometric pattern, always exists
    result = {
      url: `https://www.gravatar.com/avatar/${hash}?s=80&d=identicon`,
      source: 'identicon'
    }
  }

  // ── 3. Upsert into DB cache ──────────────────────────────────────────────
  try {
    if (cached) {
      await db
        .update(avatars)
        .set({ avatarUrl: result.url, source: result.source, resolvedAt: new Date() })
        .where(eq(avatars.email, normalizedEmail))
    } else {
      await db.insert(avatars).values({
        email: normalizedEmail,
        avatarUrl: result.url,
        source: result.source,
        resolvedAt: new Date()
      })
    }
  } catch (err) {
    // Non-fatal — we still return the resolved result even if caching fails
    console.error('[Avatar] Failed to cache avatar for', normalizedEmail, err)
  }

  return result
}

/**
 * Resolve avatars for multiple email addresses in parallel.
 * Returns a map of email → AvatarResult. Emails that fail are omitted.
 */
export async function resolveBatch(emails: string[]): Promise<Record<string, AvatarResult>> {
  const unique = [...new Set(emails.map((e) => e.toLowerCase().trim()).filter(Boolean))]
  const results = await Promise.allSettled(unique.map((email) => resolveAvatar(email)))

  const out: Record<string, AvatarResult> = {}
  for (let i = 0; i < unique.length; i++) {
    const r = results[i]
    if (r.status === 'fulfilled') {
      out[unique[i]] = r.value
    }
  }
  return out
}
