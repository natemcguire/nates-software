# Antigravity CLI Handoff — Canonical Forge and Lineage Model

Date: 2026-08-29

## Objective completed

Added the missing canonical data model for repositories, Git refs, immutable fork ancestry, feature versions, merge workflows, build evidence, deployments, benchmarks, and editorial reviews.

## Files added

- `migrations/0006_canonical_forge_lineage.sql`
  - Adds 16 canonical tables.
  - Adds indexes, constraints, an audit event table, and immutable-fork triggers.
  - Preserves existing tables and does not invent repository rows from mock counters.
- `src/lib/forgeDomain.ts`
  - Defines merge-job state transitions.
  - Validates immutable fork origins using full Git object IDs.
  - Defines the basic persisted-current-OID CAS invariant.
- `tests/forge-domain.test.ts`
  - Covers fork validation, CAS validation, retry transitions, and terminal states.
- `docs/architecture/canonical-forge-lineage-schema.md`
  - Documents authority boundaries, relationships, invariants, rollout, and the next integration task.

## Canonical decisions

1. Git is authoritative for commit/tree objects.
2. D1 is authoritative for repository ownership, workflow state, immutable lineage, evidence metadata, benchmarks, and reviews.
3. `repository_forks` is the canonical direct-parent graph. One child has one immutable origin.
4. Fork records pin full parent/child OIDs at creation time. Moving a branch cannot rewrite ancestry.
5. `app_listings.forks` remains temporarily as a compatibility cache; it is not authoritative.
6. Current refs live in `repository_refs`; every accepted mutation is recorded in `repository_ref_events` with an idempotency key.
7. Feature versions pin Git ref, commit OID, tree OID, manifest digest, compatibility manifest, license, and price.
8. A merge job may have multiple immutable attempts. Attempts pin input/result OIDs and tool/test-policy versions.
9. R2 holds large artifacts; `build_artifacts` holds hashes, size, media type, provenance, and R2 keys.
10. Benchmarks store raw samples and explicitly identify warmup samples. Editorial measurements can cite benchmark runs.

## Validation performed

```text
SQLite schema parse with foreign_keys=ON: PASS (16/16 canonical tables)
tests/forge-domain.test.ts: PASS (4/4)
npm run build: PASS
npm test: 194 passed, 1 unrelated GITSMITH API test failed
```

The full-suite failure is in `tests/gitsmith-backend.test.ts`, where a GITSMITH GET response expectation does not match the current `functions/api/git.ts` response. There were already unrelated working-tree modifications in those files. Do not overwrite or revert them without reviewing the active work.

## Do next

Integrate `functions/api/git.ts` with `repositories`, `repository_refs`, and `repository_ref_events`. The current CAS endpoint must stop passing the caller's expected SHA as the current remote SHA.

Required flow:

1. Authenticate the session and authorize the repo/ref operation.
2. Resolve `repository_id` from owner/slug or an opaque ID.
3. Read the authoritative persisted current OID.
4. Compare it with `expectedOldOid`; return HTTP 409 if stale.
5. Verify the proposed object exists in the Git quarantine/object store.
6. Publish the actual Git ref using compare-and-swap.
7. Update `repository_refs` and insert one idempotent `repository_ref_events` row.
8. Run reconciliation if Git publication succeeds but D1 persistence fails.

Then implement a fork service that creates the child repository and inserts `repository_forks` only after the child initial ref is successfully published. Never derive ancestry from `app_listings.forks`.

## Important migration note

This migration itself parses successfully in SQLite. The older `0004_auth_and_security.sql` migration still uses `CREATE TABLE IF NOT EXISTS` as if it added columns to the pre-existing `users` table. It does not. Fix that older migration path before applying the complete migration chain to a fresh production-like D1 database.

