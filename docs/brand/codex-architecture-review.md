I’ll ground the review in the repository’s architecture docs—especially the inbox scope—and map the core flows, storage boundaries, and consistency guarantees before assessing the MVP cut.

The inbox document is a solid local single-machine prototype, but the marketplace vision changes its trust boundary substantially: multi-tenant identity, authorization, delivery, moderation, and auditability become first-class architecture—not incremental polish. I’m now tracing where Git, feature-package, commerce, and conversation state intersect.

The central consistency issue is clear: Git can be authoritative for code and immutable package payloads, but it cannot reconstruct identities, mailbox state, entitlements, prices, payout allocations, or approvals. The design needs explicit authorities plus reconciliation at Git/DB boundaries; otherwise “portable” becomes “silently inconsistent.”

## Overall verdict

The core separation is sound: **Git should carry code and technical provenance; Mailboxes should carry intent, discussion, and coordination.** REST + resumable events + standard Git transports is also the right interoperability strategy. MCP can remain an optional adapter.

However, the current artifacts are not yet a complete systems architecture. The handoff explicitly describes them as decisions “not yet written to a spec” ([handoff](/Volumes/MacMiniExtra/Projects/nate-bot/docs/HANDOFF-2026-08-25-natebot2.md:12)), while the inbox design is intentionally a localhost/SQLite prototype with no authentication or push delivery ([inbox scope](/Volumes/MacMiniExtra/Projects/nate-bot/docs/agent-inboxes-scope.md:5)). The wireframes communicate the product extremely well, but several guarantees shown there—safe undo, live compatibility, batch fan-out, permanent rev-share—need stronger definitions before implementation.

My recommendation is:

- **GO** for a tightly constrained technical alpha.
- **NO-GO** for payments, arbitrary hosted apps, or public agent mail until the consistency, security, licensing, and ledger models below are specified.

Four statements should be corrected immediately:

1. Git is authoritative for code—not for all platform metadata.
2. A purchase is an entitlement—not an authorization model.
3. Safe undo is normally a revert and redeploy—not a branch reset.
4. A 214-fork security rollout is a campaign of 214 independently committed jobs—not one atomic merge.

## 1. Architecture and feasibility

### The separation is the right abstraction

Git and Mailboxes have fundamentally different semantics:

- Git is content-addressed, branch-oriented, mergeable, and optimized for immutable technical history.
- Mail is chronological, actor-oriented, access-controlled, and optimized for context and asynchronous decisions.
- A thread should survive rebases, squashes, package revisions, and repository moves.
- A merge should not depend on whether a participant has read or replied to a message.
- Agents can communicate through a simple API without needing filesystem access to every referenced repository.

That gives the platform clean portability: users can export code without exporting private conversations, while conversations can link permanently to immutable package versions and commits.

The key rule should be:

> Mail may request, discuss, or report an operation. Only the relevant domain API may authorize and commit it.

A mailbox reply saying “looks good” must not implicitly land code. It should lead to an explicit merge approval request authenticated against the exact preview.

### Recommended system boundaries

Start with a modular control-plane application, not a fleet of microservices, while retaining three hard security/process boundaries:

```text
Web / CLI / agents
        |
        +--> Control-plane API --> Postgres + transactional outbox
        |          |                         |
        |          |                         +--> WebSocket/event feed
        |          +--> Mailbox, catalog, lineage, entitlement modules
        |
Git clients --> Git gateway --> bare repository store
                                ^
                                |
Control plane --> merge orchestrator --> sandboxed workers
                                           |
                                           +--> preview refs, logs, attestations
                                           +--> compare-and-swap target ref update
```

The Git gateway and untrusted execution workers deserve separate processes from the main API. Mailboxes can initially remain a control-plane module.

### Define authority explicitly

| Information | Authoritative store |
|---|---|
| Commit objects, branch heads, immutable feature payloads | Git |
| Identity, roles, ACLs, mailbox membership | Postgres |
| Fork-creation facts and economic ancestry | Postgres |
| Merge jobs, attempts, approvals, queue state | Postgres |
| Threads, messages, delivery/read state | Postgres |
| Orders, entitlements, royalty allocations, ledger | Postgres |
| Build logs, screenshots, test artifacts | Object storage |
| Search indexes, rankings, counters, compatibility caches | Rebuildable projections |

The claim that the metadata database is wholly rebuildable from repositories should become:

> Git-derived catalog and provenance indexes are rebuildable. Identity, authorization, communication, commerce, and audit records are durable platform state.

Prices, payouts, users, upvotes, mailbox reads, refunds, and approvals cannot safely be inferred from Git history.

### Strongest architectural advantages

- **Portability:** package payloads and accepted changes remain ordinary Git objects.
- **Auditability:** every merge attempt can name exact input and output OIDs.
- **Independent scaling:** tests and AI merges scale separately from mailbox reads and marketplace traffic.
- **Failure isolation:** a mailbox outage does not stop Git operations; a merge-worker outage does not lose discussion.
- **Universal clients:** REST, Git, and a CLI cover browsers, scripts, humans, and agents.
- **Consumer/developer layering:** both UI modes act on the same underlying objects.

### Principal failure modes

1. **Git/DB drift.** A process can die after updating a Git ref but before marking the database job complete. Every cross-boundary workflow needs idempotency and reconciliation.

2. **Direct pushes bypassing the queue.** XTREME users cannot have unrestricted pushes to protected refs while the platform promises serialized landings. Allow direct pushes to working branches; require the queue for protected release branches.

3. **Untrusted execution.** Importing a repository and running its tests is remote-code execution by design. Workers need ephemeral filesystems, no platform secrets, restricted networking, resource limits, dependency controls, and strict timeouts.

4. **Runtime complexity.** A repository is not automatically a working app. Web forks need a deployment contract covering runtime, build command, health check, environment schema, migrations, seed data, secrets, resource limits, and rollback. Parent user data and secrets must never be copied into a fork.

5. **AI nondeterminism and cost.** The real bottleneck will likely be builds/tests and model calls, not Git ref writes. “Compatibility checks for every visitor” will become a cost bomb unless they are performed on demand and cached by exact input digest.

6. **Repository storage amplification.** Bare repo per fork is simple but duplicates objects. Git alternates can corrupt descendants if an ancestor is garbage-collected. Accept duplication with quotas initially; introduce an owned shared-object layer only after measuring.

7. **Marketplace abuse.** If forks and pulls affect ranking and royalties, bots can manufacture both. Fraud prevention belongs in the initial economic design.

8. **Licensing leakage.** Publishing a feature extracted from a paid fork may expose substantial parent code. Technical provenance does not grant redistribution rights.

## 2. API and protocol surface

### REST

REST is appropriate, but long-running actions should be resources rather than synchronous requests.

Representative primitives should include:

- Principals, agents, organizations, mailboxes, mailbox memberships
- Apps, app families, repositories, forks, deployments
- Feature packages and immutable feature versions
- Merge jobs, attempts, previews, approvals, cancellations, reverts
- Threads, messages, deliveries, read state
- Orders, entitlements, allocation snapshots, ledger entries
- Audit events and resumable event cursors

For example:

```text
POST /api/v1/forks
POST /api/v1/feature-packages
POST /api/v1/merge-jobs
GET  /api/v1/merge-jobs/{id}
POST /api/v1/merge-attempts/{id}/approve
POST /api/v1/applications/{id}/revert
POST /api/v1/threads
POST /api/v1/threads/{id}/messages
GET  /api/v1/events?after={cursor}
```

Required protocol behavior:

- Return `202 Accepted` and an operation URL for provisioning, merge, build, and deployment jobs.
- Require idempotency keys for every retryable mutation, scoped by actor and route.
- Use cursor pagination; never return an unbounded complete mailbox thread.
- Use `ETag`/`If-Match` or explicit expected versions for mutable resources.
- Give every event an `event_id`, resource version, type, actor, timestamp, correlation ID, and causation ID.
- Derive `from` from authenticated identity; never trust a sender supplied in JSON.
- Publish an OpenAPI contract and stable event schema.
- Treat deletion, cancellation, retry, timeout, and partial failure as state-machine transitions rather than ad hoc flags.

### Merge concurrency

Every attempt must pin:

- `feature_version_id`
- exact package digest
- `target_repository_id`
- `target_ref`
- `expected_target_head_oid`
- build image/toolchain version
- test policy version
- model and merge-prompt/tool version
- resulting tree/commit OID

A reasonable state machine is:

```text
queued -> preparing -> running
                    -> needs_input
                    -> preview_ready -> landing -> landed
                    -> failed          \-> stale -> requeued
                    -> cancelled
```

Approval must bind to both the exact preview result and expected target head. The final landing operation must use a Git compare-and-swap ref update. If the target moved after preview generation, reject the approval as stale and rerun it.

This resolves the mailbox concurrency question:

- A thread attached to a merge job is context only.
- “Ask the agent for tweaks” creates a new numbered attempt and supersedes the prior preview.
- Reading or replying to a thread never acquires a branch lock.
- If agents require exclusive work ownership, create a separate `work_item` with claim/lease semantics.
- The merge queue remains the only arbiter of landing order.

A security-fix fan-out should be modeled as a `merge_campaign` with N target-specific jobs. Each target may have different ownership, entitlements, code, approval policy, and outcome.

### WebSockets

WebSockets should be an optimization over durable state, never the delivery guarantee.

Prefer one multiplexed `/ws/v1` connection per client, with subscriptions to inboxes, repositories, and jobs. It needs:

- A resumable cursor
- At-least-once event semantics
- Duplicate event IDs
- Reauthentication/token expiry behavior
- Backpressure handling
- A “cursor too old; refetch” response
- Authorization rechecks when mailbox or repository membership changes

Clients must fetch canonical REST state after important events. Do not assume total ordering between mailbox and merge streams.

For offline server-to-server agents, the durable REST event feed is sufficient initially; signed webhooks can be added later. MCP remains optional.

### Git transport

Use mature Git upload-pack/receive-pack implementations behind authorization and policy hooks. Do not write a Git wire protocol implementation as part of the product experiment.

Required policies include:

- Protected `main`, release, preview, audit, and feature namespaces
- Short-lived HTTPS tokens and scoped SSH keys/certificates
- Quarantine, object validation, pack limits, and repository quotas
- Explicit handling or prohibition of LFS, submodules, shallow history, oversized blobs, and force pushes
- Atomic compare-and-swap ref changes
- Reconciliation events for every accepted push
- No secrets exposed to hooks or test runners

“Paywall is access control” in the engine wireframe ([engine](/Volumes/MacMiniExtra/Projects/nate-bot/docs/wireframes/fork-marketplace-wireframes.html:1749)) is insufficient. An entitlement may grant access, but capabilities still need to distinguish read source, push branch, publish package, approve merge, administer repository, deploy, and manage billing.

### Mailbox changes required for hosted use

Keep from the local design:

- Immutable messages
- Explicit recipient deliveries
- Reply threading
- Idempotent sends
- Markdown bodies
- No mandatory MCP integration

Change for production:

- Addresses become aliases for opaque mailbox/principal IDs.
- Do not auto-create arbitrary mailboxes when someone types an address.
- Shared mailboxes need membership roles and per-member read state.
- Agent processing needs `claim`/`ack` on separate work items; “read” is not “completed.”
- Use server-assigned thread sequence numbers, not timestamps, for ordering.
- Store `reply_to_message_id`; avoid copying the complete reference chain into every message, which grows quadratically.
- Define whether newly added participants can see historical messages.
- Add blocking, muting, quotas, abuse reporting, retention, redaction, and legal deletion behavior.
- Sanitize Markdown and treat message content as untrusted prompt input.

The proposed `agent@user/app` syntax also contains `/`, which is awkward in path parameters. Keep it as a display/routing alias, but use `/mailboxes/{opaque_id}` in APIs. Handle renames through versioned aliases.

Finally, keep three concepts separate even if INBOX.EXE renders them together:

- Private/shared mailbox conversations
- Public app discussion comments
- Derived activity notifications

They have different ACL, moderation, retention, voting, and delivery semantics.

## 3. Data model and lineage integrity

The platform contains several related graphs, not one graph:

1. **Fork ancestry:** a tree established at fork creation.
2. **Feature derivation:** a DAG of feature versions derived from other versions.
3. **Feature application:** a graph showing packages applied to repository snapshots.
4. **Economic attribution:** an immutable allocation snapshot per transaction.

Do not derive one from another after the fact.

A practical relational core is:

```text
app_family -> repository -> fork_edge
feature_package -> feature_version -> ordered feature commits
feature_version + target head -> merge_job -> attempt -> application -> landed commit

mailbox -> membership
thread -> context link
thread -> message -> delivery/member read state

order -> entitlement
order -> royalty allocation snapshot -> immutable ledger entries
```

Key entities and invariants:

| Entity | Critical invariant |
|---|---|
| `principals` | Stable identity for humans, organizations, apps, and agents |
| `address_aliases` | Mutable human-readable address; never the identity primary key |
| `agents` | Owned by a principal, scoped to app/repository capabilities, expiring credentials |
| `repositories` | Stable family and owner; current ref index is derived from Git |
| `fork_edges` | Immutable parent, base commit, creator, and timestamp; child has one ancestry parent |
| `fork_closure` | Derived ancestor/depth table for fast queries |
| `feature_packages` | Stable identity independent of display name |
| `feature_versions` | Immutable package digest, source repo, base, payload, manifest, signature, license |
| `feature_version_commits` | Exact ordered commit list; never infer solely from `A..B` |
| `merge_jobs` | Requested operation against one target and expected head |
| `merge_attempts` | Reproducible inputs, result OID, test attestation, logs |
| `feature_applications` | Landed commit, active/reverted status, source version and attempt |
| `thread_context_links` | Typed link to repository, feature version, merge job, application, or commit |
| `orders`/`entitlements` | Commercial transaction separate from permissions |
| `allocation_snapshots` | Frozen beneficiaries, policy version, percentages, and amounts |
| `ledger_entries` | Append-only double-entry entries, including refund/chargeback reversals |
| `domain_events`/`outbox` | Reliable notification, indexing, and reconciliation source |

### Feature package integrity

A ref alone identifies a tip; it does not fully describe a safe package. A range such as `A..B` may contain unrelated reachable commits and does not encode arbitrary commit selection.

At publication, create an immutable canonical package with a manifest containing at least:

- Package and version IDs
- App-family ID
- Source repository
- Original and canonical commit OIDs
- OID algorithm
- Base OID and exact ordered patch series
- Package/result tree digest
- Dependencies and conflicts
- Runtime/toolchain compatibility
- Declared migrations and external capabilities
- Test expectations
- Author/provenance records
- License and redistribution policy
- Platform publication signature

Protect the published ref from mutation and retain its objects through hidden retention refs. Repository deletion must not garbage-collect a package that has buyers, applications, or payout history.

Land each accepted application as one identifiable integration commit with signed trailers referencing the package, job, attempt, source OIDs, and test attestation. That gives the consumer a single revert target while retaining the source package separately.

### Git/DB transaction boundary

Git and Postgres do not share a transaction. Use this pattern:

1. Persist the merge intent.
2. Produce a preview ref.
3. Record authenticated approval.
4. Atomically compare-and-swap the target Git ref.
5. Finalize the database application record.
6. Emit domain events through the outbox.

If the process dies between steps 4 and 5, a reconciler reads the landing commit’s job trailer and completes the database record. Mailbox notifications are generated idempotently from that finalized event.

### Rev-share integrity

Economic ancestry must be captured when the fork is created and allocations frozen when a charge occurs. Never recalculate historical payouts from the current fork tree.

Also define before launch:

- Maximum rewarded ancestry depth
- A fixed creator pool that cannot grow beyond 100%
- Treatment of feature dependencies and multi-parent derivations
- Self-forks, wash trading, refunds, chargebacks, transfers, deletions, and banned accounts
- Whether recurring invoices reuse or recalculate a policy
- Whether reverting a feature affects prior or future attribution

A capped, versioned policy is much safer than “every ancestor forever.” Transfers or rebases must never silently change historical beneficiaries.

## 4. Tight MVP and execution roadmap

The smallest credible validation is:

> One constrained web-app family, three divergent forks, one reusable feature, a real merge preview, explicit acceptance, and a successful revert—all without exposing Git terminology to the consumer.

### Architecture spike

Before product construction, prove these cases:

- Publish an exact immutable package from selected changes.
- Apply it cleanly to one fork.
- Semantically adapt it to a divergent fork.
- Advance the target between preview and approval and verify stale rejection.
- Crash after Git CAS but before DB completion and verify reconciliation.
- Revert and redeploy the application.
- Delete the source fork and verify the published package remains available.

### Technical alpha

Include:

- One curated, constrained web runtime and deployment manifest
- Human and delegated agent identities
- Bare repositories with Git-over-HTTPS
- Protected branches and a per-target merge queue
- A limited hosted prompt-driven modification flow—not a general browser terminal
- Free, immutable feature packages
- Clean cherry-pick first; one sandboxed AI merge path for conflicts
- Test results, plain-English diff, preview, approve, and revert
- Fork ancestry and feature provenance views
- Minimal mailbox threads linked to merge jobs
- Durable REST events plus WebSocket wakeups
- Audit logging, quotas, backup, and reconciliation
- Consumer UX that hides Git, with raw OIDs/diffs available in XTREME mode

Defer:

- Subscriptions and multi-level live payouts
- Ads or ad scaffolding
- iOS/TestFlight
- BYOM keys and arbitrary hosted terminals
- Public app ingestion
- Global search, rankings, streaks, and editorial tooling
- Public discussions and unsolicited direct mail
- SSH transport, if HTTPS clone/push is enough for the alpha
- LFS, submodules, arbitrary runtime stacks
- Speculative merges and large fan-out campaigns
- Three-way replicated repo storage and multi-region operation

### Market alpha

Once the merge loop is reliable:

- Seed three to five curated app families.
- Recruit a small set of makers and nontechnical users.
- Measure whether users understand package provenance, preview, and undo.
- Add one-time checkout only.
- Compute full lineage allocations in a shadow ledger before paying them.
- Add actual payouts only after refunds, identity verification, taxation, and fraud behavior are understood.

The core success metrics are not launch-day votes. They are:

- Consumers complete fork → change → publish → pull → undo without Git help.
- Features are reused across genuinely divergent forks.
- Users accept AI-adapted previews without manual code intervention.
- Stale or unauthorized previews never land.
- Reverts restore both code and the deployed release.
- Merge latency and cost remain viable under real test workloads.
- Users return because their fork network produces useful updates.

## 5. Concrete recommendations and pitfalls

### Required before implementation

1. Write formal state machines for fork provisioning, package publication, merge attempts, deployment, checkout, entitlement, and payout.

2. Produce a capability matrix for humans, teams, agents, shared inboxes, repositories, refs, deployments, and billing.

3. Define a versioned `ownhand.yaml` app/deployment contract and a signed feature-package manifest.

4. Create a threat model covering malicious repositories, test execution, dependency downloads, prompt injection, secret theft, package exfiltration, mailbox spam, and ranking fraud.

5. Define the legal meaning of “own”: source access, modification rights, redistribution, hosting, updates, cancellation, export, and paid-feature inheritance.

6. Make the merge commit—not the mailbox thread or DB status—the technical landing point, protected by CAS and followed by reconciliation.

7. Make safe undo a compensating operation: revert commit plus deployment rollback. Ban irreversible database migrations from the first MVP.

### Pitfalls to avoid

- Building a custom Git storage engine or wire protocol before validating feature reuse.
- Treating Git authorship or hashes as proof of human identity.
- Letting raw pushes update protected refs outside the queue.
- Running imported tests with platform credentials or unrestricted networking.
- Treating an AI-generated passing build as proof of correctness or safety.
- Recomputing royalty history from a mutable ancestry graph.
- Using shared-mailbox “read” state as agent work acknowledgment.
- Mixing private mail, public comments, and notifications in one authorization model.
- Executing commands inferred from Markdown messages without explicit authenticated confirmation.
- Advertising GitHub-beating reliability before publishing representative benchmarks and operating SLOs.
- Baking advertising into “owned” software before the trust and economic model is proven.
- Attempting marketplace, Git hosting, arbitrary cloud deployment, agent runtime, social network, and multilevel payments in the same release.

The strongest version of this product is not “GitHub plus email.” It is a three-part contract:

- Git preserves the software artifact.
- The merge application record preserves how it changed.
- Mailboxes preserve why people and agents decided to change it.

That center—the immutable package plus CAS-protected application transaction—is the piece to specify and prove first.