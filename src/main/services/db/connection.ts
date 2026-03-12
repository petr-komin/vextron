import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as schema from './schema'

const { Pool } = pg

let db: NodePgDatabase<typeof schema> | null = null
let pool: pg.Pool | null = null

export interface DbConfig {
  host: string
  port: number
  database: string
  user: string
  password: string
  ssl?: boolean | { rejectUnauthorized: boolean }
}

const DEFAULT_CONFIG: DbConfig = {
  host: 'localhost',
  port: 5432,
  database: 'vextron',
  user: 'vextron',
  password: 'vextron',
  ssl: { rejectUnauthorized: false }
}

export function initDb(config: Partial<DbConfig> = {}): NodePgDatabase<typeof schema> {
  const finalConfig = { ...DEFAULT_CONFIG, ...config }

  pool = new Pool({
    host: finalConfig.host,
    port: finalConfig.port,
    database: finalConfig.database,
    user: finalConfig.user,
    password: finalConfig.password,
    ssl: finalConfig.ssl,
    max: 10,
    idleTimeoutMillis: 30000
  })

  db = drizzle(pool, { schema })
  console.log(`[DB] Connected to PostgreSQL at ${finalConfig.host}:${finalConfig.port}/${finalConfig.database}`)
  return db
}

export function getDb(): NodePgDatabase<typeof schema> {
  if (!db) {
    return initDb()
  }
  return db
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
    db = null
    console.log('[DB] Connection closed')
  }
}
