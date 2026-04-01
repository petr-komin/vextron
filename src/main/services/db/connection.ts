import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as schema from './schema'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env') })

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
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'vextron',
  user: process.env.DB_USER || 'vextron',
  password: process.env.DB_PASSWORD || 'vextron',
  ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false }
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
