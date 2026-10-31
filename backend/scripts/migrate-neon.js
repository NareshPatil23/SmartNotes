/**
 * Standalone Neon PostgreSQL Schema Migration Runner
 * Usage:
 *   DATABASE_URL="postgresql://..." node scripts/migrate-neon.js
 */
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Load .env.local and .env from project root and backend folder
[
  path.resolve(process.cwd(), '.env.local'),
  path.resolve(process.cwd(), '.env'),
  path.resolve(__dirname, '../../.env.local'),
  path.resolve(__dirname, '../../.env'),
  path.resolve(__dirname, '../.env.local'),
  path.resolve(__dirname, '../.env')
].forEach(envPath => {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
});

const { resolveNeonHost } = require('../src/config/neonDns');

async function runMigration() {
  // Use unpooled direct connection for migrations per Neon guidelines, fallback to pooled
  const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;

  if (!connectionString || (!connectionString.startsWith('postgres://') && !connectionString.startsWith('postgresql://'))) {
    console.error('[Error] DATABASE_URL or DATABASE_URL_UNPOOLED must be set and start with postgres:// or postgresql://');
    process.exit(1);
  }

  const parsed = new URL(connectionString);
  const { host: resolvedHost, servername } = await resolveNeonHost(parsed.hostname);

  console.log('[Migration] Connecting to Neon PostgreSQL...');
  const pool = new Pool({
    host: resolvedHost,
    port: parseInt(parsed.port || '5432', 10),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.slice(1),
    ssl: { rejectUnauthorized: false, servername },
    connectionTimeoutMillis: 15000
  });

  try {
    const schemaSql = fs.readFileSync(path.join(__dirname, '../src/config/schema.sql'), 'utf8');
    console.log('[Migration] Executing schema.sql statements...');
    await pool.query(schemaSql);
    console.log('✅ [Migration Succeeded] All tables & indexes created successfully:');
    console.log('   - users');
    console.log('   - user_settings');
    console.log('   - documents');
    console.log('   - notes');
    console.log('   - generations');
    console.log('   - usage');
    console.log('   - subscriptions');
    console.log('   - indexes: idx_notes_user_id, idx_documents_user_id, idx_generations_user_id');
  } catch (err) {
    console.error('❌ [Migration Failed]:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
