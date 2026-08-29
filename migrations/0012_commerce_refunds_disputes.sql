-- Authoritative refund/dispute observations and immutable recovery obligations.
-- Original orders, allocations, and transfer amounts remain historical facts;
-- every clawback is represented as a compensating record.

PRAGMA foreign_keys = ON;

ALTER TABLE commerce_orders
    ADD COLUMN refunded_cents INTEGER NOT NULL DEFAULT 0
        CHECK (refunded_cents >= 0 AND refunded_cents <= gross_cents);

CREATE TABLE IF NOT EXISTS commerce_refunds (
    id TEXT PRIMARY KEY,
    stripe_refund_id TEXT NOT NULL UNIQUE,
    order_id TEXT NOT NULL REFERENCES commerce_orders(id) ON DELETE RESTRICT,
    stripe_charge_id TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    currency TEXT NOT NULL CHECK (length(currency) = 3 AND currency = lower(currency)),
    status TEXT NOT NULL CHECK (status IN ('pending', 'requires_action', 'succeeded', 'failed', 'cancelled')),
    reason TEXT,
    failure_reason TEXT,
    authoritative_json TEXT NOT NULL,
    first_event_id TEXT NOT NULL REFERENCES stripe_event_inbox(event_id) ON DELETE RESTRICT,
    last_event_id TEXT NOT NULL REFERENCES stripe_event_inbox(event_id) ON DELETE RESTRICT,
    finalized_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_commerce_refunds_order
    ON commerce_refunds(order_id, status, created_at);

CREATE TABLE IF NOT EXISTS commerce_disputes (
    id TEXT PRIMARY KEY,
    stripe_dispute_id TEXT NOT NULL UNIQUE,
    order_id TEXT NOT NULL REFERENCES commerce_orders(id) ON DELETE RESTRICT,
    stripe_charge_id TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    currency TEXT NOT NULL CHECK (length(currency) = 3 AND currency = lower(currency)),
    status TEXT NOT NULL CHECK (status IN (
        'warning_needs_response', 'warning_under_review', 'warning_closed',
        'needs_response', 'under_review', 'won', 'lost'
    )),
    reason TEXT,
    evidence_due_at DATETIME,
    authoritative_json TEXT NOT NULL,
    first_event_id TEXT NOT NULL REFERENCES stripe_event_inbox(event_id) ON DELETE RESTRICT,
    last_event_id TEXT NOT NULL REFERENCES stripe_event_inbox(event_id) ON DELETE RESTRICT,
    opened_at DATETIME NOT NULL,
    closed_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_commerce_disputes_order
    ON commerce_disputes(order_id, status, created_at);

-- Every webhook delivery remains evidence even when it observes an object state
-- already seen through an earlier, out-of-order delivery.
CREATE TABLE IF NOT EXISTS commerce_refund_observations (
    event_id TEXT PRIMARY KEY REFERENCES stripe_event_inbox(event_id) ON DELETE RESTRICT,
    refund_id TEXT NOT NULL REFERENCES commerce_refunds(id) ON DELETE RESTRICT,
    observed_status TEXT NOT NULL,
    authoritative_sha256 TEXT NOT NULL CHECK (length(authoritative_sha256) = 64),
    observed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS commerce_dispute_observations (
    event_id TEXT PRIMARY KEY REFERENCES stripe_event_inbox(event_id) ON DELETE RESTRICT,
    dispute_id TEXT NOT NULL REFERENCES commerce_disputes(id) ON DELETE RESTRICT,
    observed_status TEXT NOT NULL,
    authoritative_sha256 TEXT NOT NULL CHECK (length(authoritative_sha256) = 64),
    observed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- A succeeded refund is split across the frozen purchase allocations. These
-- rows include the protocol share so their sum must equal the customer refund.
CREATE TABLE IF NOT EXISTS commerce_refund_allocations (
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

-- Recovery obligations bridge accounting and money movement. They are created
-- for maker/ancestor refund allocations or a lost dispute. Resolution is
-- monotonic: wait for an in-flight transfer, cancel an exact unsent transfer,
-- or enqueue a Stripe reversal after the original transfer succeeds.
CREATE TABLE IF NOT EXISTS commerce_recovery_obligations (
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
      AND a.role IN ('maker', 'ancestor')
      AND NEW.amount_cents <= a.amount_cents
)
BEGIN
    SELECT RAISE(ABORT, 'recovery obligation must match a payable frozen allocation');
END;

CREATE TRIGGER IF NOT EXISTS commerce_reversal_cumulative_guard
BEFORE INSERT ON commerce_reversal_outbox
WHEN (
    SELECT COALESCE(SUM(r.amount_cents), 0)
    FROM commerce_reversal_outbox r
    WHERE r.original_outbox_id = NEW.original_outbox_id
      AND r.status <> 'cancelled'
) + NEW.amount_cents > (
    SELECT t.amount_cents
    FROM commerce_transfer_outbox t
    WHERE t.id = NEW.original_outbox_id
)
BEGIN
    SELECT RAISE(ABORT, 'cumulative reversals exceed the original transfer');
END;

CREATE TRIGGER IF NOT EXISTS commerce_refunds_succeeded_immutable
BEFORE UPDATE ON commerce_refunds
WHEN OLD.status = 'succeeded' AND (
    OLD.order_id IS NOT NEW.order_id OR
    OLD.stripe_charge_id IS NOT NEW.stripe_charge_id OR
    OLD.amount_cents IS NOT NEW.amount_cents OR
    OLD.currency IS NOT NEW.currency
)
BEGIN
    SELECT RAISE(ABORT, 'succeeded refund economics are immutable');
END;
