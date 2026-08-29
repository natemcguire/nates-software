-- Session hardening. Raw bearer/cookie tokens must never be stored in D1.
-- Existing sessions are intentionally invalidated during this migration.

PRAGMA foreign_keys = ON;

DROP TABLE IF EXISTS user_sessions;

CREATE TABLE user_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME,
    revoked_at DATETIME,
    CHECK (length(token_hash) = 64)
);
CREATE INDEX idx_sessions_user ON user_sessions(user_id);
CREATE INDEX idx_sessions_expires ON user_sessions(expires_at);

CREATE TABLE auth_rate_limits (
    scope TEXT NOT NULL,
    subject_hash TEXT NOT NULL,
    window_started_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    blocked_until INTEGER,
    PRIMARY KEY (scope, subject_hash)
);
CREATE INDEX idx_auth_rate_limits_blocked ON auth_rate_limits(blocked_until);
