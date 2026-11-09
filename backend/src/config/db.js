const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { Pool } = require('pg');
const { resolveNeonHost } = require('./neonDns');

// Load environment variables (.env.local from project root takes top priority)
[
  path.resolve(process.cwd(), '.env.local'),
  path.resolve(process.cwd(), '.env'),
  path.resolve(__dirname, '../../../.env.local'),
  path.resolve(__dirname, '../../../.env'),
  path.resolve(__dirname, '../../.env.local'),
  path.resolve(__dirname, '../../.env')
].forEach(envPath => {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
});

let dbType = null;
let pool = null;
let sqliteDb = null;

const DATABASE_URL = process.env.DATABASE_URL;
const isPostgres = DATABASE_URL && (DATABASE_URL.startsWith('postgres://') || DATABASE_URL.startsWith('postgresql://'));

if (isPostgres) {
  dbType = 'postgres';
  console.log('[Database] Active database mode: Postgres');
} else {
  // In production, NEVER fall back to SQLite
  if (process.env.NODE_ENV === 'production') {
    console.error('DATABASE_URL is required in production');
    process.exit(1);
  }

  dbType = 'sqlite';
  console.log('[Database] Active database mode: SQLite');
}

/**
 * Lazily loads sqlite3 only in local development when DATABASE_URL is not set.
 * Never loaded in production or at module evaluation time.
 */
function getSqliteDb() {
  if (sqliteDb) return sqliteDb;

  if (process.env.NODE_ENV === 'production') {
    console.error('DATABASE_URL is required in production');
    process.exit(1);
  }

  try {
    const sqlite3 = require('sqlite3');
    const dbPath = process.env.SQLITE_DB_PATH || path.join(__dirname, '../../smartnotes.db');
    sqliteDb = new sqlite3.Database(dbPath);
    return sqliteDb;
  } catch (err) {
    console.error('[Database] Failed to load sqlite3 for local development:', err.message);
    throw err;
  }
}

async function getPgPool() {
  if (pool) return pool;

  const parsed = new URL(DATABASE_URL);
  const { host: resolvedHost, servername } = await resolveNeonHost(parsed.hostname);

  pool = new Pool({
    host: resolvedHost,
    port: parseInt(parsed.port || '5432', 10),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.slice(1),
    ssl: { rejectUnauthorized: false, servername },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000, // 10s timeout for sleeping serverless Neon instances
    keepAlive: true
  });

  return pool;
}

/**
 * Universal query runner: executes parameterized queries with $1, $2 placeholder style.
 * Includes automatic retry with backoff for serverless Neon PostgreSQL cold starts.
 */
async function query(sql, params = []) {
  if (dbType === 'postgres') {
    const activePool = await getPgPool();
    let attempts = 0;
    const maxAttempts = 3;
    while (attempts < maxAttempts) {
      try {
        const res = await activePool.query(sql, params);
        return { rows: res.rows, rowCount: res.rowCount };
      } catch (err) {
        attempts++;
        const isTransient = err.code === 'ECONNRESET' ||
                            err.code === '57P01' || // admin_shutdown (Neon cold sleep)
                            err.code === '08006' || // connection_failure
                            err.code === '08001' || // sqlclient_unable_to_establish_sqlconnection
                            err.message?.includes('Connection') ||
                            err.message?.includes('timeout') ||
                            err.message?.includes('closed');

        if (attempts < maxAttempts && isTransient) {
          console.warn(`[Database] Neon wake-up/reconnect attempt ${attempts}/${maxAttempts}. Retrying in 1.5s...`);
          await new Promise(resolve => setTimeout(resolve, 1500));
          continue;
        }
        throw err;
      }
    }
  } else {
    const db = getSqliteDb();
    return new Promise((resolve, reject) => {
      // Convert $1, $2, $3 to ? for SQLite
      let sqliteSql = sql.replace(/\$(\d+)/g, '?');
      
      const isSelect = /^\s*(SELECT|PRAGMA)/i.test(sqliteSql);
      if (isSelect) {
        db.all(sqliteSql, params, (err, rows) => {
          if (err) return reject(err);
          resolve({ rows: rows || [], rowCount: (rows || []).length });
        });
      } else {
        db.run(sqliteSql, params, function (err) {
          if (err) return reject(err);
          resolve({ rows: [], rowCount: this.changes, lastID: this.lastID });
        });
      }
    });
  }
}

/**
 * Initialize all required SaaS tables and indexes
 */
async function initDatabase() {
  console.log('[Database] Running initial schema migrations...');

  const schemaPostgres = `
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(64) PRIMARY KEY,
      google_id VARCHAR(128) UNIQUE,
      email VARCHAR(255) UNIQUE NOT NULL,
      name VARCHAR(255),
      profile_image TEXT,
      plan VARCHAR(32) DEFAULT 'free',
      status VARCHAR(32) DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(64) UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      ai_provider VARCHAR(32) DEFAULT 'platform',
      encrypted_byok_key TEXT,
      preferred_model VARCHAR(64) DEFAULT 'gemini-3.6-flash',
      default_theme VARCHAR(32) DEFAULT 'default',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS documents (
      id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
      filename VARCHAR(255) NOT NULL,
      file_type VARCHAR(64),
      file_size BIGINT,
      storage_location TEXT,
      processing_status VARCHAR(32) DEFAULT 'completed',
      raw_text TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS notes (
      id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
      document_id VARCHAR(64) REFERENCES documents(id) ON DELETE SET NULL,
      title VARCHAR(255) NOT NULL,
      subtitle VARCHAR(255),
      questions TEXT,
      raw_content TEXT,
      generation_type VARCHAR(64) DEFAULT 'qa',
      mode VARCHAR(32) DEFAULT 'modern',
      status VARCHAR(32) DEFAULT 'draft',
      is_favorite BOOLEAN DEFAULT FALSE,
      is_deleted BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS generations (
      id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
      document_id VARCHAR(64) REFERENCES documents(id) ON DELETE SET NULL,
      model VARCHAR(64),
      generation_type VARCHAR(64),
      status VARCHAR(32) DEFAULT 'success',
      tokens_used INTEGER DEFAULT 0,
      duration_ms INTEGER DEFAULT 0,
      error_message TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS usage (
      id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
      period VARCHAR(16) NOT NULL,
      generations_used INTEGER DEFAULT 0,
      tokens_used INTEGER DEFAULT 0,
      storage_used_bytes BIGINT DEFAULT 0,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT unique_user_period UNIQUE (user_id, period)
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(64) UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      plan VARCHAR(32) DEFAULT 'free',
      provider VARCHAR(64) DEFAULT 'manual',
      provider_subscription_id VARCHAR(128) UNIQUE,
      status VARCHAR(32) DEFAULT 'active',
      current_period_start TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      current_period_end TIMESTAMP,
      cancel_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_notes_user_id ON notes(user_id);
    CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents(user_id);
    CREATE INDEX IF NOT EXISTS idx_generations_user_id ON generations(user_id);
  `;

  const schemaSqlite = `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      google_id TEXT UNIQUE,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      profile_image TEXT,
      plan TEXT DEFAULT 'free',
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      id TEXT PRIMARY KEY,
      user_id TEXT UNIQUE,
      ai_provider TEXT DEFAULT 'platform',
      encrypted_byok_key TEXT,
      preferred_model TEXT DEFAULT 'gemini-3.6-flash',
      default_theme TEXT DEFAULT 'default',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      filename TEXT NOT NULL,
      file_type TEXT,
      file_size INTEGER,
      storage_location TEXT,
      processing_status TEXT DEFAULT 'completed',
      raw_text TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      document_id TEXT,
      title TEXT NOT NULL,
      subtitle TEXT,
      questions TEXT,
      raw_content TEXT,
      generation_type TEXT DEFAULT 'qa',
      mode TEXT DEFAULT 'modern',
      status TEXT DEFAULT 'draft',
      is_favorite INTEGER DEFAULT 0,
      is_deleted INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS generations (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      document_id TEXT,
      model TEXT,
      generation_type TEXT,
      status TEXT DEFAULT 'success',
      tokens_used INTEGER DEFAULT 0,
      duration_ms INTEGER DEFAULT 0,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS usage (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      period TEXT NOT NULL,
      generations_used INTEGER DEFAULT 0,
      tokens_used INTEGER DEFAULT 0,
      storage_used_bytes INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, period),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT UNIQUE,
      plan TEXT DEFAULT 'free',
      provider TEXT DEFAULT 'manual',
      provider_subscription_id TEXT UNIQUE,
      status TEXT DEFAULT 'active',
      current_period_start DATETIME DEFAULT CURRENT_TIMESTAMP,
      current_period_end DATETIME,
      cancel_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_notes_user_id ON notes(user_id);
    CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents(user_id);
    CREATE INDEX IF NOT EXISTS idx_generations_user_id ON generations(user_id);
  `;

  if (dbType === 'postgres') {
    const activePool = await getPgPool();
    await activePool.query(schemaPostgres);
  } else {
    const db = getSqliteDb();
    // Run statements sequentially for SQLite
    const statements = schemaSqlite
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    for (const stmt of statements) {
      await new Promise((resolve, reject) => {
        db.run(stmt, (err) => {
          if (err) return reject(err);
          resolve();
        });
      });
    }
  }

  console.log('[Database] Schema migrations completed successfully.');
}

module.exports = {
  query,
  initDatabase,
  getDbType: () => dbType
};
