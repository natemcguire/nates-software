# Nate's Software — User Accounts, Shelf & Comments Database Architecture (Cloudflare D1 & R2)

## 1. Overview
User accounts, authentication, saved software licenses ("My Shelf"), community comments, and hardware dyno reports are stored at the edge using **Cloudflare D1** (Serverless SQLite) and **Cloudflare R2** (Zero Egress Object Storage).

---

## 2. Cloudflare D1 SQL Schema (`schema.sql`)

```sql
-- 1. USERS & MAKER IDENTITIES
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,                       -- e.g. 'usr_nate_9821'
    username TEXT UNIQUE NOT NULL,             -- e.g. 'nate'
    display_name TEXT NOT NULL,                -- e.g. 'Nate McGuire'
    avatar_url TEXT DEFAULT '⚡',
    bio TEXT,
    ssh_public_key TEXT,                       -- Used for SSH git auth on GITSMITH
    stripe_account_id TEXT,                    -- Stripe Connect for lineage royalty payouts
    is_verified_maker BOOLEAN DEFAULT FALSE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. SAVED SOFTWARE / USER SHELF (OWNED APPS)
CREATE TABLE IF NOT EXISTS shelf_items (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    app_id TEXT NOT NULL,                      -- e.g. 'retro-calc'
    license_key TEXT UNIQUE NOT NULL,          -- e.g. 'NSW-RC-9821-4401'
    purchased_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    r2_backup_sqlite_path TEXT,                -- e.g. 'backups/usr_nate/retro-calc.sqlite'
    custom_fork_git_ref TEXT                   -- e.g. 'refs/heads/nate-oled-mod'
);

-- 3. COMMUNITY COMMENTS & MAKER DISCUSSIONS
CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    app_id TEXT NOT NULL,                      -- e.g. 'retro-calc'
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id TEXT REFERENCES comments(id),    -- Threaded replies
    text TEXT NOT NULL,
    upvotes INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 4. COMMENT UPVOTES (IDEMPOTENT VOTING)
CREATE TABLE IF NOT EXISTS comment_upvotes (
    comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (comment_id, user_id)
);

-- 5. VERIFIED DYNO WORKSTATION BENCHMARK REPORTS
CREATE TABLE IF NOT EXISTS dyno_reports (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    chip_architecture TEXT NOT NULL,           -- e.g. 'Apple M4 Max'
    unified_memory_gb INTEGER NOT NULL,        -- e.g. 64
    tokens_per_sec REAL NOT NULL,              -- e.g. 167.4
    prompt_cache_hit_rate REAL NOT NULL,       -- e.g. 0.948
    needle_recall_rate REAL NOT NULL,          -- e.g. 0.992
    verified_checksum TEXT NOT NULL,           -- Cryptographic hardware proof from CLI
    synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 3. Storage Hierarchy: Cloudflare D1 vs Cloudflare R2

| Data Type | Storage Layer | Path / Location |
|---|---|---|
| **User Profiles, Bio, Settings** | **Cloudflare D1** | `users` table |
| **Saved Licenses & Shelf Registry** | **Cloudflare D1** | `shelf_items` table |
| **Comments, Replies, Upvotes** | **Cloudflare D1** | `comments` table |
| **Personal SQLite Database Backups** | **Cloudflare R2** | `r2://nates-software-backups/{user_id}/{app_id}/` |
| **Native Binaries (.dmg, .exe, .AppImage)** | **Cloudflare R2** | `r2://nates-software-binaries/{app_id}/{version}/` |
| **Uploaded Screenshots & Avatars** | **Cloudflare R2** | `r2://nates-software-media/` |
