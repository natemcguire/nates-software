-- Migration 0034: Signed, immutable RIG verification evidence bundle.
-- Invariants:
-- 1. A completed build_run MAY have exactly one evidence bundle: a single
--    immutable R2 object containing { logs, testReport, artifactDigests,
--    networkPolicy/isolationAttestation, runtimeIdentity, resultDigest }.
-- 2. evidence_bundle_r2_key + evidence_bundle_sha256 are written together,
--    atomically, at verification-complete time — never independently.
-- 3. evidence_bundle_sha256 is the server-computed sha256 of the exact bytes
--    stored at evidence_bundle_r2_key. INBOX approval re-fetches the R2
--    object and recomputes this digest before trusting it (fail closed on
--    any mismatch or missing object).
-- 4. A build_run without an evidence bundle recorded here can never be
--    treated as "reproducible" by INBOX approval — the absence IS the
--    fail-closed signal, not a null-check bypass.

PRAGMA foreign_keys = ON;

ALTER TABLE build_runs ADD COLUMN evidence_bundle_r2_key TEXT;
ALTER TABLE build_runs ADD COLUMN evidence_bundle_sha256 TEXT
  CHECK (evidence_bundle_sha256 IS NULL OR evidence_bundle_sha256 LIKE 'sha256:%');
ALTER TABLE build_runs ADD COLUMN evidence_bundle_recorded_at DATETIME;

CREATE INDEX IF NOT EXISTS idx_build_runs_evidence_bundle
  ON build_runs(evidence_bundle_r2_key) WHERE evidence_bundle_r2_key IS NOT NULL;
