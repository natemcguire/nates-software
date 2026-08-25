-- 7. INBOX MESSAGES & THREADS
CREATE TABLE IF NOT EXISTS inbox_messages (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category TEXT NOT NULL, -- 'proposals' | 'agent_logs' | 'royalties' | 'feedback'
    from_user TEXT NOT NULL,
    from_avatar TEXT NOT NULL DEFAULT '⚡',
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    unread BOOLEAN DEFAULT TRUE,
    feature_ref TEXT DEFAULT 'n/a',
    cas_old_sha TEXT,
    cas_new_sha TEXT,
    tests_passed INTEGER DEFAULT 0,
    is_merged BOOLEAN DEFAULT FALSE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 8. ROYALTY SETTLEMENTS & LINEAGE AUDIT
CREATE TABLE IF NOT EXISTS royalty_settlements (
    id TEXT PRIMARY KEY,
    app_id TEXT NOT NULL REFERENCES app_listings(id) ON DELETE CASCADE,
    buyer_user_id TEXT REFERENCES users(id),
    gross_cents INTEGER NOT NULL,
    maker_cents INTEGER NOT NULL,
    lineage_cents INTEGER NOT NULL,
    pool_cents INTEGER NOT NULL,
    stripe_transfer_id TEXT,
    settled_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- SEED INBOX MESSAGES
INSERT OR IGNORE INTO inbox_messages (id, user_id, category, from_user, from_avatar, subject, body, unread, feature_ref, cas_old_sha, cas_new_sha, tests_passed, is_merged)
VALUES
('msg-01', 'usr_nate', 'proposals', 'Sam Altman (@sam)', '👨‍💻', 'PR #14: Spliced OCR Receipt Scanner into RetroCalc', 'Hey Nate, I completed the optical character recognition feature on refs/features/receipt-ocr/v1.2.0. Parsed 22 AST nodes and applied 004_receipts.sql. All 4 automated test assertions passed in 0.04s.', 1, 'refs/features/receipt-ocr/v1.2.0', '5c030af', '4e10bc9', 4, 0),
('msg-02', 'usr_nate', 'royalties', 'Lineage Protocol (@gitsmith)', '💎', 'Royalty Settled: +$920.00 from WallArt Canvas Pro Forks', 'Daily 12:01 AM batch royalty settlement complete. 112 downstream forks active across 48 registered users. $920.00 transferred directly to your connected Stripe account.', 0, 'n/a', NULL, NULL, 0, 1),
('msg-03', 'usr_nate', 'agent_logs', 'Claude 3.7 Agent (@mechanic)', '🤖', 'Refactor Report: 300 DPI TIFF Export Pipeline Optimized', 'Autonomous task completed for nate/wallart. Reduced memory footprint from 68MB to 48MB during multi-panel triptych rendering. SQLite WAL checkpointed cleanly.', 0, 'refs/features/wallart-triptych/v2.4.0', '1109a2b', '8f4a21e', 6, 1),
('msg-04', 'usr_nate', 'proposals', 'Josh McGuire (@josh)', '⛵', 'PR #09: NMEA Polar Chart Telemetry Lock for SailTrack', 'Added live polar performance curves against true wind angle. Zero database locks on telemetry.sqlite.', 0, 'refs/features/nmea-polar/v2.1.0', '9812f0a', '3341b8c', 8, 0);

-- SEED ROYALTY SETTLEMENT
INSERT OR IGNORE INTO royalty_settlements (id, app_id, buyer_user_id, gross_cents, maker_cents, lineage_cents, pool_cents, stripe_transfer_id)
VALUES
('set_01', 'wallart', 'usr_sam', 2500, 1750, 500, 250, 'tr_1Nz89a4120');
