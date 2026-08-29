# Canonical Forge, Lineage, Evidence, and Editorial Schema

Migration: `migrations/0006_canonical_forge_lineage.sql`

## Authority boundaries

| Concern | Authority |
|---|---|
| Commit and tree objects | Git object store |
| Current ref projection and ref audit events | D1, reconciled by the Git gateway |
| Repository ownership and access metadata | D1 |
| Fork ancestry at creation time | D1 `repository_forks` |
| Feature identity, immutable version coordinates, and prices | D1 |
| Merge workflow and attempts | D1 |
| Build/deployment metadata | D1 |
| Logs, binaries, patches, SBOMs, and raw benchmark results | R2, addressed by D1 metadata |
| Benchmark methodology, samples, and verification | D1 |
| Editorial reviews and lab-card measurements | D1 |

## Central relationships

```text
app_listings ── repositories ── repository_refs
                      │
                      ├── repository_forks ── parent repository
                      ├── feature_packages ── feature_package_versions
                      ├── merge_jobs ── merge_attempts
                      ├── build_runs ── build_artifacts (R2 keys)
                      └── deployment_revisions

benchmark_suites ── benchmark_runs ── benchmark_samples
                                └── build/raw evidence

app_listings ── editorial_reviews ── editorial_measurements
```

## Invariants

1. A fork has exactly one direct parent. `repository_forks.child_repository_id` is its primary key.
2. Fork ancestry is immutable. SQL triggers reject updates and deletes. Repositories are archived rather than erasing lineage.
3. Fork records contain full parent and child OIDs. Branch movement cannot rewrite historical or economic ancestry.
4. `app_listings.forks` is now only a cached projection. Canonical fork count is `COUNT(*)` over `repository_forks.parent_repository_id`.
5. Feature versions are immutable coordinates: package + semantic version + commit/tree OIDs + manifest digest.
6. Merge attempts pin their input OIDs and tool/test-policy versions. Approval applies to a specific attempt result.
7. A Git gateway must compare `repository_refs.commit_oid` with the caller's expected OID before updating Git, then record a unique `repository_ref_events` event. The existing `/api/git` endpoint still needs this integration.
8. Artifacts live in R2; D1 stores immutable keys, hashes, sizes, and provenance.
9. Benchmark headline numbers are derived from non-warmup `benchmark_samples`, never accepted as an unexplained aggregate.
10. Editorial claims may reference a verified benchmark run, separating measured facts from written judgment.

## Operational transaction boundaries

Git object upload may occur before the D1 transaction. Publication is complete only when the ref CAS succeeds and its ref event is durable. A reconciliation worker should compare Git refs against `repository_refs` after crashes.

Builds, merges, benchmarks, and deployments are long-running state machines. API callers should receive an operation ID and poll or subscribe to durable events; they should never receive a success response merely because work was queued.

## Compatibility and rollout

- Existing listing, shelf, order, and royalty tables remain unchanged.
- Existing UI code can continue reading `app_listings.forks`, but writers should update it only from the fork graph.
- No seed repositories are inserted. Repositories must be backfilled from verified real Git storage rather than inferred from mock listing counters.
- The migration intentionally does not connect royalty settlements to lineage yet. At purchase time, a separate economic-lineage snapshot should copy the applicable ancestry so payouts cannot change retroactively.

## Next integration task

Replace the stateless CAS call in `functions/api/git.ts` with a repository service that:

1. Authenticates the actor and authorizes the repository/ref operation.
2. Loads `repository_refs` inside a D1 transaction.
3. Rejects a stale `expectedOldOid`.
4. Verifies the new object exists in Git quarantine.
5. Atomically publishes the Git ref.
6. Updates `repository_refs` and inserts `repository_ref_events` idempotently.
7. Reconciles either side if the process stops between Git and D1 commits.

