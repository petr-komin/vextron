import { pgTable, serial, integer, text, boolean, timestamp, index } from 'drizzle-orm/pg-core'
import { messages } from './messages'

/**
 * Todo items extracted from emails by AI.
 * Each item is linked to the source message so the user can navigate back to it.
 */
export const todos = pgTable(
  'todos',
  {
    id: serial('id').primaryKey(),
    /** Source email — used for the "open email" link in the drawer */
    messageId: integer('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    /** The extracted action text */
    text: text('text').notNull(),
    /** Whether the user has checked this item off */
    done: boolean('done').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow()
  },
  (table) => ({
    messageIdx: index('todos_message_id_idx').on(table.messageId)
  })
)
