PRAGMA foreign_keys = ON;

ALTER TABLE build_runs ADD COLUMN evidence_bundle_r2_key TEXT;
ALTER TABLE build_runs ADD COLUMN evidence_bundle_sha256 TEXT
  CHECK (evidence_bundle_sha256 IS NULL OR evidence_bundle_sha256 LIKE 'sha256:%');
ALTER TABLE build_runs ADD COLUMN evidence_bundle_recorded_at DATETIME;

CREATE INDEX IF NOT EXISTS idx_build_runs_evidence_bundle
  ON build_runs(evidence_bundle_r2_key) WHERE evidence_bundle_r2_key IS NOT NULL;
