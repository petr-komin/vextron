import {
  pgTable,
  serial,
  varchar,
  integer,
  text,
  boolean,
  timestamp,
  uniqueIndex,
  index,
  customType
} from 'drizzle-orm/pg-core'
import { accounts } from './accounts'
import { messages } from './messages'

// ─── Custom pgvector type ────────────────────────────────────────────────────

/**
 * Custom Drizzle type for pgvector's `vector(N)` column type.
 * Stored as a float array in JS, serialized to/from pgvector format in SQL.
 */
const vector = customType<{
  data: number[]
  driverData: string
  config: { dimensions: number }
}>({
  dataType(config) {
    return `vector(${config?.dimensions ?? 1024})`
  },
  fromDriver(value: unknown): number[] {
    // pgvector returns strings like "[0.1,0.2,0.3]"
    if (typeof value === 'string') {
      return JSON.parse(value.replace('(', '[').replace(')', ']'))
    }
    return value as number[]
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`
  }
})

export const aiConfig = pgTable('ai_config', {
  id: serial('id').primaryKey(),
  provider: varchar('provider', { length: 20 }).notNull(), // together, openai, anthropic, ollama
  apiKey: text('api_key'),
  model: varchar('model', { length: 100 }).notNull(),
  baseUrl: varchar('base_url', { length: 500 }),
  embeddingModel: varchar('embedding_model', { length: 100 }),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow()
})

export const aiBlacklist = pgTable(
  'ai_blacklist',
  {
    id: serial('id').primaryKey(),
    pattern: text('pattern').notNull(), // e.g. "github.com", "noreply@amazon.com", "Your order*"
    patternType: varchar('pattern_type', { length: 20 }).notNull(), // 'domain' | 'address' | 'subject'
    createdAt: timestamp('created_at').notNull().defaultNow()
  },
  (table) => [
    uniqueIndex('ai_blacklist_pattern_type_idx').on(table.pattern, table.patternType)
  ]
)

export const labels = pgTable('labels', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id')
    .references(() => accounts.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  color: varchar('color', { length: 7 }).notNull().default('#808080'),
  isAiGenerated: boolean('is_ai_generated').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow()
})

export const contacts = pgTable(
  'contacts',
  {
    id: serial('id').primaryKey(),
    accountId: integer('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    email: varchar('email', { length: 255 }).notNull(),
    name: varchar('name', { length: 255 }).notNull().default(''),
    frequency: integer('frequency').notNull().default(0),
    lastContacted: timestamp('last_contacted'),
    isFavorite: boolean('is_favorite').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow()
  },
  (table) => [
    uniqueIndex('contacts_account_email_idx').on(table.accountId, table.email)
  ]
)

// ─── Vector Embeddings ──────────────────────────────────────────────────────

export const messageEmbeddings = pgTable(
  'message_embeddings',
  {
    id: serial('id').primaryKey(),
    messageId: integer('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    embedding: vector('embedding', { dimensions: 1024 }).notNull(),
    model: varchar('model', { length: 100 }).notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow()
  },
  (table) => [
    // One embedding per message
    uniqueIndex('message_embeddings_message_id_idx').on(table.messageId),
    // Note: cosine distance index (HNSW) created via raw SQL migration
    // since Drizzle doesn't support pgvector operator class indexes
  ]
)
