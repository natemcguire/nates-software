-- Migration 0028: Multi-SSH-key support via user_ssh_keys table and backfill.
-- Invariants:
-- 1. A user can have multiple registered SSH keys in user_ssh_keys.
-- 2. key_prefix is unique across all users (a public key maps to exactly one user).
-- 3. Backfills existing non-empty users.ssh_public_key entries into user_ssh_keys.
-- 4. user_ssh_keys is the SOLE authoritative store consulted at auth time.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS user_ssh_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_type TEXT NOT NULL,          -- e.g. 'ssh-ed25519'
  key_base64 TEXT NOT NULL,        -- the base64 blob only (no type prefix, no comment)
  key_prefix TEXT NOT NULL,        -- '<key_type> <key_base64>' — the exact match string the gateway sends, for fast lookup
  label TEXT,                      -- human label, e.g. 'laptop', 'agent'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CHECK (key_prefix = key_type || ' ' || key_base64)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_ssh_keys_prefix ON user_ssh_keys(key_prefix);
CREATE INDEX IF NOT EXISTS idx_user_ssh_keys_user ON user_ssh_keys(user_id);

-- Parse and validate candidate legacy keys from users.ssh_public_key into a staging table.
-- Validation mirrors src/lib/sshDomain.ts:
-- 1. Full whitespace normalization: converts all \s (tab, newline, cr, vt, formfeed) to spaces.
-- 2. Allowed key types: ('ssh-ed25519', 'ssh-rsa', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521')
-- 3. Base64 validation (/^[A-Za-z0-9+/]+={0,2}$/):
--    - max length <= 16384
--    - at least 1 non-padding character
--    - at most 2 trailing '=' padding chars (no interior '=')
--    - non-padding characters strictly within [A-Za-z0-9+/]
CREATE TABLE _ssh_backfill_candidates AS
WITH raw_keys AS (
  SELECT
    id AS user_id,
    trim(replace(replace(replace(replace(replace(ssh_public_key, char(9), ' '), char(10), ' '), char(13), ' '), char(11), ' '), char(12), ' ')) AS raw_key
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
token2 AS (
  SELECT
    user_id,
    key_type,
    CASE 
      WHEN instr(rem, ' ') > 0 THEN substr(rem, 1, instr(rem, ' ') - 1)
      ELSE rem
    END AS key_base64
  FROM token1
),
parsed AS (
  SELECT
    user_id,
    key_type,
    key_base64,
    CASE
      WHEN key_base64 LIKE '%==' THEN substr(key_base64, 1, length(key_base64) - 2)
      WHEN key_base64 LIKE '%=' THEN substr(key_base64, 1, length(key_base64) - 1)
      ELSE key_base64
    END AS b64_body
  FROM token2
)
SELECT
  user_id,
  key_type,
  key_base64,
  key_type || ' ' || key_base64 AS key_prefix
FROM parsed
WHERE key_type IN ('ssh-ed25519', 'ssh-rsa', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521')
  AND length(key_base64) <= 16384
  AND length(b64_body) >= 1
  AND b64_body NOT GLOB '*[^A-Za-z0-9+/]*';

-- Backfill valid legacy keys into user_ssh_keys
INSERT OR IGNORE INTO user_ssh_keys (
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
  key_prefix,
  'migrated',
  CURRENT_TIMESTAMP
FROM _ssh_backfill_candidates;

-- Fail-closed guard:
-- Asserts that for EVERY legacy user with a non-empty users.ssh_public_key:
-- 1. The key was valid and parsed into _ssh_backfill_candidates, AND
-- 2. That exact normalized key_prefix landed in user_ssh_keys for that specific user_id.
-- If any user's legacy key failed validation or was skipped during backfill, COUNT > 0, tripping CHECK(x = 0).
CREATE TABLE _ssh_backfill_guard(x INTEGER CHECK(x = 0));
INSERT INTO _ssh_backfill_guard
SELECT COUNT(*) FROM users u
WHERE u.ssh_public_key IS NOT NULL AND trim(u.ssh_public_key) != ''
  AND NOT EXISTS (
    SELECT 1
    FROM _ssh_backfill_candidates c
    JOIN user_ssh_keys k ON k.user_id = c.user_id AND k.key_prefix = c.key_prefix
    WHERE c.user_id = u.id
  );
DROP TABLE _ssh_backfill_guard;
DROP TABLE _ssh_backfill_candidates;
