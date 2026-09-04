PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS drop_upvotes (
    app_id TEXT NOT NULL,
    voter_hash TEXT NOT NULL,
    voted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (app_id, voter_hash)
);

CREATE TABLE drop_upvotes_canonical (
    app_id TEXT NOT NULL REFERENCES app_listings(id) ON DELETE CASCADE,
    voter_hash TEXT NOT NULL,
    voted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (app_id, voter_hash)
);

INSERT OR IGNORE INTO drop_upvotes_canonical (app_id, voter_hash, voted_at)
SELECT v.app_id, v.voter_hash, v.voted_at
FROM drop_upvotes v
JOIN app_listings a ON a.id = v.app_id;

DROP TABLE drop_upvotes;
ALTER TABLE drop_upvotes_canonical RENAME TO drop_upvotes;

CREATE INDEX idx_drop_upvotes_voter ON drop_upvotes(voter_hash);
