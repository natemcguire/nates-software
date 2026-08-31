-- Migration 0029: Contributor Revenue Sharing (Schema Only, Dark)
-- Introduces contributor_shares table, grantable_bps on repositories,
-- and widens commerce_order_allocations, commerce_outbox_requires_fulfilled_allocation,
-- and commerce_recovery_matches_order_allocation to admit 'contributor' role.

PRAGMA foreign_keys = OFF;

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
    CHECK (contributor_user_id != granted_by_user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_contributor_shares_attempt
    ON contributor_shares(merge_attempt_id);

CREATE INDEX IF NOT EXISTS idx_contributor_shares_repo_status
    ON contributor_shares(repository_id, status);

CREATE INDEX IF NOT EXISTS idx_contributor_shares_contributor
    ON contributor_shares(contributor_user_id);

CREATE TRIGGER IF NOT EXISTS contributor_shares_economics_immutable
BEFORE UPDATE ON contributor_shares
WHEN OLD.repository_id IS NOT NEW.repository_id
  OR OLD.contributor_user_id IS NOT NEW.contributor_user_id
  OR OLD.granted_by_user_id IS NOT NEW.granted_by_user_id
  OR OLD.basis_points IS NOT NEW.basis_points
  OR OLD.merge_attempt_id IS NOT NEW.merge_attempt_id
BEGIN
    SELECT RAISE(ABORT, 'contributor share economics are immutable');
END;

CREATE TRIGGER IF NOT EXISTS contributor_shares_status_forward_only
BEFORE UPDATE ON contributor_shares
WHEN (OLD.status IS NOT NEW.status)
  AND NOT (OLD.status = 'pending' AND NEW.status IN ('active', 'revoked'))
BEGIN
    SELECT RAISE(ABORT, 'contributor share status transition is forward-only (pending to active or revoked)');
END;

-- 2. repositories.grantable_bps
ALTER TABLE repositories ADD COLUMN grantable_bps INTEGER NOT NULL DEFAULT 0 CHECK (grantable_bps >= 0 AND grantable_bps <= 10000);

-- 3. Rebuild commerce_order_allocations to widen role CHECK to include 'contributor'
-- and widen recipient-nullability CHECK to include 'contributor'
DROP TRIGGER IF EXISTS commerce_outbox_requires_fulfilled_allocation;
DROP TRIGGER IF EXISTS commerce_recovery_matches_order_allocation;
DROP TRIGGER IF EXISTS commerce_refund_allocations_match_order;

CREATE TABLE commerce_order_allocations_canonical (
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

INSERT INTO commerce_order_allocations_canonical (
    id,
    order_id,
    sequence,
    role,
    recipient_user_id,
    source_repository_id,
    lineage_depth,
    basis_points,
    amount_cents,
    created_at
)
SELECT
    id,
    order_id,
    sequence,
    role,
    recipient_user_id,
    source_repository_id,
    lineage_depth,
    basis_points,
    amount_cents,
    created_at
FROM commerce_order_allocations;

DROP TABLE commerce_order_allocations;
ALTER TABLE commerce_order_allocations_canonical RENAME TO commerce_order_allocations;

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

-- 4. Drop and recreate commerce_outbox_requires_fulfilled_allocation to include 'contributor'
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

-- 5. Drop and recreate commerce_recovery_matches_order_allocation to include 'contributor'
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

-- 6. Recreate commerce_refund_allocations_match_order
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

PRAGMA foreign_keys = ON;
