-- 0037_first_party_sso_tickets
--
-- First-party cross-subdomain SSO (task #38). The session cookie is deliberately
-- HOST-ONLY (see functions/api/_session.ts) so tenant apps at <app>.nates-software.com
-- — which serve maker/attacker-controlled bytes — can never receive a victim's
-- session token. To let login persist ACROSS the TRUSTED first-party hosts
-- (apex, gitsmith, hotwire, slopshop, rig, chat) WITHOUT reintroducing that
-- exfiltration vector, the apex brokers a short-lived, single-use SSO ticket that
-- the destination first-party host exchanges for its OWN host-only cookie.
--
-- Only the opaque ticket ever crosses an origin boundary (in a top-level redirect
-- URL); the real session token never appears in a URL or cross-origin body. The
-- ticket is worthless to anyone but the exact allowlisted host it was minted for.
--
-- This mirrors the proven terminal_session_tickets pattern (single-use redemption
-- via a race-safe conditional UPDATE guarded on redeemed_at IS NULL).

CREATE TABLE IF NOT EXISTS sso_tickets (
  -- SHA-256 hash of the opaque ticket token (never store the raw token).
  ticket_hash   TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  -- The exact first-party host this ticket may be redeemed at (defense in depth:
  -- both authorize AND callback re-check this against the server-side allowlist).
  return_host   TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  redeemed_at   INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sso_tickets_expiry ON sso_tickets(expires_at);
CREATE INDEX IF NOT EXISTS idx_sso_tickets_user ON sso_tickets(user_id);
