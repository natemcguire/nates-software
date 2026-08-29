-- Processing leases, encrypted license material, and retry metadata for the
-- durable commerce inbox/outbox state machines.

PRAGMA foreign_keys = ON;

ALTER TABLE commerce_orders
    ADD COLUMN state_version INTEGER NOT NULL DEFAULT 1 CHECK (state_version > 0);

ALTER TABLE stripe_event_inbox
    ADD COLUMN stripe_object_id TEXT;
ALTER TABLE stripe_event_inbox
    ADD COLUMN claim_token TEXT;
ALTER TABLE stripe_event_inbox
    ADD COLUMN claimed_at DATETIME;
ALTER TABLE stripe_event_inbox
    ADD COLUMN next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE stripe_event_inbox
    ADD COLUMN expires_at DATETIME;
CREATE INDEX IF NOT EXISTS idx_stripe_event_inbox_retry
    ON stripe_event_inbox(status, next_attempt_at, received_at);

ALTER TABLE commerce_transfer_outbox
    ADD COLUMN claim_token TEXT;
ALTER TABLE commerce_transfer_outbox
    ADD COLUMN next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_commerce_transfer_retry
    ON commerce_transfer_outbox(status, next_attempt_at, created_at);

-- License keys must be viewable by their owner but must not be plaintext at
-- rest. The hash on commerce_licenses supports verification; this table holds
-- AES-256-GCM material that can be rotated independently.
CREATE TABLE IF NOT EXISTS commerce_license_secrets (
    license_id TEXT PRIMARY KEY REFERENCES commerce_licenses(id) ON DELETE CASCADE,
    ciphertext_base64 TEXT NOT NULL,
    iv_base64 TEXT NOT NULL,
    algorithm TEXT NOT NULL DEFAULT 'AES-256-GCM' CHECK (algorithm = 'AES-256-GCM'),
    key_version INTEGER NOT NULL CHECK (key_version > 0),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    rotated_at DATETIME
);

CREATE TABLE IF NOT EXISTS commerce_license_secret_events (
    id TEXT PRIMARY KEY,
    license_id TEXT NOT NULL REFERENCES commerce_licenses(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN ('created', 'rotated', 'destroyed')),
    from_key_version INTEGER,
    to_key_version INTEGER,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_commerce_license_secret_events
    ON commerce_license_secret_events(license_id, created_at);
