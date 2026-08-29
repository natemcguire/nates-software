-- Turn lost order-state CAS operations into atomic refund batch failures.

PRAGMA foreign_keys = ON;

CREATE TRIGGER IF NOT EXISTS commerce_refund_finalization_guard
BEFORE UPDATE OF finalized_at ON commerce_refunds
WHEN OLD.finalized_at IS NULL AND NEW.finalized_at IS NOT NULL AND (
    NEW.status <> 'succeeded'
    OR (SELECT COALESCE(SUM(ra.amount_cents), 0)
        FROM commerce_refund_allocations ra
        WHERE ra.refund_id = NEW.id) <> NEW.amount_cents
    OR NOT EXISTS (
        SELECT 1 FROM commerce_orders o
        WHERE o.id = NEW.order_id
          AND o.refunded_cents = NEW.amount_cents + COALESCE((
              SELECT SUM(r2.amount_cents)
              FROM commerce_refunds r2
              WHERE r2.order_id = NEW.order_id
                AND r2.id <> NEW.id
                AND r2.finalized_at IS NOT NULL
          ), 0)
          AND o.refunded_cents <= o.gross_cents
          AND o.status IN ('fulfilled', 'refunded', 'disputed')
    )
)
BEGIN
    SELECT RAISE(ABORT, 'refund finalization requires conserved allocations and persisted order projection');
END;

CREATE TRIGGER IF NOT EXISTS commerce_refund_finalized_immutable
BEFORE UPDATE ON commerce_refunds
WHEN OLD.finalized_at IS NOT NULL AND (
    OLD.id IS NOT NEW.id
    OR OLD.stripe_refund_id IS NOT NEW.stripe_refund_id
    OR OLD.order_id IS NOT NEW.order_id
    OR OLD.stripe_charge_id IS NOT NEW.stripe_charge_id
    OR OLD.amount_cents IS NOT NEW.amount_cents
    OR OLD.currency IS NOT NEW.currency
    OR OLD.status IS NOT NEW.status
    OR OLD.finalized_at IS NOT NEW.finalized_at
)
BEGIN
    SELECT RAISE(ABORT, 'finalized refund is immutable');
END;
