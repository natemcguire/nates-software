-- DYNO is the LLM dynamometer. Public CLI measurements are Street evidence;
-- official Certified evaluations are run and published by Nate's Software.
-- This migration models the sealed double-blind ceremony and durable verifier
-- work without pretending Cloudflare Pages is an enclave or model runner.

PRAGMA foreign_keys = ON;

ALTER TABLE dyno_runs ADD COLUMN evaluation_class TEXT NOT NULL DEFAULT 'street'
  CHECK (evaluation_class IN ('street', 'reproduced', 'certified', 'certified_double_blind'));
ALTER TABLE dyno_runs ADD COLUMN official_evaluator TEXT;
ALTER TABLE dyno_runs ADD COLUMN official_published_at DATETIME;

CREATE TABLE IF NOT EXISTS dyno_evaluation_ceremonies (
    id TEXT PRIMARY KEY,
    run_id TEXT UNIQUE REFERENCES dyno_runs(id) ON DELETE RESTRICT,
    requested_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    evaluation_class TEXT NOT NULL CHECK (evaluation_class IN ('certified', 'certified_double_blind')),
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
      'draft', 'awaiting_attestation', 'awaiting_approvals', 'ready', 'running',
      'completed', 'failed', 'destroyed', 'cancelled'
    )),
    suite_id TEXT NOT NULL REFERENCES dyno_suites(id) ON DELETE RESTRICT,
    suite_manifest_digest TEXT NOT NULL CHECK (length(suite_manifest_digest) = 64),
    private_task_set_digest TEXT NOT NULL CHECK (length(private_task_set_digest) = 64),
    grader_manifest_digest TEXT NOT NULL CHECK (length(grader_manifest_digest) = 64),
    subject_commitment_digest TEXT NOT NULL CHECK (length(subject_commitment_digest) = 64),
    harness_manifest_digest TEXT NOT NULL CHECK (length(harness_manifest_digest) = 64),
    tool_manifest_digest TEXT NOT NULL CHECK (length(tool_manifest_digest) = 64),
    execution_policy_digest TEXT NOT NULL CHECK (length(execution_policy_digest) = 64),
    output_policy_digest TEXT NOT NULL CHECK (length(output_policy_digest) = 64),
    ceremony_manifest_digest TEXT NOT NULL UNIQUE CHECK (length(ceremony_manifest_digest) = 64),
    enclave_provider TEXT,
    enclave_profile TEXT,
    expires_at DATETIME NOT NULL,
    failure_code TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    destroyed_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_dyno_ceremonies_owner
  ON dyno_evaluation_ceremonies(requested_by_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dyno_ceremonies_status
  ON dyno_evaluation_ceremonies(status, expires_at);

CREATE TABLE IF NOT EXISTS dyno_ceremony_parties (
    id TEXT PRIMARY KEY,
    ceremony_id TEXT NOT NULL REFERENCES dyno_evaluation_ceremonies(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('evaluator', 'model_owner', 'enclave_operator')),
    organization_name TEXT NOT NULL,
    signing_key_id TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (ceremony_id, role)
);

CREATE TABLE IF NOT EXISTS dyno_enclave_attestations (
    id TEXT PRIMARY KEY,
    ceremony_id TEXT NOT NULL REFERENCES dyno_evaluation_ceremonies(id) ON DELETE RESTRICT,
    quote_format TEXT NOT NULL,
    quote_digest TEXT NOT NULL UNIQUE CHECK (length(quote_digest) = 64),
    nonce_digest TEXT NOT NULL CHECK (length(nonce_digest) = 64),
    ephemeral_public_key_digest TEXT NOT NULL CHECK (length(ephemeral_public_key_digest) = 64),
    tcb_measurement_digest TEXT NOT NULL CHECK (length(tcb_measurement_digest) = 64),
    firmware_security_version TEXT NOT NULL,
    verifier_name TEXT NOT NULL,
    verifier_version TEXT NOT NULL,
    verifier_policy_digest TEXT NOT NULL CHECK (length(verifier_policy_digest) = 64),
    verified INTEGER NOT NULL CHECK (verified IN (0, 1)),
    verified_at DATETIME NOT NULL,
    expires_at DATETIME NOT NULL,
    rejection_reason TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_dyno_attestations_ceremony
  ON dyno_enclave_attestations(ceremony_id, created_at DESC);

CREATE TABLE IF NOT EXISTS dyno_ceremony_approvals (
    id TEXT PRIMARY KEY,
    ceremony_id TEXT NOT NULL REFERENCES dyno_evaluation_ceremonies(id) ON DELETE RESTRICT,
    party_id TEXT NOT NULL REFERENCES dyno_ceremony_parties(id) ON DELETE RESTRICT,
    attestation_id TEXT NOT NULL REFERENCES dyno_enclave_attestations(id) ON DELETE RESTRICT,
    ceremony_manifest_digest TEXT NOT NULL CHECK (length(ceremony_manifest_digest) = 64),
    tcb_measurement_digest TEXT NOT NULL CHECK (length(tcb_measurement_digest) = 64),
    output_policy_digest TEXT NOT NULL CHECK (length(output_policy_digest) = 64),
    signature_digest TEXT NOT NULL UNIQUE CHECK (length(signature_digest) = 64),
    approved_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (ceremony_id, party_id)
);

CREATE TABLE IF NOT EXISTS dyno_sealed_asset_receipts (
    id TEXT PRIMARY KEY,
    ceremony_id TEXT NOT NULL REFERENCES dyno_evaluation_ceremonies(id) ON DELETE RESTRICT,
    party_id TEXT NOT NULL REFERENCES dyno_ceremony_parties(id) ON DELETE RESTRICT,
    asset_role TEXT NOT NULL CHECK (asset_role IN ('private_tasks', 'private_graders', 'model_assets', 'inference_code')),
    plaintext_commitment_digest TEXT NOT NULL CHECK (length(plaintext_commitment_digest) = 64),
    ciphertext_digest TEXT NOT NULL CHECK (length(ciphertext_digest) = 64),
    attested_channel_key_digest TEXT NOT NULL CHECK (length(attested_channel_key_digest) = 64),
    byte_size INTEGER NOT NULL CHECK (byte_size > 0),
    received_at DATETIME NOT NULL,
    destroyed_at DATETIME,
    UNIQUE (ceremony_id, asset_role)
);

CREATE TABLE IF NOT EXISTS dyno_verifier_jobs (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES dyno_runs(id) ON DELETE CASCADE,
    ceremony_id TEXT REFERENCES dyno_evaluation_ceremonies(id) ON DELETE RESTRICT,
    requested_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    requested_class TEXT NOT NULL CHECK (requested_class IN ('reproduced', 'certified', 'certified_double_blind')),
    replay_identity_digest TEXT NOT NULL CHECK (length(replay_identity_digest) = 64),
    source_trace_digest TEXT NOT NULL CHECK (length(source_trace_digest) = 64),
    source_trace_r2_key TEXT,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
      'queued', 'leased', 'running', 'succeeded', 'retryable_failure', 'dead_letter', 'cancelled'
    )),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
    available_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    claim_token TEXT,
    lease_expires_at DATETIME,
    worker_id TEXT,
    last_error_code TEXT,
    result_attestation_digest TEXT CHECK (result_attestation_digest IS NULL OR length(result_attestation_digest) = 64),
    result_digest TEXT CHECK (result_digest IS NULL OR length(result_digest) = 64),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    dead_lettered_at DATETIME,
    UNIQUE (run_id, requested_class, replay_identity_digest)
);
CREATE INDEX IF NOT EXISTS idx_dyno_verifier_claim
  ON dyno_verifier_jobs(status, available_at, lease_expires_at, created_at);
CREATE INDEX IF NOT EXISTS idx_dyno_verifier_owner
  ON dyno_verifier_jobs(requested_by_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS dyno_verifier_attempts (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES dyno_verifier_jobs(id) ON DELETE CASCADE,
    attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
    worker_id TEXT NOT NULL,
    claim_token_digest TEXT NOT NULL CHECK (length(claim_token_digest) = 64),
    replay_identity_digest TEXT NOT NULL CHECK (length(replay_identity_digest) = 64),
    status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'inconclusive')),
    result_digest TEXT CHECK (result_digest IS NULL OR length(result_digest) = 64),
    attestation_digest TEXT CHECK (attestation_digest IS NULL OR length(attestation_digest) = 64),
    error_code TEXT,
    started_at DATETIME NOT NULL,
    completed_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (job_id, attempt_number)
);

CREATE TABLE IF NOT EXISTS dyno_trace_retention_requests (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES dyno_runs(id) ON DELETE CASCADE,
    requested_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    trace_digest TEXT NOT NULL CHECK (length(trace_digest) = 64),
    r2_key TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'deleting', 'deleted', 'failed')),
    deletion_receipt_digest TEXT CHECK (deletion_receipt_digest IS NULL OR length(deletion_receipt_digest) = 64),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    UNIQUE (run_id)
);

-- Evidence records are append-only. Corrections create a new record/job.
CREATE TRIGGER IF NOT EXISTS dyno_attestations_immutable_update
BEFORE UPDATE ON dyno_enclave_attestations BEGIN
  SELECT RAISE(ABORT, 'dyno enclave attestations are immutable');
END;
CREATE TRIGGER IF NOT EXISTS dyno_attestations_immutable_delete
BEFORE DELETE ON dyno_enclave_attestations BEGIN
  SELECT RAISE(ABORT, 'dyno enclave attestations are immutable');
END;
CREATE TRIGGER IF NOT EXISTS dyno_approvals_immutable_update
BEFORE UPDATE ON dyno_ceremony_approvals BEGIN
  SELECT RAISE(ABORT, 'dyno ceremony approvals are immutable');
END;
CREATE TRIGGER IF NOT EXISTS dyno_approvals_immutable_delete
BEFORE DELETE ON dyno_ceremony_approvals BEGIN
  SELECT RAISE(ABORT, 'dyno ceremony approvals are immutable');
END;
