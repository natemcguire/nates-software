-- 6. GITSMITH REAL GIT FORGE REFS & REPOSITORIES
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

CREATE INDEX IF NOT EXISTS idx_git_refs_repo ON git_refs(repo_id);
CREATE INDEX IF NOT EXISTS idx_git_commits_repo ON git_commits(repo_id);
