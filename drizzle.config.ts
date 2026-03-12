import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/main/services/db/schema',
  out: './src/main/services/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER || 'vextron',
    password: process.env.DB_PASSWORD || 'vextron',
    database: process.env.DB_NAME || 'vextron',
    ssl: process.env.DB_SSL === 'false'
      ? false
      : { rejectUnauthorized: false }
  }
})
