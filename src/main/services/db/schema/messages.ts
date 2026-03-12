import {
  pgTable,
  serial,
  varchar,
  integer,
  text,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index
} from 'drizzle-orm/pg-core'
import { accounts } from './accounts'
import { folders } from './folders'

export const messages = pgTable('messages', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  folderId: integer('folder_id')
    .notNull()
    .references(() => folders.id, { onDelete: 'cascade' }),
  messageId: varchar('message_id', { length: 512 }),
  uid: integer('uid').notNull(),
  /** SHA-256 hash for deduplication: based on Message-ID or from+date+subject */
  dedupHash: varchar('dedup_hash', { length: 64 }),
  subject: text('subject').notNull().default(''),
  fromAddress: varchar('from_address', { length: 512 }).notNull().default(''),
  fromName: varchar('from_name', { length: 255 }).notNull().default(''),
  toAddresses: jsonb('to_addresses').$type<Array<{ name: string; address: string }>>().notNull().default([]),
  ccAddresses: jsonb('cc_addresses').$type<Array<{ name: string; address: string }>>().notNull().default([]),
  bccAddresses: jsonb('bcc_addresses').$type<Array<{ name: string; address: string }>>().notNull().default([]),
  date: timestamp('date'),
  bodyText: text('body_text').notNull().default(''),
  bodyHtml: text('body_html').notNull().default(''),
  preview: varchar('preview', { length: 300 }).notNull().default(''),
  flags: jsonb('flags')
    .$type<{
      seen: boolean
      flagged: boolean
      answered: boolean
      draft: boolean
      deleted: boolean
    }>()
    .notNull()
    .default({ seen: false, flagged: false, answered: false, draft: false, deleted: false }),
  size: integer('size').notNull().default(0),
  hasAttachments: boolean('has_attachments').notNull().default(false),
  rawHeaders: jsonb('raw_headers').$type<Record<string, string>>(),

  // AI fields
  aiCategory: varchar('ai_category', { length: 100 }),
  aiPriority: varchar('ai_priority', { length: 10 }),
  aiSummary: text('ai_summary'),

  createdAt: timestamp('created_at').notNull().defaultNow()
}, (table) => [
  // Global dedup per account — first import wins, duplicates in other folders are skipped
  uniqueIndex('messages_account_dedup_hash_idx')
    .on(table.accountId, table.dedupHash),
  // Primary query index: folder listing sorted by date (covers messages:list, messages:count)
  index('messages_folder_date_idx')
    .on(table.folderId, table.date),
  // Account-level queries and cascade deletes
  index('messages_account_id_idx')
    .on(table.accountId),
  // Folder + account combo for sync operations (UID lookup per folder)
  index('messages_folder_uid_idx')
    .on(table.folderId, table.uid)
])
