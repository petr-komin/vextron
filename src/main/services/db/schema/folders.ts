import {
  pgTable,
  serial,
  varchar,
  integer,
  text,
  timestamp
} from 'drizzle-orm/pg-core'
import { accounts } from './accounts'

export const folders = pgTable('folders', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  path: text('path').notNull(),
  type: varchar('type', { length: 20 }).notNull().default('custom'),
  delimiter: varchar('delimiter', { length: 5 }).notNull().default('/'),
  unreadCount: integer('unread_count').notNull().default(0),
  totalCount: integer('total_count').notNull().default(0),
  uidValidity: integer('uid_validity'),
  uidNext: integer('uid_next'),
  createdAt: timestamp('created_at').notNull().defaultNow()
})
