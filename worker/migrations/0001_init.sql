-- Migration number: 0001 	 2026-10-25T00:00:00.000Z

-- Same logical schema as the Node server (src/pool/index.ts), with the
-- columns added by its ALTER TABLE migration folded in.

CREATE TABLE IF NOT EXISTS pools (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  name TEXT NOT NULL,
  cursor INTEGER NOT NULL DEFAULT 0,
  strategy TEXT NOT NULL DEFAULT '',
  strategy_state TEXT NOT NULL DEFAULT '{}',
  base_url TEXT NOT NULL DEFAULT '',
  key_header TEXT NOT NULL DEFAULT 'X-API-Key',
  key_prefix TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pool_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pool_id INTEGER NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  api_key TEXT NOT NULL,
  credentials TEXT NOT NULL DEFAULT '{}',
  info TEXT NOT NULL DEFAULT '',
  cooldown_until INTEGER NOT NULL DEFAULT 0,
  latency_ms REAL,
  consec_fail INTEGER NOT NULL DEFAULT 0,
  weight INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 0,
  picks INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pool_id INTEGER NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  key_id INTEGER NOT NULL REFERENCES pool_keys(id) ON DELETE CASCADE,
  tokens INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pool_id INTEGER NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  key_id INTEGER NOT NULL REFERENCES pool_keys(id) ON DELETE CASCADE,
  method TEXT NOT NULL DEFAULT 'POST',
  path TEXT NOT NULL DEFAULT '',
  status INTEGER,
  tokens INTEGER NOT NULL DEFAULT 0,
  body TEXT NOT NULL DEFAULT '',
  truncated INTEGER NOT NULL DEFAULT 0,
  encoding TEXT NOT NULL DEFAULT 'text',
  content_type TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pool_keys_pool ON pool_keys(pool_id);
CREATE INDEX IF NOT EXISTS idx_usage_pool_created ON usage(pool_id, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_key_created ON usage(key_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pools_provider ON pools(provider);
CREATE INDEX IF NOT EXISTS idx_calls_pool_created ON calls(pool_id, created_at);
