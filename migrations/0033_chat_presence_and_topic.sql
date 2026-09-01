-- Migration 0033: Real Chat Presence, Channel Topics, and Message Type Persistence
-- Invariants:
-- 1. chat_presence tracks active user heartbeats per channel with last_seen timestamp.
-- 2. chat_channels persists authoritative channel topics with topic_setter reference.
-- 3. chat_messages supports message_type ('PRIVMSG', 'ACTION', 'TOPIC', 'SYSTEM') defaulting to 'PRIVMSG'.
-- 4. D1-safe migration (plain table, no TEMP).

PRAGMA foreign_keys = ON;

-- 1. CHAT CHANNELS TABLE
CREATE TABLE IF NOT EXISTS chat_channels (
    name TEXT PRIMARY KEY,
    topic TEXT NOT NULL DEFAULT '',
    topic_setter TEXT REFERENCES users(id) ON DELETE SET NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Seed default channel topic for #lounge
INSERT OR IGNORE INTO chat_channels (name, topic, updated_at)
VALUES ('#lounge', 'Welcome to Nate''s Software Global Lounge · 12:01 AM UTC Daily Releases & Indie Modding', CURRENT_TIMESTAMP);

-- 2. CHAT PRESENCE TABLE
CREATE TABLE IF NOT EXISTS chat_presence (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel TEXT NOT NULL,
    last_seen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_chat_presence_channel_seen ON chat_presence(channel, last_seen);
CREATE INDEX IF NOT EXISTS idx_chat_presence_user ON chat_presence(user_id);

-- 3. ADD message_type COLUMN TO chat_messages
ALTER TABLE chat_messages ADD COLUMN message_type TEXT NOT NULL DEFAULT 'PRIVMSG';
