CREATE TABLE IF NOT EXISTS sso_tickets (
  ticket_hash   TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  return_host   TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  redeemed_at   INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sso_tickets_expiry ON sso_tickets(expires_at);
CREATE INDEX IF NOT EXISTS idx_sso_tickets_user ON sso_tickets(user_id);
