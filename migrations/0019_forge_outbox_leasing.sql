-- Migration 0017: Forge Outbox Leasing and Dispatcher Metadata
-- Adds finite conditional lease tracking, dead-letter timestamps, and claim indexes for forge_outbox_events.

ALTER TABLE forge_outbox_events ADD COLUMN claim_token TEXT;
ALTER TABLE forge_outbox_events ADD COLUMN lease_expires_at DATETIME;
ALTER TABLE forge_outbox_events ADD COLUMN dead_lettered_at DATETIME;
CREATE INDEX IF NOT EXISTS idx_forge_outbox_claim ON forge_outbox_events(claim_token, lease_expires_at);
CREATE INDEX IF NOT EXISTS idx_forge_outbox_dead ON forge_outbox_events(dead_lettered_at);
