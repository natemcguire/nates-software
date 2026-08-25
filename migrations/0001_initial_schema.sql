-- 1. USERS & MAKER IDENTITIES
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    avatar_url TEXT DEFAULT '⚡',
    bio TEXT,
    ssh_public_key TEXT,
    stripe_account_id TEXT,
    is_verified_maker BOOLEAN DEFAULT FALSE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. APP LISTINGS & DROPS
CREATE TABLE IF NOT EXISTS app_listings (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    tagline TEXT NOT NULL,
    description TEXT NOT NULL,
    creator_id TEXT NOT NULL REFERENCES users(id),
    upvotes INTEGER DEFAULT 0,
    forks INTEGER DEFAULT 0,
    version TEXT NOT NULL,
    license TEXT NOT NULL,
    price TEXT NOT NULL,
    moddability_score INTEGER DEFAULT 95,
    merge_cleanliness TEXT DEFAULT '99.8% clean',
    storage TEXT DEFAULT 'Single-file SQLite WAL (/data/app.sqlite)',
    screenshots TEXT NOT NULL, -- JSON Array
    binaries TEXT NOT NULL,    -- JSON Object
    tags TEXT NOT NULL,        -- JSON Array
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. SAVED SOFTWARE / USER SHELF (OWNED APPS)
CREATE TABLE IF NOT EXISTS shelf_items (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    app_id TEXT NOT NULL REFERENCES app_listings(id) ON DELETE CASCADE,
    license_key TEXT UNIQUE NOT NULL,
    r2_backup_sqlite_path TEXT,
    purchased_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 4. COMMUNITY COMMENTS & MAKER DISCUSSIONS
CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    app_id TEXT NOT NULL REFERENCES app_listings(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id TEXT REFERENCES comments(id),
    text TEXT NOT NULL,
    upvotes INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 5. COMMENT UPVOTES (IDEMPOTENT VOTING)
CREATE TABLE IF NOT EXISTS comment_upvotes (
    comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (comment_id, user_id)
);

-- 6. VERIFIED DYNO BENCHMARK REPORTS
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

-- SEED DATA
INSERT OR IGNORE INTO users (id, username, display_name, avatar_url, bio, ssh_public_key, is_verified_maker)
VALUES 
('usr_nate', 'nate', 'Nate McGuire', '⚡', 'Founder at East Bay Projects. Building shareware for sovereign users.', 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGxY8... nate@macmini', 1),
('usr_sam', 'sam', 'Sam Altman', '👨‍💻', 'Building local-first tools.', '', 1),
('usr_josh', 'josh', 'Josh McGuire', '⛵', 'Co-founder at East Bay Projects.', '', 1);

INSERT OR IGNORE INTO app_listings (id, name, tagline, description, creator_id, upvotes, forks, version, license, price, moddability_score, merge_cleanliness, storage, screenshots, binaries, tags)
VALUES
('wallart', 'WallArt Canvas Pro', 'AI photo-to-canvas rendering engine, multi-panel gallery wall previewer, and custom print layout studio.', 'WallArt Canvas Pro transforms high-resolution family photography into gallery-grade physical wall displays.', 'usr_nate', 384, 112, 'v2.4.0', 'MIT', '$25 Registered Copy (or Free Self-Host)', 96, '99.8% clean', 'Single-file SQLite WAL (/data/wallart.sqlite)', '["https://images.unsplash.com/photo-1513519245088-0e12902e5a38?auto=format&fit=crop&w=1000&q=80"]', '{"mac":"WallArt-2.4.0-Universal.dmg (24.8MB)","win":"WallArt-Setup-2.4.0.exe (28.2MB)","linux":"WallArt-2.4.0.AppImage (26.1MB)","ios":"Apple TestFlight Public Beta Link"}', '["Photo Studio", "Canvas Prints", "Gallery Wall", "Next.js 16", "SQLite WAL"]'),
('retro-calc', 'RetroCalc Pro', 'Local-first accounting calculator with SQLite persistence, compound interest tables, and receipt scanning.', 'RetroCalc Pro is an unbundled, local-first financial calculator built with retro aesthetics and modern precision.', 'usr_sam', 248, 84, 'v1.2.0', 'MIT', 'Free ($0) or $15 Registered', 94, '99.4% clean', 'Single-file SQLite WAL (/data/app.sqlite)', '["https://images.unsplash.com/photo-1554224155-6726b3ff858f?auto=format&fit=crop&w=800&q=80"]', '{"mac":"RetroCalc-1.2.0.dmg (14.2MB)","win":"RetroCalc-Setup-1.2.0.exe (18.4MB)","linux":"RetroCalc-1.2.0.AppImage (16.1MB)","ios":"Apple TestFlight Public Beta Link"}', '["Finance", "SQLite", "Local-First", "React 19"]'),
('sailtrack', 'SailTrack GPS', 'Offline marine navigation, polar chart calculator, and race telemetry logger.', 'Built for competitive keelboat racing and coastal cruising.', 'usr_nate', 192, 46, 'v2.1.0', 'Apache-2.0', '$20 Registered Copy', 91, '98.8% clean', 'Single-file SQLite WAL (/data/telemetry.sqlite)', '["https://images.unsplash.com/photo-1500930287596-c1ecaa373bb2?auto=format&fit=crop&w=800&q=80"]', '{"mac":"SailTrack-2.1.0.dmg (18.0MB)","win":"SailTrack-Setup.exe (22.1MB)","linux":"SailTrack.AppImage (19.4MB)","ios":"TestFlight Link Active"}', '["Marine", "GPS", "Mapping", "Offline"]');

INSERT OR IGNORE INTO shelf_items (id, user_id, app_id, license_key)
VALUES
('shelf_1', 'usr_nate', 'wallart', 'NSW-WA-9821-0001'),
('shelf_2', 'usr_nate', 'retro-calc', 'NSW-RC-9821-4401'),
('shelf_3', 'usr_nate', 'sailtrack', 'NSW-ST-1109-8832');

INSERT OR IGNORE INTO comments (id, app_id, user_id, text, upvotes)
VALUES
('c101', 'wallart', 'usr_josh', 'The floating walnut wood frame rendering in this build is insane. Just queued up a 3-piece triptych for our living room wall. Exported the 300 DPI print-ready TIFF cleanly!', 24),
('c102', 'wallart', 'usr_nate', 'Thanks Josh! In the next drop I am adding local GPU background segmentation so you can preview custom matting against actual photos of your room wall.', 19);
