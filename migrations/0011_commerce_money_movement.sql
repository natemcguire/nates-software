-- Stripe Connect transfer and reversal execution ledger.
-- Outbox identity is the permanent Stripe idempotency identity.

PRAGMA foreign_keys = ON;

ALTER TABLE commerce_transfer_outbox
    ADD COLUMN lease_expires_at DATETIME;
ALTER TABLE commerce_transfer_outbox
    ADD COLUMN stripe_idempotency_key TEXT;
ALTER TABLE commerce_transfer_outbox
    ADD COLUMN destination_stripe_account TEXT;
ALTER TABLE commerce_transfer_outbox
    ADD COLUMN last_http_status INTEGER;
ALTER TABLE commerce_transfer_outbox
    ADD COLUMN last_stripe_request_id TEXT;

UPDATE commerce_transfer_outbox
SET stripe_idempotency_key = 'transfer:' || id
WHERE stripe_idempotency_key IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_commerce_transfer_idempotency
    ON commerce_transfer_outbox(stripe_idempotency_key);
CREATE INDEX IF NOT EXISTS idx_commerce_transfer_claimable
    ON commerce_transfer_outbox(status, next_attempt_at, lease_expires_at, created_at);

CREATE TABLE IF NOT EXISTS commerce_transfer_attempts (
    id TEXT PRIMARY KEY,
    outbox_id TEXT NOT NULL REFERENCES commerce_transfer_outbox(id) ON DELETE RESTRICT,
    attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
    stripe_idempotency_key TEXT NOT NULL,
    request_sha256 TEXT NOT NULL CHECK (length(request_sha256) = 64),
    outcome TEXT NOT NULL
        CHECK (outcome IN ('started', 'succeeded', 'retryable_failure', 'terminal_failure', 'ambiguous')),
    http_status INTEGER,
    stripe_request_id TEXT,
    stripe_transfer_id TEXT,
    error_code TEXT,
    error_message TEXT,
    started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    UNIQUE (outbox_id, attempt_number)
);
CREATE INDEX IF NOT EXISTS idx_commerce_transfer_attempts_outbox
    ON commerce_transfer_attempts(outbox_id, attempt_number);

CREATE TABLE IF NOT EXISTS commerce_reversal_outbox (
    id TEXT PRIMARY KEY,
    original_outbox_id TEXT NOT NULL REFERENCES commerce_transfer_outbox(id) ON DELETE RESTRICT,
    source_event_id TEXT NOT NULL REFERENCES stripe_event_inbox(event_id) ON DELETE RESTRICT,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    currency TEXT NOT NULL CHECK (length(currency) = 3 AND currency = lower(currency)),
    stripe_idempotency_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'retryable_failure', 'succeeded', 'terminal_failure', 'cancelled')),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    claim_token TEXT,
    claimed_at DATETIME,
    lease_expires_at DATETIME,
    stripe_reversal_id TEXT UNIQUE,
    last_http_status INTEGER,
    last_stripe_request_id TEXT,
    last_error TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    UNIQUE (original_outbox_id, source_event_id)
);
CREATE INDEX IF NOT EXISTS idx_commerce_reversal_claimable
    ON commerce_reversal_outbox(status, next_attempt_at, lease_expires_at, created_at);

CREATE TABLE IF NOT EXISTS commerce_reversal_attempts (
    id TEXT PRIMARY KEY,
    reversal_outbox_id TEXT NOT NULL REFERENCES commerce_reversal_outbox(id) ON DELETE RESTRICT,
    attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
    stripe_idempotency_key TEXT NOT NULL,
    request_sha256 TEXT NOT NULL CHECK (length(request_sha256) = 64),
    outcome TEXT NOT NULL
        CHECK (outcome IN ('started', 'succeeded', 'retryable_failure', 'terminal_failure', 'ambiguous')),
    http_status INTEGER,
    stripe_request_id TEXT,
    stripe_reversal_id TEXT,
    error_code TEXT,
    error_message TEXT,
    started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    UNIQUE (reversal_outbox_id, attempt_number)
);

CREATE TRIGGER IF NOT EXISTS commerce_transfer_economics_immutable
BEFORE UPDATE ON commerce_transfer_outbox
WHEN OLD.order_id IS NOT NEW.order_id
  OR OLD.allocation_id IS NOT NEW.allocation_id
  OR OLD.destination_user_id IS NOT NEW.destination_user_id
  OR OLD.amount_cents IS NOT NEW.amount_cents
  OR OLD.currency IS NOT NEW.currency
  OR OLD.stripe_idempotency_key IS NOT NEW.stripe_idempotency_key
  OR (OLD.destination_stripe_account IS NOT NULL
      AND OLD.destination_stripe_account IS NOT NEW.destination_stripe_account)
BEGIN
    SELECT RAISE(ABORT, 'commerce transfer economics are immutable');
END;

CREATE TRIGGER IF NOT EXISTS commerce_reversal_requires_succeeded_transfer
BEFORE INSERT ON commerce_reversal_outbox
WHEN NOT EXISTS (
    SELECT 1 FROM commerce_transfer_outbox t
    WHERE t.id = NEW.original_outbox_id
      AND t.status = 'succeeded'
      AND t.stripe_transfer_id IS NOT NULL
      AND t.currency = NEW.currency
      AND NEW.amount_cents <= t.amount_cents
)
BEGIN
    SELECT RAISE(ABORT, 'commerce reversal requires a matching succeeded transfer');
END;
