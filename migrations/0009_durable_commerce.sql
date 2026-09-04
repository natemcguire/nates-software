PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS commerce_products (
    app_id TEXT PRIMARY KEY REFERENCES app_listings(id),
    repository_id TEXT REFERENCES repositories(id),
    seller_user_id TEXT NOT NULL REFERENCES users(id),
    price_cents INTEGER NOT NULL CHECK (price_cents > 0),
    currency TEXT NOT NULL DEFAULT 'usd'
        CHECK (length(currency) = 3 AND currency = lower(currency)),
    price_version INTEGER NOT NULL DEFAULT 1 CHECK (price_version > 0),
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'active', 'suspended', 'retired')),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_commerce_products_repository
    ON commerce_products(repository_id) WHERE repository_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_commerce_products_seller
    ON commerce_products(seller_user_id, status);

INSERT OR IGNORE INTO commerce_products
    (app_id, repository_id, seller_user_id, price_cents, currency, status)
SELECT a.id,
       (SELECT r.id
        FROM repositories r
        WHERE r.app_id = a.id AND r.owner_user_id = a.creator_id
        ORDER BY r.created_at ASC, r.id ASC
        LIMIT 1),
       a.creator_id,
       CASE a.id
         WHEN 'dronehunter' THEN 1500
         WHEN 'certified-mailer' THEN 2500
         WHEN 'picfitai' THEN 2000
       END,
       'usd', 'active'
FROM app_listings a
WHERE a.id IN ('dronehunter', 'certified-mailer', 'picfitai');

CREATE TABLE IF NOT EXISTS commerce_orders (
    id TEXT PRIMARY KEY,
    idempotency_key TEXT NOT NULL,
    buyer_user_id TEXT NOT NULL REFERENCES users(id),
    app_id TEXT NOT NULL REFERENCES app_listings(id),
    repository_id TEXT REFERENCES repositories(id),
    seller_user_id TEXT NOT NULL REFERENCES users(id),
    app_version TEXT NOT NULL,
    price_version INTEGER NOT NULL CHECK (price_version > 0),
    gross_cents INTEGER NOT NULL CHECK (gross_cents > 0),
    currency TEXT NOT NULL CHECK (length(currency) = 3 AND currency = lower(currency)),
    lineage_policy TEXT NOT NULL DEFAULT 'maker_70_lineage_20_pool_10',
    lineage_snapshot_json TEXT NOT NULL,
    stripe_payment_intent_id TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'creating'
        CHECK (status IN ('creating', 'requires_payment', 'processing', 'paid', 'fulfilling', 'fulfilled', 'payment_failed', 'cancelled', 'refunded', 'disputed')),
    failure_code TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    paid_at DATETIME,
    fulfilled_at DATETIME,
    UNIQUE (buyer_user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_commerce_orders_buyer
    ON commerce_orders(buyer_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_commerce_orders_app
    ON commerce_orders(app_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_commerce_orders_status
    ON commerce_orders(status, updated_at);

CREATE TABLE IF NOT EXISTS commerce_order_allocations (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES commerce_orders(id) ON DELETE RESTRICT,
    sequence INTEGER NOT NULL CHECK (sequence >= 0),
    role TEXT NOT NULL CHECK (role IN ('maker', 'ancestor', 'protocol_pool')),
    recipient_user_id TEXT REFERENCES users(id),
    source_repository_id TEXT REFERENCES repositories(id),
    lineage_depth INTEGER CHECK (lineage_depth IS NULL OR lineage_depth >= 0),
    basis_points INTEGER NOT NULL CHECK (basis_points > 0 AND basis_points <= 10000),
    amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (order_id, sequence),
    CHECK (
      (role = 'protocol_pool' AND recipient_user_id IS NULL) OR
      (role IN ('maker', 'ancestor') AND recipient_user_id IS NOT NULL)
    )
);
CREATE INDEX IF NOT EXISTS idx_commerce_allocations_recipient
    ON commerce_order_allocations(recipient_user_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS commerce_orders_economics_immutable
BEFORE UPDATE ON commerce_orders
WHEN OLD.idempotency_key IS NOT NEW.idempotency_key
  OR OLD.buyer_user_id IS NOT NEW.buyer_user_id
  OR OLD.app_id IS NOT NEW.app_id
  OR OLD.repository_id IS NOT NEW.repository_id
  OR OLD.seller_user_id IS NOT NEW.seller_user_id
  OR OLD.app_version IS NOT NEW.app_version
  OR OLD.price_version IS NOT NEW.price_version
  OR OLD.gross_cents IS NOT NEW.gross_cents
  OR OLD.currency IS NOT NEW.currency
  OR OLD.lineage_policy IS NOT NEW.lineage_policy
  OR OLD.lineage_snapshot_json IS NOT NEW.lineage_snapshot_json
BEGIN
    SELECT RAISE(ABORT, 'commerce order economics are immutable');
END;

CREATE TRIGGER IF NOT EXISTS commerce_orders_payment_intent_immutable
BEFORE UPDATE ON commerce_orders
WHEN OLD.stripe_payment_intent_id IS NOT NULL
 AND OLD.stripe_payment_intent_id IS NOT NEW.stripe_payment_intent_id
BEGIN
    SELECT RAISE(ABORT, 'commerce order payment intent is immutable once assigned');
END;

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

CREATE TABLE IF NOT EXISTS stripe_event_inbox (
    event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    api_version TEXT,
    livemode INTEGER NOT NULL CHECK (livemode IN (0, 1)),
    payload_json TEXT NOT NULL,
    payload_sha256 TEXT NOT NULL CHECK (length(payload_sha256) = 64),
    signature_verified INTEGER NOT NULL DEFAULT 1 CHECK (signature_verified = 1),
    status TEXT NOT NULL DEFAULT 'received'
        CHECK (status IN ('received', 'processing', 'processed', 'retryable_failure', 'terminal_failure')),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    last_error TEXT,
    received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processed_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_stripe_event_inbox_work
    ON stripe_event_inbox(status, received_at);

CREATE TABLE IF NOT EXISTS commerce_licenses (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL UNIQUE REFERENCES commerce_orders(id) ON DELETE RESTRICT,
    app_id TEXT NOT NULL REFERENCES app_listings(id),
    owner_user_id TEXT NOT NULL REFERENCES users(id),
    license_key_hash TEXT NOT NULL UNIQUE CHECK (length(license_key_hash) = 64),
    license_key_last4 TEXT NOT NULL CHECK (length(license_key_last4) = 4),
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'refunded', 'revoked')),
    issued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_commerce_licenses_owner
    ON commerce_licenses(owner_user_id, issued_at DESC);

CREATE TABLE IF NOT EXISTS commerce_transfer_outbox (
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
    completed_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_commerce_transfer_outbox_work
    ON commerce_transfer_outbox(status, available_at);

CREATE TABLE IF NOT EXISTS commerce_order_events (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES commerce_orders(id) ON DELETE RESTRICT,
    event_type TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('checkout', 'stripe_webhook', 'worker', 'admin')),
    source_event_id TEXT,
    details_json TEXT NOT NULL DEFAULT '{}',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (source, source_event_id)
);
CREATE INDEX IF NOT EXISTS idx_commerce_order_events_order
    ON commerce_order_events(order_id, created_at);
