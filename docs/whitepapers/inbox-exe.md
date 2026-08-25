# INBOX.EXE

## The Async Agent Comms & Mailbox Bridge

**Status:** Architecture specification

**Edition:** 1.0 — August 2026

## Abstract

INBOX.EXE is an asynchronous communications system for conversations among
people, software agents, and repository automation. Its primary client uses a
dense three-pane, Windows 95-era Outlook layout: mailboxes at left, thread list in
the center, and the selected conversation at right. The visual metaphor is
familiar; the underlying boundary is strict. Discussion lives in a dedicated
SQLite communications database, while code history remains in Git.

Messages are Markdown documents with structured envelopes. References to code use
full Git commit object IDs (OIDs), repository identities, and optional signed
attestations. Interactive merge-proposal cards render test status and authorized
actions without turning email HTML into executable authority. Granular RBAC keeps
reading a conversation distinct from approving a Git compare-and-swap update or
deploying a container.

## Core Problem Statement

AI-assisted development produces far more intermediate dialogue than human-only
development: prompts, clarifications, rejected patches, test failures, retries,
and approval requests. Storing this conversational state in commit messages or
ephemeral chat either pollutes the permanent code history or destroys the review
record. Conventional email can carry the record, but raw email lacks a safe model
for binding a message to an exact commit and authorizing consequential actions.

INBOX.EXE separates two histories with different semantics. Git answers, “What
code became authoritative?” The mailbox answers, “Who discussed, proposed,
tested, and approved it, and with what context?” Cross-references are explicit and
immutable. Neither database is treated as a cache of the other.

The architecture enforces these invariants:

1. Message receipt never mutates a Git ref or deploys a container.
2. A rendered button is not authorization; every action is reauthenticated and
   checked server-side at execution time.
3. Code references use full OIDs and repository IDs, never an ambiguous branch
   name alone.
4. Communication retention policy cannot rewrite Git history.
5. A collaborator receives only the independently granted scopes required for a
   task.

## Architectural Design & Data Flow

### Client and service topology

```text
┌──────────────────────────────── UI ────────────────────────────────┐
│ folders/accounts │ thread list          │ conversation + cards     │
│ unread, agents   │ sender/status/time   │ Markdown, diffs, badges  │
└──────────┬───────┴──────────┬───────────┴───────────┬─────────────┘
           │                  │                       │ action intent
           v                  v                       v
┌────────────────────┐  ┌──────────────────┐  ┌────────────────────┐
│ mailbox service    │  │ provenance      │  │ authorization +    │
│ SQLite + search    │  │ resolver (read) │  │ action dispatcher  │
└─────┬────────┬─────┘  └────────┬─────────┘  └──────┬───────┬─────┘
      │        │                 │                   │       │
 SMTP/IMAP   webhooks          Git OIDs          Git CAS   deploy API
      │        │                 │                   │       │
 external mail/agents       GITSMITH or Git     GITSMITH  RIG.EXE
```

The three panes are separate read models over one normalized store. Folder and
unread counts are incrementally maintained; thread rows are paginated by stable
cursor; message bodies and card details load on selection. Keyboard navigation,
screen-reader semantics, reduced motion, and scalable contrast are contractual
despite the period styling. Untrusted HTML mail is sanitized and remote images
are blocked by default. Markdown is rendered from a conservative allowlist.

### Communications data model

SQLite stores accounts, principals, threads, messages, recipients, attachments,
labels, read state, external transport mappings, repository references, cards,
action intents, and audit events. Message bodies are immutable after acceptance;
edits append a superseding message. Per-user state such as read flags and labels
is mutable and separate from the message record.

Each accepted message receives a local monotonically increasing sequence and a
globally unique message ID. External `Message-ID`, `In-Reply-To`, and `References`
headers map SMTP/IMAP messages into local threads. Webhook deliveries require an
idempotency key and authenticated source. Duplicate ingress returns the original
result rather than creating a second message.

SQLite runs in WAL mode with foreign keys enabled. A single writer serializes
short transactions; body and attachment size limits prevent a large payload from
monopolizing it. Attachments may live in a content-addressed object directory,
with metadata and hash in SQLite, so database transactions do not copy large
blobs. Full-text search is a derived index and can be rebuilt from canonical
messages.

### Markdown thread state and Git provenance

A message body remains human-readable Markdown. Structured context travels in a
versioned envelope alongside it:

```json
{
  "schemaVersion": 1,
  "repository": "urn:gitsmith:owner/repo",
  "baseOid": "<full-git-object-id>",
  "proposalOid": "<full-git-object-id>",
  "testAttestation": "sha256:<digest>",
  "correlationId": "<uuid>",
  "supersedes": null
}
```

The message record stores a canonical-envelope hash. When signed mail or a signed
webhook is available, the signature covers that hash, sender identity, timestamp,
and message ID. INBOX resolves the OID against the named repository and displays
whether it is present, reachable, signed, and currently proposed or merged. A
later force-push cannot change what the original OID meant.

Provenance is precise but modest: an OID proves content identity, and a valid
signature binds an asserted identity to an envelope. Neither proves that the code
is correct. Test evidence and authorization are separately evaluated.

### Merge Proposal cards

Cards are typed projections, not arbitrary email markup. A `MergeProposal/v1`
card includes immutable proposal/base OIDs, changed paths, assertion IDs,
attestation digests, policy status, and action descriptors. The client fetches
fresh badge state from the source service and labels cached state with its age.

```text
┌─ Merge Proposal #184 ────────────────────────────────────┐
│ base  91c…e20     candidate  7ab…119                     │
│ ✓ typecheck  8s   ✓ unit 19s   ✓ build 11s   policy ✓   │
│ 12 files  +418/-73       attestation verified           │
│ [Review diff]  [Approve CAS]  [Reject]                   │
└───────────────────────────────────────────────────────────┘
```

Selecting `Approve CAS` creates an action intent containing card ID, expected
base and candidate OIDs, action nonce, and current principal. The dispatcher
reauthenticates the user when policy requires, loads current RBAC grants, fetches
current test and ref state, and asks GITSMITH to attempt its own policy-protected
CAS. Replay is blocked by a single-use nonce and idempotency key. If the branch
moved, the card becomes stale; INBOX never substitutes a newer candidate under an
old approval.

### RBAC and delegated authority

Roles are bundles of independently enforceable scopes. The standard roles are:

| Role | Representative scopes | Explicitly absent |
|---|---|---|
| Comms Reader | `threads:read`, `attachments:read` | send, Git approval, deploy |
| Comms Participant | reader + `messages:send` | Git approval, deploy |
| Git CAS Approver | proposal read + `git:approve-cas` on named repos/refs | deploy |
| Container Deployer | artifact read + `rig:deploy` on named environments | Git approval unless separately granted |

Grants include resource constraints, issuer, creation time, expiry, and optional
conditions such as two-person approval. Service-to-service credentials cannot be
used for interactive login. The action dispatcher passes a short-lived,
audience-bound capability to the target system; the target independently verifies
scope and policy. This prevents INBOX compromise from becoming implicit root
authority everywhere.

### Protocol bridges

SMTP delivery emits multipart text/Markdown or sanitized HTML plus a machine
attachment for structured cards. Because ordinary email cannot protect action
buttons reliably, external recipients receive authenticated links that open the
local or hosted INBOX action flow. IMAP exposes folders and messages while mapping
flags to per-user state. Webhooks use signed requests, timestamp windows,
idempotency keys, retry with jitter, and a dead-letter queue. Bridge failures do
not roll back an already accepted local message; delivery state remains visible.

## Storage & Security Guarantees

Message acceptance is a SQLite transaction: envelope, recipients, thread link,
provenance references, and audit entry commit together or not at all. WAL-aware
online backups include database and attachment manifests; restoration verifies
foreign keys and attachment hashes. Per-message canonical hashes reveal storage
corruption or unauthorized modification. Optional hash chaining or periodic
signed Merkle roots can make deletion and reordering evident without claiming an
undeletable mailbox.

Local data is encrypted through the host filesystem or an application-managed
key hierarchy. Transport uses TLS; bridge credentials and signing keys are stored
outside the message database. Search indexes, notification previews, logs, and
analytics are treated as disclosure surfaces and minimize body content. Remote
content, active HTML, tracking pixels, and unsafe attachment types are blocked or
quarantined.

Deletion is policy-driven and auditable. A user can delete communications without
rewriting referenced Git commits; legal hold, if configured, is an explicit
operator policy rather than a hidden platform behavior. Conversely, garbage
collection of a Git object may make a reference unavailable, but cannot change
the OID recorded in the message.

## Why It Must Be Open Source & Standalone

Agent communications can contain source code, credentials, personal data,
business decisions, and deployment authority. Trust cannot rest on an opaque
hosted transcript service. The storage schema, sanitization rules, signature
format, RBAC evaluator, and transport bridges must be inspectable and replaceable.
Operators choose retention and telemetry; the default installation requires no
vendor telemetry.

INBOX.EXE remains useful as a private mailbox and agent bridge with any standard
Git server, container platform, SMTP relay, or IMAP client. Interactive cards
degrade into signed Markdown and links when a peer lacks native support. It does
not require the marketplace, modding engine, forge, or runtime. Open protocols and
separate authority make the mailbox infrastructure, not a new centralized social
network.
