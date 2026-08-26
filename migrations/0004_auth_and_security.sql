-- ============================================================================
-- 0004_auth_and_security.sql
-- Real User Authentication, Cryptographic Password Hashing & Role-Based Access
-- ============================================================================

-- Alter users table or ensure all auth columns exist
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    avatar_url TEXT DEFAULT '👤',
    bio TEXT,
    password_hash TEXT,
    salt TEXT,
    role TEXT NOT NULL DEFAULT 'user', -- 'super_admin' | 'bot' | 'maker' | 'user'
    ssh_public_key TEXT,
    is_verified_maker BOOLEAN DEFAULT FALSE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login_at DATETIME
);

-- Sessions table
CREATE TABLE IF NOT EXISTS user_sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON user_sessions(expires_at);

-- Delete any stale placeholder users
DELETE FROM users WHERE username NOT IN ('nate', 'sam');

-- Seed Super Admin (Nate) & Bot Account (Sam)
INSERT OR REPLACE INTO users (id, username, display_name, avatar_url, bio, password_hash, salt, role, ssh_public_key, is_verified_maker)
VALUES 
('usr_nate', 'nate', 'Nate McGuire', '⚡', 'Founder at East Bay Projects. Building shareware for local-first users.', 'seeded_super_admin', 'salt_nate', 'super_admin', 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGxY8... nate@macmini', 1),
('usr_sam', 'sam', 'Sam (Bot)', '🤖', 'AI Copilot & Pairing Assistant for Nate\'s Software.', 'seeded_bot', 'salt_sam', 'bot', 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAISamBotKey sam@ai.nates-software.com', 1);
