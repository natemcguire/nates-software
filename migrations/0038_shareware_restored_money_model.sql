-- Migration 0038: Shareware, Restored — money model schema
--
-- Adds the schema support for the additive frozen-lien allocation model
-- (see src/lib/commerceDomain.ts::calculateAllocations, Task A1/A2):
--   1. commerce_products.royalty_bps — the maker-chosen per-listing royalty
--      rate, frozen onto the fork edge at fork-confirm time.
--   2. repository_fork_liens — the frozen lien snapshot captured once at
--      fork-confirm time. Buy-time settlement reads this table directly
--      instead of walking ancestry generation-by-generation.
--   3. commerce_order_allocations — role CHECK widened to admit the new
--      'platform' (house, non-payable) and 'seller' (payable) roles emitted
--      by the rewritten calculator, basis_points made nullable (platform and
--      seller rows carry no basis_points — the seller's cut is a floored
--      remainder, not a fixed bps rate), and the recipient-nullability CHECK
--      updated to match.
--   4. The two payable-role triggers (commerce_outbox_requires_fulfilled_allocation,
--      commerce_recovery_matches_order_allocation) updated so 'seller' is
--      payable (like 'maker' was) and 'platform' is excluded from payout
--      (like 'protocol_pool' was) — the house is never paid out via Connect.
--
-- There are zero users and zero production rows on this project as of this
-- migration (pre-launch), so commerce_order_allocations and its dependent
-- tables (commerce_transfer_outbox, commerce_refund_allocations,
-- commerce_recovery_obligations) are dropped and recreated directly with the
-- new schema — no data-preserving backup/restore is needed. This mirrors
-- 0029's table bodies exactly except for the role/CHECK changes called out
-- above; commerce_transfer_economics_immutable and
-- commerce_reversal_cumulative_guard reference no role list and are
-- untouched (recreated byte-faithful).

PRAGMA defer_foreign_keys = true;

-- 1. commerce_products.royalty_bps — maker-chosen royalty rate for this listing.
ALTER TABLE commerce_products
    ADD COLUMN royalty_bps INTEGER NOT NULL DEFAULT 0 CHECK (royalty_bps >= 0 AND royalty_bps <= 10000);

-- 2. repository_fork_liens — frozen lien snapshot, captured once at fork-confirm
--    time (Task B2) and never mutated. A descendant can never alter or drop an
--    inherited lien. Column names match src/lib/commerceDomain.ts::fetchFrozenLiens.
CREATE TABLE repository_fork_liens (
  id TEXT PRIMARY KEY,
  holder_of_repository_id TEXT NOT NULL REFERENCES repositories(id),  -- the descendant whose sales owe this lien
  ancestor_repository_id TEXT NOT NULL REFERENCES repositories(id),
  ancestor_user_id TEXT NOT NULL REFERENCES users(id),
  bps INTEGER NOT NULL CHECK (bps > 0 AND bps <= 10000),  -- 0% liens are simply not written
  depth INTEGER NOT NULL CHECK (depth > 0),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (holder_of_repository_id, ancestor_repository_id)
);

CREATE INDEX idx_fork_liens_holder ON repository_fork_liens(holder_of_repository_id, depth);

CREATE TRIGGER repository_fork_liens_immutable_update BEFORE UPDATE ON repository_fork_liens
  BEGIN SELECT RAISE(ABORT, 'fork liens are immutable'); END;
CREATE TRIGGER repository_fork_liens_immutable_delete BEFORE DELETE ON repository_fork_liens
  BEGIN SELECT RAISE(ABORT, 'fork liens are immutable'); END;

-- 3. Rebuild commerce_order_allocations + its 3 dependent tables in dependency
--    order to widen the role/basis_points/recipient-nullability CHECKs and the
--    two payable-role triggers. No data backup/restore: zero production rows
--    exist on this project pre-launch.

-- Drop in dependency order (children first).
DROP TABLE commerce_recovery_obligations;
DROP TABLE commerce_refund_allocations;
DROP TABLE commerce_transfer_outbox;
DROP TABLE commerce_order_allocations;

-- Recreate in reverse order (parent first).

-- Table 1: commerce_order_allocations — widened role CHECK ('platform','seller'
-- added), basis_points now nullable (platform/seller rows carry no fixed bps
-- rate), recipient-nullability CHECK updated for the new roles.
CREATE TABLE commerce_order_allocations (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES commerce_orders(id) ON DELETE RESTRICT,
    sequence INTEGER NOT NULL CHECK (sequence >= 0),
    role TEXT NOT NULL CHECK (role IN ('maker', 'ancestor', 'protocol_pool', 'contributor', 'platform', 'seller')),
    recipient_user_id TEXT REFERENCES users(id),
    source_repository_id TEXT REFERENCES repositories(id),
    lineage_depth INTEGER CHECK (lineage_depth IS NULL OR lineage_depth >= 0),
    basis_points INTEGER CHECK (basis_points IS NULL OR (basis_points > 0 AND basis_points <= 10000)),
    amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (order_id, sequence),
    CHECK (
      (role IN ('platform', 'protocol_pool') AND recipient_user_id IS NULL) OR
      (role IN ('maker', 'ancestor', 'contributor', 'seller') AND recipient_user_id IS NOT NULL)
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

-- Table 2: commerce_transfer_outbox (byte-faithful recreation of the 0029 body;
-- only the outbox-requires-fulfilled-allocation trigger's role list changes:
-- 'seller' is payable, 'platform' is excluded — the house is never paid via Connect).
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

-- CHANGED (Task B1): payable role list adds 'seller', drops nothing that was
-- payable before ('platform' was never in this list under its old name).
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
      AND a.role IN ('maker', 'ancestor', 'contributor', 'seller')
      AND a.recipient_user_id = NEW.destination_user_id
      AND a.amount_cents = NEW.amount_cents
      AND a.amount_cents > 0
)
BEGIN
    SELECT RAISE(ABORT, 'commerce outbox requires matching fulfilled allocation');
END;

-- UNCHANGED: no role reference, recreated byte-faithful.
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

-- Table 3: commerce_refund_allocations (byte-faithful recreation; no role reference).
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

-- Table 4: commerce_recovery_obligations (byte-faithful recreation of the 0029
-- body; only the recovery-matches-order-allocation trigger's role list changes).
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

-- CHANGED (Task B1): payable role list adds 'seller' (mirrors the outbox trigger).
CREATE TRIGGER IF NOT EXISTS commerce_recovery_matches_order_allocation
BEFORE INSERT ON commerce_recovery_obligations
WHEN NOT EXISTS (
    SELECT 1 FROM commerce_order_allocations a
    WHERE a.id = NEW.allocation_id
      AND a.order_id = NEW.order_id
      AND a.role IN ('maker', 'ancestor', 'contributor', 'seller')
      AND NEW.amount_cents <= a.amount_cents
)
BEGIN
    SELECT RAISE(ABORT, 'recovery obligation must match a payable frozen allocation');
END;

-- commerce_reversal_cumulative_guard (on commerce_reversal_outbox, defined in
-- 0012) references no role list and is unaffected by this migration.

PRAGMA foreign_key_check;
