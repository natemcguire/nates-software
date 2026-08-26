-- ============================================================================
-- 0005_stripe_payments_and_indexes.sql
-- Stripe Marketplace Payments, License Minting, Chat Messages & Performance Indexes
-- ============================================================================

-- 1. Stripe Connected Accounts
CREATE TABLE IF NOT EXISTS stripe_accounts (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    stripe_account_id TEXT UNIQUE NOT NULL,
    charges_enabled BOOLEAN DEFAULT FALSE,
    payouts_enabled BOOLEAN DEFAULT FALSE,
    details_submitted BOOLEAN DEFAULT FALSE,
    country TEXT DEFAULT 'US',
    currency TEXT DEFAULT 'usd',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Marketplace Orders & Purchases
CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    buyer_user_id TEXT REFERENCES users(id),
    app_id TEXT NOT NULL REFERENCES app_listings(id),
    payment_intent_id TEXT UNIQUE NOT NULL,
    transfer_group TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'usd',
    status TEXT NOT NULL, -- 'pending' | 'succeeded' | 'failed' | 'refunded'
    customer_email TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(buyer_user_id);
CREATE INDEX IF NOT EXISTS idx_orders_app ON orders(app_id);
CREATE INDEX IF NOT EXISTS idx_orders_transfer_group ON orders(transfer_group);

-- 3. Lineage Transfers Ledger
CREATE TABLE IF NOT EXISTS transfers_ledger (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    transfer_group TEXT NOT NULL,
    recipient_user_id TEXT NOT NULL REFERENCES users(id),
    stripe_transfer_id TEXT UNIQUE,
    amount_cents INTEGER NOT NULL,
    role TEXT NOT NULL, -- 'maker' | 'ancestor' | 'platform'
    status TEXT NOT NULL, -- 'pending' | 'succeeded' | 'failed'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_transfers_order ON transfers_ledger(order_id);
CREATE INDEX IF NOT EXISTS idx_transfers_recipient ON transfers_ledger(recipient_user_id);

-- 4. Minted Cryptographic Licenses
CREATE TABLE IF NOT EXISTS licenses (
    id TEXT PRIMARY KEY,
    license_key TEXT UNIQUE NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    app_id TEXT NOT NULL REFERENCES app_listings(id),
    order_id TEXT REFERENCES orders(id),
    version TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active', -- 'active' | 'revoked'
    minted_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_licenses_user ON licenses(user_id);
CREATE INDEX IF NOT EXISTS idx_licenses_app ON licenses(app_id);

-- 5. Chat Messages (Formalized Schema with TTL Index)
CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    channel TEXT NOT NULL,
    sender TEXT NOT NULL,
    avatar TEXT,
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_channel_created ON chat_messages(channel, created_at);

-- 6. Upvotes Table (Formalized Schema)
CREATE TABLE IF NOT EXISTS drop_upvotes (
    app_id TEXT NOT NULL REFERENCES app_listings(id) ON DELETE CASCADE,
    ip_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (app_id, ip_hash)
);

-- 7. High-Performance Composite Indexes
CREATE INDEX IF NOT EXISTS idx_apps_creator ON app_listings(creator_id);
CREATE INDEX IF NOT EXISTS idx_comments_app_created ON comments(app_id, created_at);
CREATE INDEX IF NOT EXISTS idx_inbox_user_unread ON inbox_messages(user_id, unread, created_at);
CREATE INDEX IF NOT EXISTS idx_settlements_app_settled ON royalty_settlements(app_id, settled_at);
