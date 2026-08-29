-- ============================================================================
-- NATE'S SOFTWARE 95 — PRODUCTION COLD START SCHEMA
-- Single, canonical, clean cold-start migration for Cloudflare D1
-- ============================================================================

-- 1. USERS & MAKER IDENTITIES
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    avatar_url TEXT DEFAULT '⚡',
    bio TEXT,
    password_hash TEXT,
    salt TEXT,
    role TEXT NOT NULL DEFAULT 'user', -- 'super_admin' | 'bot' | 'maker' | 'user'
    ssh_public_key TEXT,
    stripe_account_id TEXT,
    is_verified_maker BOOLEAN DEFAULT FALSE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login_at DATETIME
);

-- 2. USER AUTH SESSIONS
CREATE TABLE IF NOT EXISTS user_sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON user_sessions(expires_at);

-- 3. APP LISTINGS & HOTWIRE DROPS
CREATE TABLE IF NOT EXISTS app_listings (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    tagline TEXT NOT NULL,
    description TEXT NOT NULL,
    creator_id TEXT NOT NULL REFERENCES users(id),
    upvotes INTEGER DEFAULT 0,
    forks INTEGER DEFAULT 0,
    version TEXT NOT NULL,
    license TEXT NOT NULL DEFAULT 'MIT',
    price TEXT NOT NULL DEFAULT '$15.00',
    moddability_score INTEGER DEFAULT 95,
    merge_cleanliness TEXT DEFAULT '99.8% clean',
    storage TEXT DEFAULT 'Local-First Storage',
    screenshots TEXT NOT NULL DEFAULT '[]', -- JSON Array
    binaries TEXT NOT NULL DEFAULT '{}',    -- JSON Object
    tags TEXT NOT NULL DEFAULT '[]',        -- JSON Array
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 4. SAVED SOFTWARE / USER SHELF (OWNED APPS)
CREATE TABLE IF NOT EXISTS shelf_items (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    app_id TEXT NOT NULL REFERENCES app_listings(id) ON DELETE CASCADE,
    license_key TEXT UNIQUE NOT NULL,
    purchased_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 5. COMMUNITY COMMENTS & MAKER DISCUSSIONS
CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    app_id TEXT NOT NULL REFERENCES app_listings(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id TEXT REFERENCES comments(id),
    text TEXT NOT NULL,
    upvotes INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 6. COMMENT UPVOTES (IDEMPOTENT VOTING)
CREATE TABLE IF NOT EXISTS comment_upvotes (
    comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (comment_id, user_id)
);

-- 7. REAL-TIME IRC CHAT MESSAGES (24H Sliding Window Auto-Purge)
CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    channel TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_chat_channel_time ON chat_messages(channel, created_at);

-- 8. INBOX / NOTIFICATIONS
CREATE TABLE IF NOT EXISTS inbox_messages (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sender_id TEXT REFERENCES users(id),
    title TEXT NOT NULL,
    preview TEXT NOT NULL,
    content TEXT NOT NULL,
    feature_ref TEXT,
    cas_new_sha TEXT,
    is_merged BOOLEAN DEFAULT FALSE,
    unread BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_inbox_user ON inbox_messages(user_id, unread);

-- 9. ROYALTY LINEAGE SETTLEMENTS (70/20/10 Split Ledger)
CREATE TABLE IF NOT EXISTS royalty_settlements (
    id TEXT PRIMARY KEY,
    app_id TEXT NOT NULL REFERENCES app_listings(id),
    buyer_user_id TEXT NOT NULL REFERENCES users(id),
    gross_cents INTEGER NOT NULL,
    maker_cents INTEGER NOT NULL,
    lineage_cents INTEGER NOT NULL,
    pool_cents INTEGER NOT NULL,
    stripe_transfer_id TEXT,
    settled_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_settlements_app ON royalty_settlements(app_id);

-- 10. STRIPE MARKETPLACE PAYMENTS & TRANSFERS
CREATE TABLE IF NOT EXISTS stripe_accounts (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    stripe_account_id TEXT UNIQUE NOT NULL,
    charges_enabled BOOLEAN DEFAULT FALSE,
    payouts_enabled BOOLEAN DEFAULT FALSE,
    onboarding_status TEXT DEFAULT 'pending',
    country TEXT DEFAULT 'US',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    buyer_user_id TEXT NOT NULL REFERENCES users(id),
    app_id TEXT NOT NULL REFERENCES app_listings(id),
    gross_cents INTEGER NOT NULL,
    stripe_payment_intent_id TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'completed',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transfers_ledger (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    destination_user_id TEXT NOT NULL REFERENCES users(id),
    destination_stripe_account TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    role TEXT NOT NULL, -- 'maker' | 'ancestor' | 'platform'
    stripe_transfer_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS licenses (
    id TEXT PRIMARY KEY,
    license_key TEXT UNIQUE NOT NULL,
    app_id TEXT NOT NULL REFERENCES app_listings(id),
    owner_user_id TEXT NOT NULL REFERENCES users(id),
    order_id TEXT REFERENCES orders(id),
    status TEXT NOT NULL DEFAULT 'active',
    minted_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 11. GITSMITH DURABLE FORGE REFS & COMMITS
CREATE TABLE IF NOT EXISTS git_repositories (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    name TEXT NOT NULL,
    default_branch TEXT DEFAULT 'main',
    is_private BOOLEAN DEFAULT FALSE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS git_refs (
    repo_id TEXT NOT NULL,
    ref TEXT NOT NULL,
    sha TEXT NOT NULL,
    committer TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (repo_id, ref)
);
CREATE INDEX IF NOT EXISTS idx_git_refs_repo ON git_refs(repo_id);

CREATE TABLE IF NOT EXISTS git_commits (
    sha TEXT PRIMARY KEY,
    repo_id TEXT NOT NULL,
    parent_sha TEXT,
    tree_sha TEXT,
    author TEXT NOT NULL,
    message TEXT NOT NULL,
    signature TEXT,
    is_verified BOOLEAN DEFAULT FALSE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_git_commits_repo ON git_commits(repo_id);

-- 12. VERIFIED DYNO BENCHMARK REPORTS
CREATE TABLE IF NOT EXISTS dyno_reports (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    chip_architecture TEXT NOT NULL,
    unified_memory_gb INTEGER NOT NULL,
    tokens_per_sec REAL NOT NULL,
    prompt_cache_hit_rate REAL NOT NULL,
    needle_recall_rate REAL NOT NULL,
    verified_checksum TEXT NOT NULL,
    synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- CANONICAL COLD-START SEED DATA
-- ============================================================================

-- Seed Users
INSERT OR IGNORE INTO users (id, username, display_name, avatar_url, bio, password_hash, salt, role, ssh_public_key, is_verified_maker)
VALUES 
('usr_nate', 'nate', 'Nate McGuire', '⚡', 'Founder at East Bay Projects. Go Fork, and Multiply.', 'seeded_super_admin', 'salt_nate', 'super_admin', 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGxY84pQ4eM19287KlmQ4892187 nate@macmini', 1),
('usr_sam', 'sam', 'Sam Altman', '👨‍💻', 'Building local-first tools.', 'seeded_maker', 'salt_sam', 'maker', '', 1),
('usr_josh', 'josh', 'Josh McGuire', '⛵', 'Co-founder at East Bay Projects.', 'seeded_maker', 'salt_josh', 'maker', '', 1);

-- Seed The 3 Real Shareware Apps
INSERT OR IGNORE INTO app_listings (id, name, tagline, description, creator_id, upvotes, forks, version, license, price, moddability_score, merge_cleanliness, screenshots, binaries, tags)
VALUES
('dronehunter', 'DroneHunter 95', 'Retro Duck Hunt-Style Arcade Drone Shooter with High Scores.', 'DroneHunter 95 is a fast-paced browser arcade drone shooter featuring retro pixel art, responsive shotgun aim, laughing dog animations, and local high score tracking.', 'usr_nate', 420, 88, 'v1.0.0', 'MIT', '$15.00', 98, '99.9% clean', '["https://images.unsplash.com/photo-1508614589041-895b88991e3e?auto=format&fit=crop&w=1000&q=80"]', '{"web":"https://dronehunter.nates-software.com"}', '["Arcade", "Game", "Retro", "Duck Hunt"]'),
('certified-mailer', 'Certified Mailer', 'USPS Certified Mail, Electronic Return Receipt (ERR) & Dispute Tooling.', 'Certified Mailer generates official 20-digit USPS Certified Mail barcodes, Electronic Return Receipt (ERR) tracking, and dispute letter formatting.', 'usr_nate', 312, 46, 'v1.0.0', 'MIT', '$15.00', 96, '99.8% clean', '["https://images.unsplash.com/photo-1526304640581-d334cdbbf45e?auto=format&fit=crop&w=1000&q=80"]', '{"web":"https://certified-mailer.nates-software.com"}', '["Legal", "USPS", "Postal", "PDF"]'),
('picfitai', 'PicFit.ai', 'AI Virtual Try-On Studio & Outfit Synthesis Engine with Gemini Vision.', 'PicFit.ai generates realistic virtual try-on renders, boundary mask warping, and outfit lookbooks with high-resolution client export.', 'usr_nate', 284, 62, 'v1.0.0', 'MIT', '$15.00', 95, '99.5% clean', '["https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=1000&q=80"]', '{"web":"https://picfitai.nates-software.com"}', '["AI", "Vision", "Fashion", "Try-On"]');

-- Seed User Shelf Items
INSERT OR IGNORE INTO shelf_items (id, user_id, app_id, license_key)
VALUES
('shelf_1', 'usr_nate', 'dronehunter', 'SOV-DRONE-9812-77F2'),
('shelf_2', 'usr_nate', 'certified-mailer', 'SOV-CERTMAIL-4401-90B1'),
('shelf_3', 'usr_nate', 'picfitai', 'SOV-PICFIT-1109-34K9');

-- Seed Initial Comments
INSERT OR IGNORE INTO comments (id, app_id, user_id, text, upvotes)
VALUES
('c101', 'dronehunter', 'usr_josh', 'The retro shotgun reload sound effect is incredible! Just hit wave 12.', 24),
('c102', 'dronehunter', 'usr_nate', 'Thanks Josh! Added Web Audio synthesizers and phosphor radar sweeps in this build.', 19),
('c103', 'certified-mailer', 'usr_sam', 'The 20-digit USPS ERR barcode validator saved our landlord dispute process.', 15);

-- Seed Git Forge Default Refs
INSERT OR IGNORE INTO git_refs (repo_id, ref, sha, committer)
VALUES
('dronehunter', 'refs/heads/main', '5c030af', 'nate'),
('certified-mailer', 'refs/heads/main', '8f4a21e', 'nate'),
('picfitai', 'refs/heads/main', '3b192ea', 'nate');
