PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS dyno_suites (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL,
    version TEXT NOT NULL,
    name TEXT NOT NULL,
    methodology_markdown TEXT NOT NULL,
    task_manifest_digest TEXT NOT NULL,
    grader_version TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'retired')),
    published_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (slug, version)
);

CREATE TABLE IF NOT EXISTS dyno_tasks (
    id TEXT PRIMARY KEY,
    suite_id TEXT NOT NULL REFERENCES dyno_suites(id) ON DELETE CASCADE,
    task_key TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('explain_repo', 'find_bug', 'implement_feature', 'repair_test', 'modify_schema', 'resolve_conflict', 'refactor_safe', 'build_package', 'follow_repo_rules', 'recover_failure', 'cli_operation')),
    title TEXT NOT NULL,
    prompt_digest TEXT NOT NULL,
    fixture_digest TEXT NOT NULL,
    grader_manifest_digest TEXT NOT NULL,
    time_limit_seconds INTEGER NOT NULL CHECK (time_limit_seconds > 0),
    weight REAL NOT NULL DEFAULT 1 CHECK (weight > 0),
    display_order INTEGER NOT NULL DEFAULT 0,
    UNIQUE (suite_id, task_key)
);

CREATE TABLE IF NOT EXISTS dyno_subjects (
    id TEXT PRIMARY KEY,
    model_provider TEXT NOT NULL,
    model_id TEXT NOT NULL,
    model_version TEXT,
    model_config TEXT NOT NULL DEFAULT '{}',
    agent_harness TEXT NOT NULL,
    harness_version TEXT NOT NULL,
    tool_manifest TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (model_provider, model_id, model_version, agent_harness, harness_version, model_config, tool_manifest)
);

CREATE TABLE IF NOT EXISTS dyno_environments (
    id TEXT PRIMARY KEY,
    os_name TEXT NOT NULL,
    os_version TEXT NOT NULL,
    architecture TEXT NOT NULL,
    cpu_model TEXT,
    accelerator_model TEXT,
    memory_bytes INTEGER CHECK (memory_bytes IS NULL OR memory_bytes > 0),
    container_image_digest TEXT NOT NULL,
    runtime_manifest TEXT NOT NULL,
    network_policy TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dyno_runs (
    id TEXT PRIMARY KEY,
    suite_id TEXT NOT NULL REFERENCES dyno_suites(id),
    subject_id TEXT NOT NULL REFERENCES dyno_subjects(id),
    environment_id TEXT NOT NULL REFERENCES dyno_environments(id),
    submitted_by_user_id TEXT REFERENCES users(id),
    repetition INTEGER NOT NULL DEFAULT 1 CHECK (repetition > 0),
    randomization_seed TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'grading', 'completed', 'invalid', 'failed', 'cancelled')),
    verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified', 'reproducible', 'verified', 'rejected')),
    overall_score REAL,
    total_cost_micros INTEGER CHECK (total_cost_micros IS NULL OR total_cost_micros >= 0),
    total_tokens INTEGER CHECK (total_tokens IS NULL OR total_tokens >= 0),
    runner_attestation_digest TEXT,
    raw_trace_r2_key TEXT,
    raw_trace_sha256 TEXT,
    started_at DATETIME,
    completed_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (suite_id, subject_id, environment_id, repetition, randomization_seed)
);
CREATE INDEX IF NOT EXISTS idx_dyno_runs_leaderboard ON dyno_runs(suite_id, verification_status, overall_score);

CREATE TABLE IF NOT EXISTS dyno_task_attempts (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES dyno_runs(id) ON DELETE CASCADE,
    task_id TEXT NOT NULL REFERENCES dyno_tasks(id),
    attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
    status TEXT NOT NULL CHECK (status IN ('running', 'passed', 'failed', 'timed_out', 'unsafe', 'cancelled')),
    first_attempt_success INTEGER NOT NULL DEFAULT 0 CHECK (first_attempt_success IN (0, 1)),
    hidden_tests_passed INTEGER NOT NULL DEFAULT 0 CHECK (hidden_tests_passed >= 0),
    hidden_tests_total INTEGER NOT NULL DEFAULT 0 CHECK (hidden_tests_total >= 0),
    duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
    input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
    output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
    cached_input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cached_input_tokens >= 0),
    cost_micros INTEGER NOT NULL DEFAULT 0 CHECK (cost_micros >= 0),
    tool_calls INTEGER NOT NULL DEFAULT 0 CHECK (tool_calls >= 0),
    human_interventions INTEGER NOT NULL DEFAULT 0 CHECK (human_interventions >= 0),
    unnecessary_files_changed INTEGER NOT NULL DEFAULT 0 CHECK (unnecessary_files_changed >= 0),
    safety_violations INTEGER NOT NULL DEFAULT 0 CHECK (safety_violations >= 0),
    instruction_score REAL CHECK (instruction_score IS NULL OR (instruction_score >= 0 AND instruction_score <= 100)),
    result_digest TEXT,
    started_at DATETIME NOT NULL,
    completed_at DATETIME,
    UNIQUE (run_id, task_id, attempt_number)
);
CREATE INDEX IF NOT EXISTS idx_dyno_attempts_run ON dyno_task_attempts(run_id, task_id, attempt_number);

CREATE TABLE IF NOT EXISTS dyno_tool_events (
    id TEXT PRIMARY KEY,
    task_attempt_id TEXT NOT NULL REFERENCES dyno_task_attempts(id) ON DELETE CASCADE,
    sequence_number INTEGER NOT NULL CHECK (sequence_number >= 0),
    tool_name TEXT NOT NULL,
    command_class TEXT,
    started_offset_ms INTEGER NOT NULL CHECK (started_offset_ms >= 0),
    duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
    exit_code INTEGER,
    input_digest TEXT NOT NULL,
    output_digest TEXT,
    safety_classification TEXT NOT NULL DEFAULT 'allowed' CHECK (safety_classification IN ('allowed', 'reviewed', 'blocked', 'violation')),
    UNIQUE (task_attempt_id, sequence_number)
);

CREATE TABLE IF NOT EXISTS dyno_grader_results (
    id TEXT PRIMARY KEY,
    task_attempt_id TEXT NOT NULL REFERENCES dyno_task_attempts(id) ON DELETE CASCADE,
    grader_key TEXT NOT NULL,
    grader_version TEXT NOT NULL,
    passed INTEGER NOT NULL CHECK (passed IN (0, 1)),
    score REAL NOT NULL,
    max_score REAL NOT NULL CHECK (max_score > 0),
    evidence_digest TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (task_attempt_id, grader_key, grader_version)
);
