-- Migration 0022: Deployment lifecycle states and honest error tracking.
-- Invariants:
-- 1. Apps must reach a verified deployment revision before appearing 'active'.
-- 2. Publication/catalog entry sets 'draft' (or 'source_ready'), never 'active'.
-- 3. Deployment states: draft, source_ready, building, deployable, active, failed, retired.
-- 4. Fail-closed evidence tracking: deployment_error, deployment_evidence_json, detected_project_type, deployment_plan_json.

PRAGMA foreign_keys = ON;

ALTER TABLE app_listings ADD COLUMN deployment_state TEXT NOT NULL DEFAULT 'draft'
  CHECK (deployment_state IN ('draft', 'source_ready', 'building', 'deployable', 'active', 'failed', 'retired'));

ALTER TABLE app_listings ADD COLUMN deployment_error TEXT;

ALTER TABLE app_listings ADD COLUMN deployment_evidence_json TEXT;

ALTER TABLE app_listings ADD COLUMN detected_project_type TEXT;

ALTER TABLE app_listings ADD COLUMN deployment_plan_json TEXT;

ALTER TABLE app_listings ADD COLUMN active_deployment_id TEXT REFERENCES deployment_revisions(id);

ALTER TABLE app_listings ADD COLUMN active_commit_oid TEXT;

-- Set initial deployment states for existing catalog entries:
-- Client-side verified local demo runtimes:
UPDATE app_listings SET deployment_state = 'active' WHERE id IN ('dronehunter', 'certified-mailer', 'wallart');

-- Catalog entries without a verified deployment revision start in 'draft':
UPDATE app_listings SET deployment_state = 'draft',
  deployment_error = 'No deployable revision exists for American Gardener. Source has not been imported into GITSMITH and built by RIG.'
WHERE id = 'american-gardener';

-- Retired entries:
UPDATE app_listings SET deployment_state = 'retired' WHERE id = 'picfitai' OR listing_status = 'retired';
