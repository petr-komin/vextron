import { pgTable, serial, varchar, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

/**
 * Allowlisted sender domains for automatic remote image loading.
 * When a message is from a domain in this list, remote images are loaded
 * automatically without showing the blocking banner.
 */
export const imageAllowlist = pgTable(
  'image_allowlist',
  {
    id: serial('id').primaryKey(),
    domain: varchar('domain', { length: 255 }).notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow()
  },
  (table) => ({
    domainIdx: uniqueIndex('image_allowlist_domain_idx').on(table.domain)
  })
)
