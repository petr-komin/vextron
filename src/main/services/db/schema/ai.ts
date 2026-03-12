import {
  pgTable,
  serial,
  varchar,
  integer,
  text,
  boolean,
  timestamp
} from 'drizzle-orm/pg-core'
import { accounts } from './accounts'

export const aiConfig = pgTable('ai_config', {
  id: serial('id').primaryKey(),
  provider: varchar('provider', { length: 20 }).notNull(), // openai, anthropic, ollama
  apiKey: text('api_key'),
  model: varchar('model', { length: 100 }).notNull(),
  baseUrl: varchar('base_url', { length: 500 }),
  embeddingModel: varchar('embedding_model', { length: 100 }),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow()
})

export const labels = pgTable('labels', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id')
    .references(() => accounts.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  color: varchar('color', { length: 7 }).notNull().default('#808080'),
  isAiGenerated: boolean('is_ai_generated').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow()
})

export const contacts = pgTable('contacts', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  email: varchar('email', { length: 255 }).notNull(),
  name: varchar('name', { length: 255 }).notNull().default(''),
  frequency: integer('frequency').notNull().default(0),
  lastContacted: timestamp('last_contacted'),
  createdAt: timestamp('created_at').notNull().defaultNow()
})
