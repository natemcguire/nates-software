-- Metadata-only lifecycle ledger. Terminal files, commands, output, and
-- credentials are intentionally never persisted.
CREATE TABLE IF NOT EXISTS terminal_session_tickets (
  jti TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  redeemed_at INTEGER,
  session_expires_at INTEGER,
  closed_at INTEGER,
  gateway_session_id TEXT UNIQUE,
  CHECK (expires_at > issued_at),
  CHECK (redeemed_at IS NULL OR redeemed_at >= issued_at),
  CHECK (closed_at IS NULL OR redeemed_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_terminal_tickets_user_issued ON terminal_session_tickets(user_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_terminal_tickets_active ON terminal_session_tickets(user_id, session_expires_at)
  WHERE redeemed_at IS NOT NULL AND closed_at IS NULL;
