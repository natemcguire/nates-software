# HOTWIRE

## The Daily Drops Leaderboard, Popularity Engine & Lineage Ledger

**Status:** Architecture specification

**Edition:** 1.0 — August 2026

## Abstract

HOTWIRE is a transparent discovery and economic-accounting system for forkable
software. Instead of an endless personalized feed, it operates explicit 24-hour
drop cycles. Eligible releases compete within a fixed cycle; votes contribute
through a published momentum function; maker streaks follow a deterministic state
machine; and descendant forks form a queryable directed acyclic graph (DAG).

When a descendant earns revenue, HOTWIRE records the obligation in a
double-entry, append-only royalty ledger using a cryptographically committed split
policy. Discovery and accounting share lineage identifiers but remain separate
subsystems: popularity never changes who is owed money, and payment status never
secretly boosts rank. Every consequential calculation can be replayed from
versioned inputs and public policy.

## Core Problem Statement

App marketplaces ordinarily combine discovery, identity, custody, ranking, and
revenue allocation inside one opaque platform. Creators cannot determine whether
ranking changed because of genuine use, paid placement, personalization, or an
undocumented policy. Forks further break conventional economics: a descendant
may derive substantial value from an ancestor or a portable feature, yet neither
Git history nor a payment processor expresses an enforceable revenue split.

HOTWIRE separates three questions:

1. **What is eligible today?** A cycle service freezes the set and rules.
2. **What is gaining legitimate attention?** A deterministic ranking projection
   computes momentum from attributable events.
3. **Who is economically entitled?** A lineage policy compiler produces immutable
   splits, and a balanced ledger records obligations and settlement.

The architecture adopts these invariants:

1. A drop belongs to one canonical UTC cycle and cannot carry raw votes into the
   next cycle.
2. A ranking result names the exact algorithm version and event cutoff.
3. A release cannot be its own ancestor, and accepted lineage edges cannot create
   a cycle.
4. Royalty splits are frozen by policy hash before revenue is posted.
5. Every ledger transaction balances to zero in one currency and smallest unit.
6. Administrative moderation is visible and never disguised as organic rank.

## Architectural Design & Data Flow

### System topology

```text
 makers/releases     users/telemetry         Git lineage claims
       │                    │                       │
       v                    v                       v
┌──────────────┐    ┌───────────────┐     ┌──────────────────┐
│ cycle/       │    │ signed event  │     │ lineage verifier │
│ eligibility  │    │ ingestion     │     │ + DAG index      │
└──────┬───────┘    └───────┬───────┘     └────────┬─────────┘
       └──────────────┬──────┘                      │
                      v                             │
              ┌────────────────┐                   │
              │ popularity     │<──────────────────┘ descendant utility
              │ replay engine  │
              └───────┬────────┘
                      v
              daily leaderboard

 gross receipt -> split policy(hash) -> balanced journal -> payable -> settlement
                              ^                 │
                              └──── lineage DAG ┘
```

Services communicate through append-only event envelopes with event ID, subject,
actor, event time, ingestion time, schema version, source, and signature or source
attestation. Each consumer keeps an offset and idempotency table. Projections can
be rebuilt; canonical release, vote, lineage, policy, and ledger records cannot be
replaced by a projection.

### Twenty-four-hour rotation

Cycles are half-open UTC intervals `[start, start + 24h)`, named by start date.
UTC avoids daylight-saving ambiguity; clients render local time separately. A
drop submitted before the cutoff enters the next eligible cycle according to a
published grace policy. At cycle open, HOTWIRE records an immutable snapshot of
eligible release IDs, release OIDs/artifact digests, algorithm version, moderation
state, and policy hash.

Late-arriving events are accepted into the canonical log but affect a closed
cycle only within a short, disclosed finalization window and only when their
trusted event time is verifiable. After finalization, corrections append a new
revision and reason; they do not rewrite the original published result. The next
cycle starts from zero vote momentum. Historical reputation, uptime, and verified
descendant utility may enter only through bounded terms explicitly declared by
the new cycle's algorithm.

### Streak state machine

Streaks reward consistent qualified participation without contaminating the raw
daily vote count. Each maker/project pair follows a deterministic machine:

```text
             qualified drop on expected next cycle
     ┌───────┐ --------------------------------------> ┌──────────┐
     │ NONE  │                                         │ ACTIVE n │
     └───────┘ <-------------------------------------- └────┬─────┘
                 missed cycle beyond grace / invalid       │
                                                          │ qualified next
                                                          └──> ACTIVE n+1
```

States include `NONE`, `ACTIVE(n,last_cycle)`, `GRACE(n,last_cycle)`, and
`FROZEN(reason)`. Qualification rules—such as substantive release, availability,
and policy compliance—are versioned. Idempotent transition keys prevent duplicate
events from incrementing twice. Appeals create reviewed transition events; an
administrator cannot directly edit a counter.

Streak badges are displayed context, not an undisclosed score multiplier. If a
ranking version includes a bounded streak term, its cap and coefficient are part
of the public formula.

### Upvote momentum

HOTWIRE computes rank from event-derived features rather than a mutable score
column. One reference momentum version is:

```text
M(d,t) = W(d,t) × [ log1p(Uq) + α·V + β·D + γ·A − δ·R ]

W(d,t) = exp(-λ · age_hours) / exposure_correction(d,t)
```

Where `Uq` is the sum of quality-weighted unique upvotes, `V` is verified
engagement, `D` is capped descendant utility, `A` is an availability term, and
`R` is confirmed abuse risk. Coefficients, caps, thresholds, eligible event
definitions, and decay constant are versioned and published. In the simplest
policy, `λ` is zero within a daily cycle; a nonzero value emphasizes momentum but
must not make submission minute determinative.

Vote quality weights mitigate sybil attacks using coarse, auditable account and
rate-limit signals. They do not use protected traits or undisclosed personalized
profiles. One principal may cast one active vote per drop per cycle. Reversals are
events. Suspect votes enter quarantine and are excluded until resolved; the UI
shows provisional versus finalized totals.

Exposure correction is bounded because ranking affects exposure and exposure
affects votes. HOTWIRE logs impressions using privacy-preserving counters and
normalizes only enough to reduce position bias. It does not create a private
recommender loop. Tie-breaking is deterministic: momentum, then qualified unique
votes, then earlier eligibility timestamp, then stable release ID.

### Descendant fork DAG

Each release node is keyed by repository identity and immutable root OID. Edges
describe a typed derivation: full fork, feature import, or declared upstream
contribution. An edge names parent and child nodes, source commit range or feature
ref, manifest digest, claimant, verification evidence, and acceptance status.

Before accepting an edge, the lineage service verifies object or package
provenance and checks reachability. It rejects self-edges, duplicate identities,
and any insertion for which the proposed child already reaches the parent. For
large graphs, it combines adjacency indexes with generation numbers and a
maintained transitive-closure cache; the canonical edge set remains sufficient to
rebuild the index.

Multiple parents are allowed. Lineage does not infer economic percentages from
line count or ancestry depth. A separate signed split policy selects eligible
ancestors/features, assigns basis points, defines caps and termination conditions,
and resolves competing claims. Graph changes after a sale cannot retroactively
change that sale's frozen policy.

### Double-entry royalty ledger

Money is stored as integer minor units with an ISO currency; floating point is
forbidden. Each economic event creates a journal transaction whose postings sum
to zero for that currency. For a $10.00 captured sale with a $1.00 processor fee,
a $1.80 ancestor royalty, and a $7.20 descendant share:

```text
Dr  processor_clearing:cash_receivable     1,000 USD
Cr  processor_expense_payable                100 USD
Cr  royalty_payable:ancestor                 180 USD
Cr  creator_payable:descendant               720 USD
                                              --------
                                                 0 USD net
```

The exact account orientation depends on the legal entity's chart of accounts,
but the zero-sum invariant does not. Platform fees, taxes, reserves, refunds,
chargebacks, currency conversion, and payouts receive separate postings rather
than overwriting the original sale.

Before posting, the split compiler resolves the accepted lineage DAG under the
sale's contract, produces allocations totaling 10,000 basis points over the
distributable amount, applies deterministic minor-unit remainder rules, and
stores a canonical policy document. Its hash, graph snapshot root, algorithm
version, and signer set are embedded in the journal metadata. Threshold
signatures can require both creator and marketplace approval for policy changes.
Once revenue references a policy, the policy is immutable; correction uses
reversing and replacement transactions.

Settlement is downstream from obligation. Payment processor webhooks are
authenticated and idempotent, then reconciled to ledger transactions. A payout
marks a payable as settled through new postings. Failed payout does not erase the
obligation. Daily trial balances, processor reconciliation, and per-policy royalty
recomputation detect drift.

## Storage & Security Guarantees

Canonical events and journal entries are append-only at the application layer.
Database constraints enforce unique event keys, DAG edge identity, balanced
transactions, currency consistency, nonnegative basis-point allocations, and
immutable finalized policies. Periodic signed Merkle roots commit batches of
events and ledger entries to tamper-evident checkpoints. Backups include canonical
records, policy documents, signatures, and projection offsets; ranking and graph
indexes can be discarded and rebuilt.

Identity, vote, and payment systems are separated by least-privilege service
credentials. Public leaderboards expose aggregate evidence, not raw IP addresses,
payment identifiers, or anti-abuse features that would aid attackers. Administrative
actions require scoped roles, reasons, and append-only audit events. Treasury keys
and marketplace application servers occupy different trust domains.

HOTWIRE guarantees deterministic replay for a fixed event set, cutoff, and
algorithm version. It guarantees ledger balance and policy immutability under its
database and signing assumptions. It does not guarantee that popularity equals
quality, that sybil activity can be eliminated, or that cryptography resolves a
legal ownership dispute. Those limits are made visible through provisional state,
appeal records, and explicit governance.

## Why It Must Be Open Source & Standalone

Discovery rules allocate attention; royalty rules allocate money. Both are forms
of governance and must be inspectable. Open source permits creators to reproduce
a leaderboard, verify a split, audit moderation paths, and operate a compatible
market without trusting a hidden ranking service or undisclosed revenue cut.
Algorithm changes occur through versioned policy, not invisible deployment.

HOTWIRE accepts standard release identifiers, Git OIDs, artifact hashes, signed
lineage claims, and payment events. It can point to any forge, application runtime,
or communication system. Likewise, an application discovered through HOTWIRE can
be cloned and run without it. The marketplace earns trust by being optional:
portable software, portable lineage evidence, and exportable balanced journals
remain useful after the original operator is gone.
