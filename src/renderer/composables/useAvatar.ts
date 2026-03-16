/**
 * Avatar resolution composable.
 *
 * Uses a two-level cache:
 *  - L1: in-memory Map (lasts for the app session)
 *  - L2: persistent DB cache in main process (7-day TTL, survives restarts)
 *
 * Resolution chain (in main process): Gravatar → Clearbit logo → Gravatar identicon
 */

import { ref, watch, type Ref } from 'vue'
import { api } from '../services/api'

/** L1 in-memory cache: normalised email → resolved URL */
const cache = new Map<string, string>()

/** In-flight promises, keyed by normalised email (deduplication) */
const pending = new Map<string, Promise<string>>()

/**
 * Resolve an avatar URL for a single email address.
 * Returns a reactive ref that starts as null and fills in asynchronously.
 * Re-resolves automatically when the email changes.
 */
export function useAvatar(emailRef: Ref<string | undefined | null>): Ref<string | null> {
  const url = ref<string | null>(null)

  watch(
    emailRef,
    async (addr) => {
      if (!addr) {
        url.value = null
        return
      }

      const key = addr.toLowerCase().trim()

      // L1 cache hit — synchronous
      const cached = cache.get(key)
      if (cached) {
        url.value = cached
        return
      }

      // Deduplicate in-flight requests for the same email
      let promise = pending.get(key)
      if (!promise) {
        promise = api.avatars
          .resolve(addr)
          .then((result) => {
            cache.set(key, result.url)
            return result.url
          })
          .catch(() => '')
          .finally(() => pending.delete(key))
        pending.set(key, promise)
      }

      const resolved = await promise
      url.value = resolved || null
    },
    { immediate: true }
  )

  return url
}

/**
 * Resolve avatars for a batch of email addresses.
 * Returns a reactive map ref: normalised email → url.
 * The map fills in progressively as results arrive.
 */
export function useAvatarBatch(emailsRef: Ref<string[]>): Ref<Record<string, string>> {
  const urlMap = ref<Record<string, string>>({})

  watch(
    emailsRef,
    async (addrs) => {
      if (!addrs.length) return

      const toFetch: string[] = []

      for (const addr of addrs) {
        const key = addr.toLowerCase().trim()
        const cached = cache.get(key)
        if (cached) {
          urlMap.value[key] = cached
        } else {
          toFetch.push(addr)
        }
      }

      if (!toFetch.length) return

      try {
        const results = await api.avatars.batch(toFetch)
        for (const [email, result] of Object.entries(results)) {
          cache.set(email, result.url)
          urlMap.value[email] = result.url
        }
      } catch (err) {
        console.error('[useAvatarBatch] Failed to resolve avatars:', err)
      }
    },
    { immediate: true }
  )

  return urlMap
}
