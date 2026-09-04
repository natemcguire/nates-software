ALTER TABLE inbox_messages ADD COLUMN message_kind TEXT NOT NULL DEFAULT 'feedback'
    CHECK (message_kind IN ('proposal', 'agent_log', 'royalty', 'feedback'));
ALTER TABLE inbox_messages ADD COLUMN merge_attempt_id TEXT REFERENCES merge_attempts(id);
ALTER TABLE inbox_messages ADD COLUMN in_reply_to_id TEXT REFERENCES inbox_messages(id);

CREATE INDEX IF NOT EXISTS idx_inbox_kind
    ON inbox_messages(user_id, message_kind, created_at);
CREATE INDEX IF NOT EXISTS idx_inbox_merge_attempt
    ON inbox_messages(merge_attempt_id);
CREATE INDEX IF NOT EXISTS idx_inbox_reply
    ON inbox_messages(in_reply_to_id);
