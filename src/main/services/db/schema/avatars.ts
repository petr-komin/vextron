import { pgTable, serial, varchar, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

export type AvatarSource = 'gravatar' | 'favicon-im' | 'google-favicon' | 'identicon'

/**
 * Cached avatar URLs for email senders.
 * Resolution order: Gravatar → Favicon.im → Google Favicon API → Gravatar identicon.
 * Cached for 7 days before re-checking.
 */
export const avatars = pgTable(
  'avatars',
  {
    id: serial('id').primaryKey(),
    /** Lowercase, trimmed email address used as cache key */
    email: varchar('email', { length: 255 }).notNull(),
    /** Resolved avatar image URL */
    avatarUrl: varchar('avatar_url', { length: 512 }).notNull(),
    /** Which service provided this avatar */
    source: varchar('source', { length: 20 }).notNull().$type<AvatarSource>(),
    /** When this entry was last resolved — used for 7-day expiry */
    resolvedAt: timestamp('resolved_at').notNull().defaultNow()
  },
  (table) => ({
    emailIdx: uniqueIndex('avatars_email_idx').on(table.email)
  })
)
