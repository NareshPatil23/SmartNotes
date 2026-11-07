-- ========================================================
-- SmartNotes AI - Neon PostgreSQL Production Schema
-- Compatible with Neon Serverless Postgres (Postgres 15+)
-- ========================================================

-- 1. Users Table
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

-- 2. User Settings Table (Stores theme & AES-256 encrypted BYOK keys)
CREATE TABLE IF NOT EXISTS user_settings (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  ai_provider VARCHAR(32) DEFAULT 'platform',
  encrypted_byok_key TEXT,
  preferred_model VARCHAR(64) DEFAULT 'gemini-3.8-flash',
  default_theme VARCHAR(32) DEFAULT 'default',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Documents Table (Uploaded source PDFs, textbooks, docs)
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

-- 4. Notes Table (Study notes with LaTeX math, diagrams, handwritten styles)
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

-- 5. Generations Table (AI generation history & metrics)
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

-- 6. Usage Table (Tracks monthly generation allowances)
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

-- 7. Subscriptions Table (SaaS subscription tier tracking)
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

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_notes_user_id ON notes(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents(user_id);
CREATE INDEX IF NOT EXISTS idx_generations_user_id ON generations(user_id);
