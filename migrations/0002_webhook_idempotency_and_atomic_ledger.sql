-- Durable Webhook Event Deduplication & Atomic Payment Settlement Ledger
CREATE TABLE IF NOT EXISTS processed_webhook_events (
    event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Unique constraints to prevent duplicate licenses or duplicate shelf items
CREATE UNIQUE INDEX IF NOT EXISTS idx_licenses_order ON licenses(order_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_shelf_user_app ON shelf_items(user_id, app_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transfers_order_type ON transfers_ledger(order_id, transfer_type);
