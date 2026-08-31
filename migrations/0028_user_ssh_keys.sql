-- Migration 0028: Multi-SSH-key support via user_ssh_keys table and backfill.
-- Invariants:
-- 1. A user can have multiple registered SSH keys in user_ssh_keys.
-- 2. key_prefix is unique across all users (a public key maps to exactly one user).
-- 3. Backfills existing non-empty users.ssh_public_key entries into user_ssh_keys.
-- 4. Preserves users.ssh_public_key column as a fallback and for single-key legacy compatibility.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS user_ssh_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_type TEXT NOT NULL,          -- e.g. 'ssh-ed25519'
  key_base64 TEXT NOT NULL,        -- the base64 blob only (no type prefix, no comment)
  key_prefix TEXT NOT NULL,        -- '<key_type> <key_base64>' — the exact match string the gateway sends, for fast lookup
  label TEXT,                      -- human label, e.g. 'laptop', 'agent'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_ssh_keys_prefix ON user_ssh_keys(key_prefix);
CREATE INDEX IF NOT EXISTS idx_user_ssh_keys_user ON user_ssh_keys(user_id);

-- Backfill existing keys from users.ssh_public_key
WITH raw_keys AS (
  SELECT
    id AS user_id,
    trim(ssh_public_key) AS raw_key
  FROM users
  WHERE ssh_public_key IS NOT NULL AND trim(ssh_public_key) != ''
),
token1 AS (
  SELECT
    user_id,
    substr(raw_key, 1, instr(raw_key || ' ', ' ') - 1) AS key_type,
    trim(substr(raw_key, instr(raw_key || ' ', ' ') + 1)) AS rem
  FROM raw_keys
),
parsed AS (
  SELECT
    user_id,
    key_type,
    CASE 
      WHEN instr(rem, ' ') > 0 THEN substr(rem, 1, instr(rem, ' ') - 1)
      ELSE rem
    END AS key_base64
  FROM token1
  WHERE key_type != '' AND rem != ''
)
INSERT INTO user_ssh_keys (
  id,
  user_id,
  key_type,
  key_base64,
  key_prefix,
  label,
  created_at
)
SELECT
  'key_migrated_' || user_id,
  user_id,
  key_type,
  key_base64,
  key_type || ' ' || key_base64,
  'migrated',
  CURRENT_TIMESTAMP
FROM parsed;
