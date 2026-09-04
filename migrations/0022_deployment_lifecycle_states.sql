PRAGMA foreign_keys = ON;

ALTER TABLE app_listings ADD COLUMN deployment_state TEXT NOT NULL DEFAULT 'draft'
  CHECK (deployment_state IN ('draft', 'source_ready', 'building', 'deployable', 'active', 'failed', 'retired', 'client_demo'));

ALTER TABLE app_listings ADD COLUMN deployment_error TEXT;

ALTER TABLE app_listings ADD COLUMN deployment_evidence_json TEXT;

ALTER TABLE app_listings ADD COLUMN detected_project_type TEXT;

ALTER TABLE app_listings ADD COLUMN deployment_plan_json TEXT;

ALTER TABLE app_listings ADD COLUMN active_deployment_id TEXT REFERENCES deployment_revisions(id);

ALTER TABLE app_listings ADD COLUMN active_commit_oid TEXT;

UPDATE app_listings SET deployment_state = 'client_demo' WHERE id IN ('dronehunter', 'certified-mailer', 'wallart');

UPDATE app_listings SET deployment_state = 'draft',
  deployment_error = 'No deployable revision exists for American Gardener. Source has not been imported into GITSMITH and built by RIG.'
WHERE id = 'american-gardener';

UPDATE app_listings SET deployment_state = 'retired' WHERE id = 'picfitai' OR listing_status = 'retired';
