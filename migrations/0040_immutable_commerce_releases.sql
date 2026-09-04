PRAGMA foreign_keys = ON;

CREATE TABLE commerce_releases (
    id TEXT PRIMARY KEY,
    app_id TEXT NOT NULL REFERENCES app_listings(id),
    repository_id TEXT NOT NULL REFERENCES repositories(id),
    seller_user_id TEXT NOT NULL REFERENCES users(id),
    commit_oid TEXT NOT NULL CHECK (length(commit_oid) IN (40, 64)),
    deployment_revision_id TEXT NOT NULL REFERENCES deployment_revisions(id),
    build_run_id TEXT NOT NULL REFERENCES build_runs(id),
    version TEXT NOT NULL CHECK (length(trim(version)) > 0),
    binaries_json TEXT NOT NULL,
    artifact_manifest_json TEXT NOT NULL,
    resale_enabled INTEGER NOT NULL CHECK (resale_enabled IN (0, 1)),
    forking_enabled INTEGER NOT NULL CHECK (forking_enabled IN (0, 1)),
    visibility TEXT NOT NULL CHECK (visibility IN ('public', 'unlisted', 'private')),
    published_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_commerce_releases_app ON commerce_releases(app_id, published_at DESC);
CREATE INDEX idx_commerce_releases_commit ON commerce_releases(repository_id, commit_oid);

ALTER TABLE commerce_products ADD COLUMN release_id TEXT REFERENCES commerce_releases(id);
ALTER TABLE commerce_orders ADD COLUMN release_id TEXT REFERENCES commerce_releases(id);
ALTER TABLE commerce_licenses ADD COLUMN release_id TEXT REFERENCES commerce_releases(id);

CREATE INDEX idx_commerce_orders_release ON commerce_orders(release_id);
CREATE INDEX idx_commerce_licenses_release ON commerce_licenses(release_id);

CREATE TRIGGER commerce_releases_require_exact_proof
BEFORE INSERT ON commerce_releases
WHEN NOT EXISTS (
    SELECT 1
    FROM deployment_revisions dr
    JOIN build_runs br ON br.id = dr.build_run_id
    JOIN repositories repo ON repo.id = dr.repository_id
    JOIN repository_refs ref ON ref.repository_id = repo.id AND ref.ref_name = repo.default_ref
    JOIN app_listings app ON app.id = dr.app_id
    WHERE dr.id = NEW.deployment_revision_id
      AND dr.app_id = NEW.app_id
      AND dr.repository_id = NEW.repository_id
      AND dr.commit_oid = NEW.commit_oid
      AND dr.build_run_id = NEW.build_run_id
      AND dr.status = 'healthy'
      AND br.repository_id = dr.repository_id
      AND br.commit_oid = dr.commit_oid
      AND br.status = 'passed'
      AND repo.owner_user_id = NEW.seller_user_id
      AND repo.visibility = NEW.visibility
      AND ref.commit_oid = NEW.commit_oid
      AND app.repository_id = NEW.repository_id
      AND app.creator_id = NEW.seller_user_id
)
BEGIN
    SELECT RAISE(ABORT, 'commerce release requires exact healthy head proof');
END;

CREATE TRIGGER commerce_releases_immutable_update
BEFORE UPDATE ON commerce_releases
BEGIN
    SELECT RAISE(ABORT, 'commerce releases are immutable');
END;

CREATE TRIGGER commerce_releases_immutable_delete
BEFORE DELETE ON commerce_releases
BEGIN
    SELECT RAISE(ABORT, 'commerce releases are immutable');
END;

CREATE TRIGGER commerce_orders_release_immutable
BEFORE UPDATE OF release_id ON commerce_orders
WHEN OLD.release_id IS NOT NEW.release_id
BEGIN
    SELECT RAISE(ABORT, 'commerce order release is immutable');
END;

CREATE TRIGGER commerce_orders_release_matches_order
BEFORE INSERT ON commerce_orders
WHEN NEW.release_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM commerce_releases r
    WHERE r.id = NEW.release_id
      AND r.app_id = NEW.app_id
      AND r.repository_id IS NEW.repository_id
      AND r.seller_user_id = NEW.seller_user_id
      AND r.version = NEW.app_version
)
BEGIN
    SELECT RAISE(ABORT, 'commerce order release linkage is invalid');
END;

CREATE TRIGGER commerce_licenses_release_immutable
BEFORE UPDATE OF release_id ON commerce_licenses
WHEN OLD.release_id IS NOT NEW.release_id
BEGIN
    SELECT RAISE(ABORT, 'commerce license release is immutable');
END;

CREATE TRIGGER commerce_licenses_release_matches_order
BEFORE INSERT ON commerce_licenses
WHEN NEW.release_id IS NOT (SELECT release_id FROM commerce_orders WHERE id = NEW.order_id)
BEGIN
    SELECT RAISE(ABORT, 'commerce license release must match its order');
END;

CREATE TRIGGER commerce_products_release_matches_listing_insert
BEFORE INSERT ON commerce_products
WHEN NEW.release_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM commerce_releases r
    WHERE r.id = NEW.release_id
      AND r.app_id = NEW.app_id
      AND r.repository_id IS NEW.repository_id
      AND r.seller_user_id = NEW.seller_user_id
)
BEGIN
    SELECT RAISE(ABORT, 'commerce product release linkage is invalid');
END;

CREATE TRIGGER commerce_products_release_matches_listing_update
BEFORE UPDATE OF release_id, app_id, repository_id, seller_user_id ON commerce_products
WHEN NEW.release_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM commerce_releases r
    WHERE r.id = NEW.release_id
      AND r.app_id = NEW.app_id
      AND r.repository_id IS NEW.repository_id
      AND r.seller_user_id = NEW.seller_user_id
)
BEGIN
    SELECT RAISE(ABORT, 'commerce product release linkage is invalid');
END;
