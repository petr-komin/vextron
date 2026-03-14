import { pgTable, serial, varchar, integer, boolean, timestamp, text } from 'drizzle-orm/pg-core'

export const accounts = pgTable('accounts', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull(),
  imapHost: varchar('imap_host', { length: 255 }).notNull(),
  imapPort: integer('imap_port').notNull().default(993),
  smtpHost: varchar('smtp_host', { length: 255 }).notNull(),
  smtpPort: integer('smtp_port').notNull().default(587),
  username: varchar('username', { length: 255 }).notNull(),
  encryptedPassword: text('encrypted_password').notNull(),
  authType: varchar('auth_type', { length: 20 }).notNull().default('password'),
  security: varchar('security', { length: 20 }).notNull().default('tls'),
  smtpSecurity: varchar('smtp_security', { length: 20 }).notNull().default('starttls'),
  isActive: boolean('is_active').notNull().default(true),
  color: varchar('color', { length: 7 }).notNull().default('#4A90D9'),
  /** Periodic sync interval in minutes. 0 = disabled (manual only). */
  syncIntervalMinutes: integer('sync_interval_minutes').notNull().default(0),
  /** Whether to automatically analyze new emails with AI after sync. */
  autoAnalyze: boolean('auto_analyze').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow()
})
