# GITSMITH

## The Bare Git Forge & 41-Second Semantic Merge Engine

**Status:** Architecture specification

**Edition:** 1.0 — August 2026

## Abstract

GITSMITH is a self-hosted Git forge optimized for concurrent human and AI changes.
Repositories remain standard bare Git repositories served over SSH on port `22`.
Every proposed merge is tested in a disposable, sandboxed worktree. Publication
uses Git's atomic compare-and-swap primitive, `git update-ref <ref> <new> <old>`,
so a result can advance a branch only if the branch still points to the exact base
that was tested.

The semantic merge engine may synthesize a resolution, but it cannot bypass the
publication invariant. If the target moves during testing, the candidate is
obsolete: it is rebased or recomputed, tested again, and offered against the new
head. A WebSocket feed at `/ws/merge-queue` distributes queue state without
turning a long-held mutex into the concurrency model. The advertised 41-second
merge is a benchmark target and observable service metric, not a waiver of tests.

## Core Problem Statement

Conventional merge queues serialize work around a mutable target branch. At AI
agent cadence, a test run that holds a logical branch lock causes head-of-line
blocking; a run that does not revalidate the head risks publishing a candidate
built against stale code. Textual conflict resolution compounds the problem: two
changes can merge cleanly while violating a shared type, behavior, or invariant.

The essential safety question is narrow: how can many speculative merges execute
concurrently while exactly one valid successor advances a branch? GITSMITH treats
test execution as speculative and ref publication as a single atomic decision.
This removes lock starvation from expensive work. Contention is paid only at the
CAS boundary, where losers are rescheduled with fresh inputs.

GITSMITH enforces these invariants:

1. A protected ref advances only through server-side policy and atomic CAS.
2. The published tree is byte-for-byte the tree whose required assertions passed.
3. A candidate tested against old head `H` cannot publish if the ref no longer
   equals `H`.
4. Queue events are informative; the repository ref database is authoritative.
5. Generated semantic resolutions retain machine-verifiable provenance.

## Architectural Design & Data Flow

### Repository and access plane

```text
 developer/agent
       │ Git+SSH :22
       v
┌───────────────────────┐      enqueue       ┌──────────────────────┐
│ restricted SSH front  │───────────────────>│ merge coordinator    │
│ key -> principal/RBAC │                    │ leases + scheduling  │
└──────────┬────────────┘                    └───────┬──────────────┘
           │ Git objects                             │ candidates
           v                                         v
┌───────────────────────┐                    ┌──────────────────────┐
│ bare repository       │<──object promote──│ sandboxed worktrees  │
│ objects + refs + logs │                    │ merge/test/sign      │
└──────────┬────────────┘                    └───────┬──────────────┘
           ^                                         │ evidence
           │          atomic update-ref CAS          │
           └─────────────────────────────────────────┘
                             │
                             v
                    /ws/merge-queue events
```

The SSH front end maps each public key or short-lived SSH certificate to a
principal and executes an allowlisted Git command (`upload-pack` or
`receive-pack`) against a resolved repository path. There is no general shell.
Path traversal, option injection, and symbolic-link escapes are rejected before
process launch. Protected refs reject direct pushes; accepted proposal refs are
immutable or append-only according to policy.

Bare repositories are canonical storage. Service metadata—proposal state, test
runs, leases, and event offsets—lives outside repository objects and can be
rebuilt from signed reports and ref state where practical. Git hooks are small
policy adapters; they do not perform long test runs while holding receive-pack
resources.

### Speculative semantic merge

A proposal names immutable input OIDs: target head `H`, one or more proposal tips
`P`, merge policy version, and required test profile. The coordinator creates a
detached worktree or clone backed by a read-only object pool, then computes a
candidate `C`.

The first merge pass uses Git's ordinary structural machinery. For unresolved or
semantically suspicious regions, an AST-aware adapter supplies symbol changes,
types, ownership boundaries, and relevant tests to the selected merge worker.
An AI worker can propose a resolution, but the resulting files are reparsed and
checked for conflict markers, unintended path changes, generated-file drift,
dependency expansion, and policy violations.

The sandbox then runs the repository-defined assertion DAG. Independent jobs run
in parallel; dependent jobs wait for their prerequisites. Every job has an image
digest, command, environment allowlist, resource budget, timeout, and artifact
policy. Network is disabled by default. A candidate commit is created only after
the worktree is clean and required jobs pass.

### The CAS publication boundary

Publication is equivalent to:

```sh
git update-ref refs/heads/main <candidate-C> <tested-base-H>
```

Git locks the ref transaction briefly and updates it only if its current value is
still `H`. Success linearizes the merge. Failure means another candidate won; it
does not mean the losing candidate is unsafe in isolation. GITSMITH marks it
stale, retains reusable test evidence where input hashes allow, computes a new
candidate against the new head, and reruns every assertion invalidated by the new
dependency closure.

For changes to multiple refs, GITSMITH uses Git reference transactions so all
updates commit or none do. Reflogs and append-only publication records preserve
the old/new OID pair, proposal identity, actor, policy, and evidence digest.

### Lock-free queue semantics

“Lock-free” describes scheduling, not the absence of Git's short internal ref
locks. The coordinator never holds a branch-wide application mutex during merge
or test execution. Queue entries are immutable intents. Workers claim bounded
leases; expired work may be duplicated safely because publication is idempotent
at the CAS boundary.

Priority is determined by a documented policy with aging to prevent starvation.
Multiple candidates may test against the same head. The first valid CAS wins;
others are re-evaluated. Under sustained load, adaptive batching can construct a
candidate from compatible proposals, while per-proposal bisection identifies the
failing member if the batch fails.

`/ws/merge-queue` emits ordered events such as `enqueued`, `leased`, `testing`,
`stale`, `published`, and `failed`. Clients resume with the last observed event
sequence. Events include queue-local monotonic IDs and repository OIDs, but clients
must confirm final truth by reading the protected ref. Backpressure coalesces
transient progress while never dropping terminal state.

### Cryptographic provenance

Candidate commits carry canonical Git trailers identifying proposal OIDs, tested
base, test-report digest, policy version, worker identity, and semantic-merge
engine. Trailers are metadata; the cryptographic guarantee comes from signing the
commit or an attached attestation whose payload includes the commit OID and those
fields. Keys are short-lived where possible, rooted in an operator trust store,
and rotated without rewriting history.

GITSMITH distinguishes the author, proposer, merge worker, test runner, approver,
and publisher. A valid worker signature proves which identity produced an
attestation; it does not by itself grant publication authority. Protected-ref
policy checks signature chain, approval scope, required job set, and freshness
before attempting CAS.

### The 41-second objective

Forty-one seconds is defined as the median elapsed time from an eligible queue
entry to successful CAS under a published reference workload and warm worker
pool. The dashboard also reports p50, p95, queue wait, merge synthesis, test time,
CAS retries, stale rate, and cold-start results. Repositories with longer mandatory
test suites will exceed the target. GITSMITH optimizes through parallel tests,
content-addressed caches, dependency-aware invalidation, and warm sandboxes; it
never reports “merged” before required evidence exists.

## Storage & Security Guarantees

Git objects are content-addressed and immutable. Protected refs are the mutable
authority and change only through atomic ref transactions. Repository maintenance
preserves objects reachable from refs, active proposal leases, and a configurable
recovery horizon. Backups include repositories, ref/reflog state, policy, and the
attestation log; restorations are verified with Git object checks before service.

Test inputs are untrusted. Sandboxes use unprivileged identities, read-only base
images, isolated namespaces, resource limits, ephemeral writable layers, disabled
privileged mounts, and default-deny egress. Repository secrets are unavailable to
ordinary tests. Release jobs receive narrowly scoped, short-lived credentials only
after code tests pass. Artifacts and logs are size-limited and scrubbed.

CAS guarantees that a stale candidate cannot overwrite a newer ref. Required
assertions guarantee only what those assertions specify; semantic merging cannot
mathematically guarantee correct product behavior. GITSMITH therefore records the
precise tests, inputs, tools, and policies behind each publication rather than
making an unqualified “AI-safe” claim.

## Why It Must Be Open Source & Standalone

Git's durable advantage is that repositories are ordinary, cloneable objects, not
records trapped behind a hosting API. A high-integrity merge engine should retain
that property. Operators must be able to inspect the server hooks, scheduler,
sandbox policy, signature verification, and exact CAS logic that protects their
code.

GITSMITH works as a conventional SSH Git remote even when every other Nate's
Software service is absent. Its repositories can be cloned into another forge,
and its attestations use documented formats. SLOPSHOP can supply richer feature
metadata, INBOX.EXE can supply approval, and RIG can consume a built image, but
none is necessary to host or merge code. The forge remains a tool a developer can
run, audit, repair, and leave.
