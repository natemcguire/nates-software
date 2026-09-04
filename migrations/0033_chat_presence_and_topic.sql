PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS chat_channels (
    name TEXT PRIMARY KEY,
    topic TEXT NOT NULL DEFAULT '',
    topic_setter TEXT REFERENCES users(id) ON DELETE SET NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO chat_channels (name, topic, updated_at)
VALUES ('#lounge', 'Welcome to Nate''s Software Global Lounge · 12:01 AM UTC Daily Releases & Indie Modding', CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS chat_presence (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel TEXT NOT NULL,
    last_seen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_chat_presence_channel_seen ON chat_presence(channel, last_seen);
CREATE INDEX IF NOT EXISTS idx_chat_presence_user ON chat_presence(user_id);

ALTER TABLE chat_messages ADD COLUMN message_type TEXT NOT NULL DEFAULT 'PRIVMSG';
