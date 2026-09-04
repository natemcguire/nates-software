PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS user_ssh_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_type TEXT NOT NULL,
  key_base64 TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  label TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CHECK (key_prefix = key_type || ' ' || key_base64)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_ssh_keys_prefix ON user_ssh_keys(key_prefix);
CREATE INDEX IF NOT EXISTS idx_user_ssh_keys_user ON user_ssh_keys(user_id);

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
