PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS repositories (
    id TEXT PRIMARY KEY,
    app_id TEXT REFERENCES app_listings(id) ON DELETE SET NULL,
    owner_user_id TEXT NOT NULL REFERENCES users(id),
    slug TEXT NOT NULL,
    visibility TEXT NOT NULL DEFAULT 'public'
        CHECK (visibility IN ('public', 'unlisted', 'private')),
    object_format TEXT NOT NULL DEFAULT 'sha1'
        CHECK (object_format IN ('sha1', 'sha256')),
    default_ref TEXT NOT NULL DEFAULT 'refs/heads/main',
    storage_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('provisioning', 'active', 'archived', 'quarantined')),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (owner_user_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_repositories_app ON repositories(app_id);
CREATE INDEX IF NOT EXISTS idx_repositories_owner ON repositories(owner_user_id, status);

CREATE TABLE IF NOT EXISTS repository_members (
    repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('reader', 'triager', 'writer', 'maintainer', 'owner')),
    granted_by_user_id TEXT NOT NULL REFERENCES users(id),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (repository_id, user_id)
);

CREATE TABLE IF NOT EXISTS repository_ref_policies (
    repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    ref_pattern TEXT NOT NULL,
    require_signed_commits INTEGER NOT NULL DEFAULT 0 CHECK (require_signed_commits IN (0, 1)),
    require_passing_build INTEGER NOT NULL DEFAULT 0 CHECK (require_passing_build IN (0, 1)),
    minimum_approvals INTEGER NOT NULL DEFAULT 0 CHECK (minimum_approvals >= 0),
    allow_force_push INTEGER NOT NULL DEFAULT 0 CHECK (allow_force_push IN (0, 1)),
    allow_delete INTEGER NOT NULL DEFAULT 0 CHECK (allow_delete IN (0, 1)),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (repository_id, ref_pattern)
);

CREATE TABLE IF NOT EXISTS repository_refs (
    repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    ref_name TEXT NOT NULL,
    commit_oid TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    updated_by_user_id TEXT REFERENCES users(id),
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (repository_id, ref_name)
);
CREATE INDEX IF NOT EXISTS idx_repository_refs_oid ON repository_refs(repository_id, commit_oid);

CREATE TABLE IF NOT EXISTS repository_ref_events (
    id TEXT PRIMARY KEY,
    repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    ref_name TEXT NOT NULL,
    old_oid TEXT,
    new_oid TEXT,
    expected_old_oid TEXT,
    operation TEXT NOT NULL CHECK (operation IN ('create', 'update', 'delete')),
    actor_user_id TEXT REFERENCES users(id),
    idempotency_key TEXT NOT NULL,
    signature_verified INTEGER NOT NULL DEFAULT 0 CHECK (signature_verified IN (0, 1)),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (repository_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_ref_events_ref ON repository_ref_events(repository_id, ref_name, created_at);

CREATE TABLE IF NOT EXISTS repository_forks (
    child_repository_id TEXT PRIMARY KEY REFERENCES repositories(id),
    parent_repository_id TEXT NOT NULL REFERENCES repositories(id),
    forked_by_user_id TEXT NOT NULL REFERENCES users(id),
    parent_ref_name TEXT NOT NULL,
    parent_commit_oid TEXT NOT NULL,
    child_initial_commit_oid TEXT NOT NULL,
    lineage_root_repository_id TEXT NOT NULL REFERENCES repositories(id),
    depth INTEGER NOT NULL CHECK (depth > 0),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (child_repository_id <> parent_repository_id)
);
CREATE INDEX IF NOT EXISTS idx_repository_forks_parent ON repository_forks(parent_repository_id, created_at);
CREATE INDEX IF NOT EXISTS idx_repository_forks_root ON repository_forks(lineage_root_repository_id, depth);

CREATE TRIGGER IF NOT EXISTS repository_forks_immutable_update
BEFORE UPDATE ON repository_forks
BEGIN
    SELECT RAISE(ABORT, 'repository fork ancestry is immutable');
END;

CREATE TRIGGER IF NOT EXISTS repository_forks_immutable_delete
BEFORE DELETE ON repository_forks
BEGIN
    SELECT RAISE(ABORT, 'repository fork ancestry is immutable');
END;

CREATE TABLE IF NOT EXISTS feature_packages (
    id TEXT PRIMARY KEY,
    repository_id TEXT NOT NULL REFERENCES repositories(id),
    owner_user_id TEXT NOT NULL REFERENCES users(id),
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('draft', 'active', 'deprecated', 'withdrawn')),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (repository_id, slug)
);

CREATE TABLE IF NOT EXISTS feature_package_versions (
    id TEXT PRIMARY KEY,
    feature_package_id TEXT NOT NULL REFERENCES feature_packages(id),
    version TEXT NOT NULL,
    git_ref TEXT NOT NULL,
    commit_oid TEXT NOT NULL,
    tree_oid TEXT NOT NULL,
    manifest_digest TEXT NOT NULL,
    compatibility_manifest TEXT NOT NULL DEFAULT '{}',
    license_spdx TEXT NOT NULL,
    price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
    currency TEXT NOT NULL DEFAULT 'usd',
    published_by_user_id TEXT NOT NULL REFERENCES users(id),
    published_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    yanked_at DATETIME,
    UNIQUE (feature_package_id, version),
    UNIQUE (feature_package_id, commit_oid)
);
CREATE INDEX IF NOT EXISTS idx_feature_versions_ref ON feature_package_versions(feature_package_id, git_ref);

CREATE TABLE IF NOT EXISTS merge_jobs (
    id TEXT PRIMARY KEY,
    target_repository_id TEXT NOT NULL REFERENCES repositories(id),
    target_ref TEXT NOT NULL,
    feature_version_id TEXT REFERENCES feature_package_versions(id),
    requested_by_user_id TEXT NOT NULL REFERENCES users(id),
    expected_target_oid TEXT,
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'preparing', 'running', 'needs_input', 'preview_ready', 'landing', 'landed', 'stale', 'failed', 'cancelled')),
    idempotency_key TEXT NOT NULL,
    active_attempt_number INTEGER NOT NULL DEFAULT 0 CHECK (active_attempt_number >= 0),
    landed_commit_oid TEXT,
    failure_code TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    UNIQUE (requested_by_user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_merge_jobs_queue ON merge_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_merge_jobs_target ON merge_jobs(target_repository_id, target_ref, created_at);

CREATE TABLE IF NOT EXISTS merge_attempts (
    id TEXT PRIMARY KEY,
    merge_job_id TEXT NOT NULL REFERENCES merge_jobs(id) ON DELETE CASCADE,
    attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
    input_target_oid TEXT NOT NULL,
    input_feature_oid TEXT,
    result_commit_oid TEXT,
    result_tree_oid TEXT,
    patch_artifact_id TEXT,
    model_id TEXT,
    toolchain_version TEXT NOT NULL,
    test_policy_version TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'preparing'
        CHECK (status IN ('preparing', 'running', 'needs_input', 'preview_ready', 'approved', 'rejected', 'stale', 'failed', 'cancelled', 'landed')),
    requested_instructions TEXT NOT NULL DEFAULT '',
    failure_detail TEXT,
    started_at DATETIME,
    finished_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (merge_job_id, attempt_number)
);

CREATE TABLE IF NOT EXISTS merge_approvals (
    id TEXT PRIMARY KEY,
    merge_attempt_id TEXT NOT NULL REFERENCES merge_attempts(id) ON DELETE CASCADE,
    approver_user_id TEXT NOT NULL REFERENCES users(id),
    result_commit_oid TEXT NOT NULL,
    decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
    comment TEXT NOT NULL DEFAULT '',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (merge_attempt_id, approver_user_id)
);

CREATE TABLE IF NOT EXISTS build_runs (
    id TEXT PRIMARY KEY,
    repository_id TEXT NOT NULL REFERENCES repositories(id),
    commit_oid TEXT NOT NULL,
    merge_attempt_id TEXT REFERENCES merge_attempts(id),
    purpose TEXT NOT NULL CHECK (purpose IN ('verification', 'preview', 'release')),
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'passed', 'failed', 'cancelled', 'timed_out')),
    runner_image_digest TEXT NOT NULL,
    build_command TEXT NOT NULL,
    test_command TEXT,
    source_manifest_digest TEXT NOT NULL,
    result_digest TEXT,
    exit_code INTEGER,
    duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
    queued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME,
    finished_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_build_runs_commit ON build_runs(repository_id, commit_oid, queued_at);
CREATE INDEX IF NOT EXISTS idx_build_runs_status ON build_runs(status, queued_at);

CREATE TABLE IF NOT EXISTS build_artifacts (
    id TEXT PRIMARY KEY,
    build_run_id TEXT NOT NULL REFERENCES build_runs(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('binary', 'bundle', 'log', 'test_report', 'coverage', 'screenshot', 'patch', 'sbom', 'attestation')),
    r2_key TEXT NOT NULL UNIQUE,
    sha256 TEXT NOT NULL,
    media_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
    platform TEXT,
    architecture TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS deployment_revisions (
    id TEXT PRIMARY KEY,
    app_id TEXT NOT NULL REFERENCES app_listings(id),
    repository_id TEXT NOT NULL REFERENCES repositories(id),
    commit_oid TEXT NOT NULL,
    build_run_id TEXT NOT NULL REFERENCES build_runs(id),
    environment TEXT NOT NULL CHECK (environment IN ('preview', 'staging', 'production')),
    revision_number INTEGER NOT NULL CHECK (revision_number > 0),
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'deploying', 'healthy', 'unhealthy', 'superseded', 'rolled_back', 'failed')),
    url TEXT,
    runtime_config_digest TEXT NOT NULL,
    deployed_by_user_id TEXT NOT NULL REFERENCES users(id),
    deployed_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (app_id, environment, revision_number)
);
CREATE INDEX IF NOT EXISTS idx_deployments_current ON deployment_revisions(app_id, environment, status);

CREATE TABLE IF NOT EXISTS editorial_reviews (
    id TEXT PRIMARY KEY,
    app_id TEXT NOT NULL REFERENCES app_listings(id),
    repository_id TEXT REFERENCES repositories(id),
    commit_oid TEXT,
    author_user_id TEXT NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    body_markdown TEXT NOT NULL,
    verdict TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'in_review', 'published', 'retracted')),
    methodology_version TEXT NOT NULL,
    disclosure TEXT NOT NULL DEFAULT '',
    published_at DATETIME,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_editorial_reviews_app ON editorial_reviews(app_id, status, published_at);

CREATE TABLE IF NOT EXISTS editorial_measurements (
    id TEXT PRIMARY KEY,
    review_id TEXT NOT NULL REFERENCES editorial_reviews(id) ON DELETE CASCADE,
    evidence_artifact_id TEXT REFERENCES build_artifacts(id),
    metric_key TEXT NOT NULL,
    numeric_value REAL,
    text_value TEXT,
    unit TEXT,
    display_order INTEGER NOT NULL DEFAULT 0,
    CHECK (numeric_value IS NOT NULL OR text_value IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS forge_outbox_events (
    id TEXT PRIMARY KEY,
    aggregate_type TEXT NOT NULL CHECK (aggregate_type IN ('repository', 'ref', 'fork', 'merge', 'build', 'deployment')),
    aggregate_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    available_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    delivered_at DATETIME,
    last_error TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_forge_outbox_delivery ON forge_outbox_events(delivered_at, available_at);

CREATE TABLE IF NOT EXISTS forge_reconciliation_issues (
    id TEXT PRIMARY KEY,
    repository_id TEXT NOT NULL REFERENCES repositories(id),
    ref_name TEXT,
    issue_type TEXT NOT NULL CHECK (issue_type IN ('git_missing_in_d1', 'd1_missing_in_git', 'oid_mismatch', 'artifact_missing')),
    git_oid TEXT,
    d1_oid TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'repairing', 'resolved', 'ignored')),
    detail TEXT NOT NULL DEFAULT '',
    detected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_forge_reconciliation_open ON forge_reconciliation_issues(status, detected_at);

CREATE VIEW IF NOT EXISTS repository_lineage AS
SELECT
    f.child_repository_id,
    f.parent_repository_id,
    f.lineage_root_repository_id,
    f.depth,
    f.parent_commit_oid,
    f.child_initial_commit_oid,
    f.created_at
FROM repository_forks f;
