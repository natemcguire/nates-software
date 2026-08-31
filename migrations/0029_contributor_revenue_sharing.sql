-- Migration 0029: Contributor Revenue Sharing (Schema Only, Dark)
-- Introduces contributor_shares table, grantable_bps on repositories,
-- and widens commerce_order_allocations, commerce_outbox_requires_fulfilled_allocation,
-- and commerce_recovery_matches_order_allocation to admit 'contributor' role.

PRAGMA defer_foreign_keys = true;

-- 1. New table contributor_shares + indexes + triggers
CREATE TABLE IF NOT EXISTS contributor_shares (
    id TEXT PRIMARY KEY,
    repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    contributor_user_id TEXT NOT NULL REFERENCES users(id),
    granted_by_user_id TEXT NOT NULL REFERENCES users(id),
    merge_job_id TEXT,
    merge_attempt_id TEXT,
    merge_approval_id TEXT,
    basis_points INTEGER NOT NULL CHECK (basis_points > 0 AND basis_points <= 10000),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'revoked')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    activated_at DATETIME,
    revoked_at DATETIME,
    CHECK (contributor_user_id != granted_by_user_id),
    CHECK (
      (status = 'pending' AND activated_at IS NULL AND revoked_at IS NULL) OR
      (status = 'active' AND activated_at IS NOT NULL AND revoked_at IS NULL) OR
      (status = 'revoked' AND activated_at IS NULL AND revoked_at IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_contributor_shares_attempt
    ON contributor_shares(merge_attempt_id);

CREATE INDEX IF NOT EXISTS idx_contributor_shares_repo_status
    ON contributor_shares(repository_id, status);

CREATE INDEX IF NOT EXISTS idx_contributor_shares_contributor
    ON contributor_shares(contributor_user_id);

CREATE TRIGGER IF NOT EXISTS contributor_shares_no_delete
BEFORE DELETE ON contributor_shares
BEGIN
    SELECT RAISE(ABORT, 'contributor_shares rows cannot be deleted; use revocation');
END;

CREATE TRIGGER IF NOT EXISTS contributor_shares_economics_immutable
BEFORE UPDATE ON contributor_shares
WHEN OLD.repository_id IS NOT NEW.repository_id
  OR OLD.contributor_user_id IS NOT NEW.contributor_user_id
  OR OLD.granted_by_user_id IS NOT NEW.granted_by_user_id
  OR OLD.basis_points IS NOT NEW.basis_points
  OR OLD.merge_job_id IS NOT NEW.merge_job_id
  OR OLD.merge_attempt_id IS NOT NEW.merge_attempt_id
  OR OLD.merge_approval_id IS NOT NEW.merge_approval_id
  OR (OLD.activated_at IS NOT NULL AND OLD.activated_at IS NOT NEW.activated_at)
  OR (OLD.revoked_at IS NOT NULL AND OLD.revoked_at IS NOT NEW.revoked_at)
BEGIN
    SELECT RAISE(ABORT, 'contributor share economics are immutable');
END;

CREATE TRIGGER IF NOT EXISTS contributor_shares_status_forward_only
BEFORE UPDATE ON contributor_shares
WHEN (
  (OLD.status IS NOT NEW.status AND NOT (OLD.status = 'pending' AND NEW.status IN ('active', 'revoked')))
  OR (OLD.status = 'pending' AND NEW.status = 'active' AND (NEW.activated_at IS NULL OR NEW.revoked_at IS NOT NULL))
  OR (OLD.status = 'pending' AND NEW.status = 'revoked' AND (NEW.revoked_at IS NULL OR NEW.activated_at IS NOT NULL))
  OR (NEW.status = 'pending' AND (NEW.activated_at IS NOT NULL OR NEW.revoked_at IS NOT NULL))
  OR (NEW.status = 'active' AND NEW.revoked_at IS NOT NULL)
  OR (NEW.status = 'revoked' AND NEW.activated_at IS NOT NULL)
)
BEGIN
    SELECT RAISE(ABORT, 'contributor share status transition is forward-only (pending to active or revoked)');
END;

-- 2. repositories.grantable_bps
ALTER TABLE repositories ADD COLUMN grantable_bps INTEGER NOT NULL DEFAULT 0 CHECK (grantable_bps >= 0 AND grantable_bps <= 10000);

-- 3. Full 4-table rebuild in dependency order to widen role and recipient checks
-- Snapshot 4 tables into plain backup tables. NOTE: D1's statement authorizer
-- rejects CREATE TEMP TABLE (SQLITE_AUTH), so these are regular tables cleaned up
-- at the end. DROP IF EXISTS first for rerun hygiene. CREATE TABLE AS SELECT copies
-- data only (no constraints/FKs), so the baks never interfere with the drops below.
DROP TABLE IF EXISTS _bak_0029_recovery_obligations;
DROP TABLE IF EXISTS _bak_0029_refund_allocations;
DROP TABLE IF EXISTS _bak_0029_transfer_outbox;
DROP TABLE IF EXISTS _bak_0029_order_allocations;
CREATE TABLE _bak_0029_recovery_obligations AS SELECT * FROM commerce_recovery_obligations;
CREATE TABLE _bak_0029_refund_allocations AS SELECT * FROM commerce_refund_allocations;
CREATE TABLE _bak_0029_transfer_outbox AS SELECT * FROM commerce_transfer_outbox;
CREATE TABLE _bak_0029_order_allocations AS SELECT * FROM commerce_order_allocations;

-- Drop 4 tables in dependency order (children first)
DROP TABLE commerce_recovery_obligations;
DROP TABLE commerce_refund_allocations;
DROP TABLE commerce_transfer_outbox;
DROP TABLE commerce_order_allocations;

-- Recreate 4 tables in reverse order (parent first)

-- Table 1: commerce_order_allocations (widened role + recipient nullability check)
CREATE TABLE commerce_order_allocations (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES commerce_orders(id) ON DELETE RESTRICT,
    sequence INTEGER NOT NULL CHECK (sequence >= 0),
    role TEXT NOT NULL CHECK (role IN ('maker', 'ancestor', 'protocol_pool', 'contributor')),
    recipient_user_id TEXT REFERENCES users(id),
    source_repository_id TEXT REFERENCES repositories(id),
    lineage_depth INTEGER CHECK (lineage_depth IS NULL OR lineage_depth >= 0),
    basis_points INTEGER NOT NULL CHECK (basis_points > 0 AND basis_points <= 10000),
    amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (order_id, sequence),
    CHECK (
      (role = 'protocol_pool' AND recipient_user_id IS NULL) OR
      (role IN ('maker', 'ancestor', 'contributor') AND recipient_user_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_commerce_allocations_recipient
    ON commerce_order_allocations(recipient_user_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS commerce_order_allocations_immutable_update
BEFORE UPDATE ON commerce_order_allocations
BEGIN
    SELECT RAISE(ABORT, 'commerce order allocations are immutable');
END;

CREATE TRIGGER IF NOT EXISTS commerce_order_allocations_immutable_delete
BEFORE DELETE ON commerce_order_allocations
BEGIN
    SELECT RAISE(ABORT, 'commerce order allocations are immutable');
END;

-- Table 2: commerce_transfer_outbox (byte-faithful recreation + outbox trigger with contributor)
CREATE TABLE commerce_transfer_outbox (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES commerce_orders(id) ON DELETE RESTRICT,
    allocation_id TEXT NOT NULL UNIQUE REFERENCES commerce_order_allocations(id) ON DELETE RESTRICT,
    destination_user_id TEXT REFERENCES users(id),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    currency TEXT NOT NULL CHECK (length(currency) = 3 AND currency = lower(currency)),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'retryable_failure', 'succeeded', 'terminal_failure', 'cancelled')),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    available_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    claimed_at DATETIME,
    stripe_transfer_id TEXT UNIQUE,
    last_error TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    claim_token TEXT,
    next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    lease_expires_at DATETIME,
    stripe_idempotency_key TEXT,
    destination_stripe_account TEXT,
    last_http_status INTEGER,
    last_stripe_request_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_commerce_transfer_outbox_work
    ON commerce_transfer_outbox(status, available_at);

CREATE INDEX IF NOT EXISTS idx_commerce_transfer_retry
    ON commerce_transfer_outbox(status, next_attempt_at, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_commerce_transfer_idempotency
    ON commerce_transfer_outbox(stripe_idempotency_key);

CREATE INDEX IF NOT EXISTS idx_commerce_transfer_claimable
    ON commerce_transfer_outbox(status, next_attempt_at, lease_expires_at, created_at);

CREATE TRIGGER IF NOT EXISTS commerce_outbox_requires_fulfilled_allocation
BEFORE INSERT ON commerce_transfer_outbox
WHEN NOT EXISTS (
    SELECT 1
    FROM commerce_orders o
    JOIN commerce_order_allocations a ON a.order_id = o.id
    WHERE o.id = NEW.order_id
      AND o.status = 'fulfilled'
      AND o.currency = NEW.currency
      AND a.id = NEW.allocation_id
      AND a.role IN ('maker', 'ancestor', 'contributor')
      AND a.recipient_user_id = NEW.destination_user_id
      AND a.amount_cents = NEW.amount_cents
      AND a.amount_cents > 0
)
BEGIN
    SELECT RAISE(ABORT, 'commerce outbox requires matching fulfilled allocation');
END;

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

-- Table 3: commerce_refund_allocations (byte-faithful recreation)
CREATE TABLE commerce_refund_allocations (
    id TEXT PRIMARY KEY,
    refund_id TEXT NOT NULL REFERENCES commerce_refunds(id) ON DELETE RESTRICT,
    allocation_id TEXT NOT NULL REFERENCES commerce_order_allocations(id) ON DELETE RESTRICT,
    sequence INTEGER NOT NULL CHECK (sequence >= 0),
    amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (refund_id, allocation_id),
    UNIQUE (refund_id, sequence)
);

CREATE TRIGGER IF NOT EXISTS commerce_refund_allocations_match_order
BEFORE INSERT ON commerce_refund_allocations
WHEN NOT EXISTS (
    SELECT 1
    FROM commerce_refunds r
    JOIN commerce_order_allocations a ON a.order_id = r.order_id
    WHERE r.id = NEW.refund_id
      AND r.status = 'succeeded'
      AND a.id = NEW.allocation_id
      AND a.sequence = NEW.sequence
      AND NEW.amount_cents <= a.amount_cents
)
BEGIN
    SELECT RAISE(ABORT, 'refund allocation must match a succeeded refund and frozen order allocation');
END;

CREATE TRIGGER IF NOT EXISTS commerce_refund_allocations_immutable_update
BEFORE UPDATE ON commerce_refund_allocations
BEGIN
    SELECT RAISE(ABORT, 'commerce refund allocations are immutable');
END;

CREATE TRIGGER IF NOT EXISTS commerce_refund_allocations_immutable_delete
BEFORE DELETE ON commerce_refund_allocations
BEGIN
    SELECT RAISE(ABORT, 'commerce refund allocations are immutable');
END;

-- Table 4: commerce_recovery_obligations (byte-faithful recreation + recovery trigger with contributor)
CREATE TABLE commerce_recovery_obligations (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES commerce_orders(id) ON DELETE RESTRICT,
    source_kind TEXT NOT NULL CHECK (source_kind IN ('refund', 'dispute')),
    source_id TEXT NOT NULL,
    allocation_id TEXT NOT NULL REFERENCES commerce_order_allocations(id) ON DELETE RESTRICT,
    original_outbox_id TEXT REFERENCES commerce_transfer_outbox(id) ON DELETE RESTRICT,
    source_event_id TEXT NOT NULL REFERENCES stripe_event_inbox(event_id) ON DELETE RESTRICT,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    currency TEXT NOT NULL CHECK (length(currency) = 3 AND currency = lower(currency)),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'transfer_cancelled', 'reversal_queued', 'recovered', 'unrecoverable', 'cancelled')),
    reversal_outbox_id TEXT REFERENCES commerce_reversal_outbox(id) ON DELETE RESTRICT,
    last_error TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME,
    UNIQUE (source_kind, source_id, allocation_id),
    CHECK (
      (status = 'reversal_queued' AND reversal_outbox_id IS NOT NULL) OR
      (status <> 'reversal_queued')
    )
);

CREATE INDEX IF NOT EXISTS idx_commerce_recovery_pending
    ON commerce_recovery_obligations(status, created_at);

CREATE TRIGGER IF NOT EXISTS commerce_recovery_matches_order_allocation
BEFORE INSERT ON commerce_recovery_obligations
WHEN NOT EXISTS (
    SELECT 1 FROM commerce_order_allocations a
    WHERE a.id = NEW.allocation_id
      AND a.order_id = NEW.order_id
      AND a.role IN ('maker', 'ancestor', 'contributor')
      AND NEW.amount_cents <= a.amount_cents
)
BEGIN
    SELECT RAISE(ABORT, 'recovery obligation must match a payable frozen allocation');
END;

-- Restore data from backup tables parent-first
INSERT INTO commerce_order_allocations SELECT * FROM _bak_0029_order_allocations;
INSERT INTO commerce_transfer_outbox SELECT * FROM _bak_0029_transfer_outbox;
INSERT INTO commerce_refund_allocations SELECT * FROM _bak_0029_refund_allocations;
INSERT INTO commerce_recovery_obligations SELECT * FROM _bak_0029_recovery_obligations;

-- Drop backup tables
DROP TABLE _bak_0029_order_allocations;
DROP TABLE _bak_0029_transfer_outbox;
DROP TABLE _bak_0029_refund_allocations;
DROP TABLE _bak_0029_recovery_obligations;

PRAGMA foreign_key_check;
