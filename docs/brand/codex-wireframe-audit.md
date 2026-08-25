## Verdict

The [79-screen deck](/Volumes/MacMiniExtra/Projects/nate-bot/docs/wireframes/fork-marketplace-wireframes.html:150) is a strong happy-path product architecture, but it is not yet airtight for front-end implementation.

Structurally:

- All 79 slide IDs are unique and every `jump()` target resolves.
- The deck contains 75 product views, plus cover/map/direction material.
- Excluding the deck map, 19 product views have no in-product incoming path.
- 17 product views have no in-product exit.
- Most async systems—payments, provisioning, containers, publishing, webhooks, moderation, payouts—show only their success or canonical state.

The global slide arrows make the deck browsable, but they conceal product-level dead ends.

## Most important architectural corrections

### 1. INBOX and Git are not fully separated yet

The intended boundary is good, but two screens currently blur it:

- INBOX proposal approval jumps directly into the merge queue.
- The merge-progress screen says the CAS lock is acquired before final human approval.
- Shared-inbox permissions combine “Read / Write / Merge,” conflating mailbox, repository, runtime, and deployment authority.

The clean state sequence should be:

`INBOX proposal/intent → MergeIntent(expected target OID) → preview ref + tests → authenticated approval → short CAS update-ref → deployment job → outbox status reply`

INBOX should own conversation, intent, approval provenance, and delivery. Git should own refs, previews, conflicts, CAS, commits, and rollback. Deployment should be a third, independently visible state: a merge can succeed while deployment fails.

Required changes:

- Add immutable IDs and cross-links for thread, merge intent, preview OID, target OID, job, final commit, and deployment.
- Split permissions into Mailbox, Repository, Approval, Merge, Deploy, Runtime, and Secrets scopes.
- Make notification-center merge notices pointers to INBOX threads rather than duplicate communication objects.

### 2. Pricing and lineage rules are contradictory

The same product is shown as:

- Free
- `$0 / $15 Pro`
- `$20`
- `$0 hosted with one month of compute`

Royalty rules alternate between `60/30/10`, `20/10`, and `20/10/5`. A `$5` feature purchase goes directly from feature detail to merge without checkout.

Before implementation, define one versioned commercial matrix covering:

- App entitlement price
- Managed-hosting price and quotas
- Feature-package price
- Subscription versus one-time purchase
- Platform fee
- Ancestor split by generation
- Tax, currency, rounding, refunds, chargebacks, and policy effective dates

Every transaction must persist the exact pricing and lineage-policy version used at purchase time.

### 3. The fork sequence is incorrectly universal

The current [fork/checkout sequence](/Volumes/MacMiniExtra/Projects/nate-bot/docs/wireframes/fork-marketplace-wireframes.html:1179) forces every user through `$0 checkout → AI agent chooser → hosted provisioning`, even when they selected a local clone or are a non-technical hosted user.

Use conditional branches:

`Fork CTA → auth gate/resume → entitlement + deployment choice → paid checkout if needed → create repo → hosted provision OR local clone instructions → success → optional agent handoff`

The agent chooser belongs after the repository exists and must be optional.

### 4. The feature-pull flow bypasses required safeguards

Current paths skip target selection, compatibility, and payment:

`Feature detail → Merge`  
`App feature catalog → Diff → Merge`

The complete flow is:

`Feature detail → select target fork → compatibility report → purchase/entitlement → merge-intent summary → preview/tests → approve → CAS → deploy → receipt + INBOX update`

### 5. “Own your software” needs an explicit ownership model

The promise that the platform cannot turn off an app conflicts with managed hosting and administrative freezes. Distinguish:

- Immutable authorship/provenance
- Current repository owner
- Current maintainer
- Hosting/billing owner
- Revenue beneficiary
- Public-listing status
- Export rights
- Moderation status

Deleting or transferring a fork must never erase lineage. Deleted ancestors need durable tombstones so descendants, attribution, and historical ledger entries remain valid.

## Role journey gaps

| Persona | Major missing closure |
|---|---|
| Non-technical buyer | Auth-and-resume, ownership/license explanation, hosting costs, payment failures, runtime recovery, support/refund, full export, transfer/delete |
| AI modder | Target-fork selection, paid feature entitlement, working-tree review and commit, stale-head/rebase handling, merge-versus-deploy results |
| Base creator | Repository import, compliance/security preflight, listing preview/review, rejection workflow, published-product management, feature-package lifecycle |
| Platform admin | Actionable case/job/transaction detail, user administration, DMCA lifecycle, disputes, incident controls, dual approval, audit history |

The largest modder gap is after Live Preview: AI modifies the working tree, but there is no “review changes → commit → deploy → package feature” path.

## Exact additional screens and substantial variants

### Auth and onboarding

- **A5 — Auth Gate & Resume Intent:** Preserve the selected app, feature, fork node, or upvote through login.

- **A6 — Email Verification / OAuth Conflict / Recovery:** Magic-link sent, expired link, existing-account collision, provider failure, and recovery.

- **A7 — SSH & Agent Device Setup:** Add an existing public key, generate/download once, verify, revoke, or skip.

- **A8 — Access Interrupted:** Session expired with form preservation; suspended, banned, region-restricted, or DMCA-limited account.

### Discovery and app detail

- **B7 — Collection Detail:** Actual collection contents, curator, save/follow, share, sorting, and empty collection.

- **B8 — Upcoming Launch Calendar and Launch Detail:** Nomination/hunt attribution, launch time, reminder, discussion, upvote guard, and launch-ended state.

- **C9 — Trust, License & Requirements:** Ownership rights, redistribution license, privacy/network permissions, supported runtime, compute requirements, maintenance status, SBOM/security scan, vulnerabilities, refund/support policy.

- **C10 — Write Review / Ask Question:** Sign-in guard, composer, rating, edit/delete/report, validation, and moderation status.

- **C11 — Listing Unavailable:** Private, removed, frozen, deprecated, unsupported, or creator-banned variants with entitlement-safe next actions.

All eight existing App Detail screens need the same persistent tab shell. Releases, comments, source, and economics are currently terminal views.

### Feature Bazaar and acquisition

- **D5 — Target Fork Selector:** No owned fork, one fork, many forks, incompatible runtime, permission denied, or “fork base app first.”

- **D6 — Feature Checkout:** Price, target fork, entitlement terms, lineage split, taxes, payment method, and price-change detection.

- **D7 — Feature Receipt & Merge Handoff:** Purchase succeeded, already owned, refunded, package yanked, or start merge.

- **E6 — Provisioning Recovery:** Repository-name collision, quota exceeded, clone/build failure, unsupported stack, container crash/OOM, health-check failure, timeout, retry, cleanup, and refund.

- **E7 — Agent Handoff Result:** App launched, permission denied, client absent, deep link timed out, copy CLI command, or continue in browser.

### Software Shelf and fork operations

- **F7 — AI Change Review, Commit & Deploy:** Working-tree diff, tests, commit message, discard changes, create feature package, deploy, or send for approval.

- **F8 — Runtime, Deployments & Logs:** Build history, live logs, restart, stop, rebuild, health checks, crash loop, OOM, and quota pause.

- **F9 — Backup, Restore & Full Export:** Git bundle/ZIP, SQLite, uploaded assets, mailbox export, encrypted secrets option, background-job status, download expiration, and restore validation.

- **F10 — Usage, Plan & Billing:** CPU, memory, storage, bandwidth, free-tier expiry, upgrade/downgrade/cancel, and overage states.

- **F11 — Collaborators & Ownership:** Repository/runtime collaborators separately from shared-inbox members.

- **F12 — Lifecycle & Danger Zone:** Archive, unpublish listing, stop hosting, delete data, delete repository, or transfer ownership as distinct operations.

- **F13 — Orphaned/Frozen/Tombstoned Fork:** Select a new upstream, continue independently, export, appeal, or inspect preserved lineage.

The Shelf itself also needs first-app, archived, filtered-zero, load-error, access-revoked, offline, and partially provisioned states.

### Git and merge engine

- **G7 — Merge Intent & Authorization Summary:** Source package, target ref, expected OID, price/entitlement, migrations, secrets required, approval authority, and expiry.

- **G8 — Queued / Waiting / Reconnecting:** Queue position, estimated wait, cancel, background continuation, reconnect, and notification preference.

- **G9 — Stale Head / Rebase Divergence / CAS Lost:** Show commits added since preview; rebase and retest, select another target, or abandon.

- **G10 — True 3-Way Resolver:** Base, ours, theirs, resolved result, per-hunk choice, resolved counter, AI rationale, manual editor, and rerun tests. The current “3-way” view only shows two versions.

- **G11 — Merge Commit Succeeded / Deploying:** Final commit OID and independent deployment progress.

- **G12 — Deployment Failed After Successful Merge:** Retry deployment, inspect logs, revert commit, or leave code merged.

- **G13 — Merge History & Job Detail:** Intent, approvals, tests, logs, conflicts, commit, deployment, rollback, and linked INBOX thread.

Branches from merge progress must explicitly reach conflicts, failed tests, timeout, cancellation, stale head, success, and deployment failure. The current [merge suite](/Volumes/MacMiniExtra/Projects/nate-bot/docs/wireframes/fork-marketplace-wireframes.html:1549) does not connect its conflict or failure views.

### Creator Studio and publishing

- **H7 — Connect Repository & Runtime Configuration:** Import/create source, visibility, branch, build/start commands, ports, storage, and demo environment.

- **H8 — Publish Preflight:** Build, tests, secrets scan, malware scan, license compatibility, provenance, required metadata, accessibility, and data/privacy checks.

- **H9 — Listing Preview & Submit:** Exact marketplace preview, ownership terms, launch summary, and submit-for-review confirmation.

- **H10 — Review Lifecycle:** Draft, submitted, under review, changes requested, rejected, approved, scheduled, published, and launch failed.

- **H11 — Published Product Management:** Edit listing, release new version, change price prospectively, pause sales, unpublish, transfer, archive, and deprecate.

- **H12 — Product Analytics:** Views, conversion, forks, feature pulls, retention, refunds, child lineage, and launch performance.

Replace the single Feature Package screen with:

- **H13 — Package Metadata & Compatibility Scope**
- **H14 — Commit/Dependency Selection**
- **H15 — Tests, Migrations, License & Security Attestation**
- **H16 — Price, Lineage Split & Versioning**
- **H17 — Preview, Sign, Publish Result, Deprecate/Yank**

### Accounts, purchases, payouts, and ledger

- **I5 — Security, Sessions, SSH Keys, BYOM and Billing Tabs:** The current settings view only implements one API-key field despite promising all of these areas.

- **J6 — Purchase History Index:** Filters and statuses leading to the existing receipt detail.

- **J7 — Creator KYC/Tax Onboarding:** Not started, pending, additional information, rejected, restricted, verified.

- **J8 — Payout Activity & Statements:** Pending/available balance, transfer history, downloadable statements, currency, tax withholding.

- **J9 — Payout Exception:** Failed bank transfer, payout hold, negative balance, refund after settlement, or account restriction.

- **J10 — Buyer Refund Request & Status:** Eligibility, reason, partial/full refund, pending review, approved, declined, completed.

- **J11 — Ledger Transaction Detail:** Balanced journal entries, transaction lineage snapshot, policy version, refund/chargeback links, settlement, and immutable audit trail.

### INBOX.EXE

- **M7 — Invite Collaborator:** User/email, mailbox role, Git/runtime permissions shown separately, expiry, and message.

- **M8 — Invitation Acceptance:** Accept, decline, expired, revoked, already a member, or recipient account required.

- **M9 — Dispatched Agent Task Status:** Queued, acknowledged, working, waiting for input, proposal ready, failed, canceled, completed.

- **M10 — Gateway/Webhook Detail & Delivery Log:** OAuth connection, endpoint, signing secret, event selection, test delivery, retries, rate limit, dead-letter, rotate, or disable.

- **M11 — Proposal Lifecycle:** Draft, sent, preview building, ready, stale, superseded, revoked, rejected, approved, merging, merged, deploy failed.

Existing thread detail also needs reply, participants, attachments, resolve/reopen, provenance links, and action history. “Dispatch Task” should land on the created thread/job, not silently return to the inbox.

### Admin and editorial

- **L7 — Moderation/DMCA Case Detail:** Reporter, evidence, provenance tree, affected descendants, notice timeline, freeze scope, counter-notice, decision, appeal.

- **L8 — Affected User/App Notice:** User-facing freeze reason, allowed actions, export rights, payout escrow, appeal, and reinstatement.

- **L9 — User, Organization & Role Administration:** Suspend, ban, restore, impersonation controls, sessions, entitlements, and admin RBAC.

- **L10 — Payment Dispute / Chargeback Console:** Evidence, escrow impact, lineage reversal preview, negative balance, decision, and webhook history.

- **L11 — Worker Job Detail:** Logs, resource use, cancel/retry, quarantine input, drain worker, and incident link.

- **L12 — Incident Detail & Maintenance Controls:** Acknowledge, owner, timeline, degraded-mode banner, maintenance mode, resolution.

- **L13 — Administrative Audit Log:** Actor, reason, before/after, linked case, export.

- **L14 — Policy Change Preview & Dual Approval:** Effective date, affected future transactions, dry run, second approver, rollback plan. Fee changes must not mutate historical ledger records.

- **N5 — Editorial Submission Detail & Decision**
- **N6 — Creator Review Request & Status**

## Required action dialogs

At minimum, add these explicit dialogs:

- Transfer fork ownership, followed by recipient acceptance
- Archive, unpublish, stop hosting, and permanent deletion as separate confirmations
- Export full ZIP/SQLite/data backup with completion and expiration states
- Restore snapshot with affected-data preview
- Invite/remove collaborator and revoke agent capability
- Add/edit/delete/reveal secret, including restart impact
- Stop/restart/rebuild container and OOM recovery
- Detach/replace domain and SSL issuance failure
- Approve merge with target OID, test age, migration impact, and cost
- Reject proposal with optional reason
- Cancel merge job
- Rebase and rerun preview
- Refund confirmation and refund-ineligible explanation
- Report listing / submit DMCA notice
- Freeze, unfreeze, suspend, ban, and reinstate with reason and audit confirmation
- Create/test/retry/rotate/disable webhook
- Deprecate or yank a feature package
- Session-expired reauthentication and unsaved-changes protection
- Policy-change dual approval

Every destructive or financial dialog needs processing, success, failure, duplicate-submit protection, and an explicit resulting destination.

## Cross-cutting state matrix

Every relevant component should receive these variants:

| Object | Required states |
|---|---|
| Feed/table | Loading, empty, filtered-zero, pagination/end, offline, permission denied, server error/retry |
| Form | Pristine, validation error, saving, saved, duplicate, server conflict, unsaved changes, expired session |
| Payment | Calculating, processing, 3DS, declined, canceled, network retry, price changed, duplicate/idempotent success, refunded |
| Provision/container | Queued, building, booting, healthy, degraded, crashed, OOM, quota-paused, timed out, restarting, cleanup failed |
| Fork/listing | Draft, active, private, paused, transferred, orphaned, frozen, archived, deleted tombstone |
| Merge | Intent, queued, previewing, conflict, tests failed, stale, approved, CAS lost, committed, deploy failed, rolled back, canceled |
| Message/webhook | Draft, queued, delivered, bounced, failed, retrying, dead-lettered, expired, revoked |
| Payout/moderation | Pending, held, failed, negative balance, disputed, frozen, appealed, reinstated |

Empty states are specifically missing across discovery, search, collections, shelf, creator studio, notifications, payouts, INBOX, moderation, and editorial queues.

## Navigation repairs

The current product graph needs these concrete fixes:

- Add a persistent marketplace shell linking Discover, Collections, Feature Bazaar, Editorial, Shelf, Creator Studio, Payouts, INBOX, Notifications, and Profile.

- Repeat the App Detail tab bar on all eight app screens.

- Connect Collections, Pulse, Top Makers, component categories, feature compatibility, Shelf, Notifications, Purchases, Refunds, XTREME views, Admin Fee, and Editorial views from real product navigation—not only the flow map.

- Route Feature Bazaar through target selection, compatibility, checkout, and merge intent.

- Route Terminal/Preview into Change Review & Commit.

- Give every merge queue, lineage graph, notification, benchmark, and editorial screen an origin-aware back/next destination.

- Link Creator publishing to preview/review/status rather than returning directly to the dashboard.

- Link notifications to the relevant payout, fork, thread, or merge job.

- Add Admin Fee to the Admin hub and make moderation “Triage AST” open a case.

Notable unwired controls include OAuth buttons, Apply Filters, Download SQLite, AI Auto-Adapt, and Admin Triage. The “interactive” sandbox is also static. The global deck keyboard handler should ignore `input`, `select`, `textarea`, and editable elements so pressing Space while typing does not advance the deck.

## Definition of implementation-ready

Before handing this deck to front-end engineering, add an appendix containing state-transition and permission matrices for:

- Account/session
- Payment/entitlement
- Fork and listing lifecycle
- Container/deployment
- Merge intent/job
- Message/agent task/webhook delivery
- Payout/ledger
- Moderation/DMCA case

Each transition should name the actor, authorization, idempotency behavior, next UI, retry behavior, notification/outbox event, and audit record.

Also add responsive and accessibility variants: the eight-tab detail header, three-pane INBOX, fixed grids, large tables, and lineage graphs currently have no mobile behavior; semantic buttons, labels, focus order, keyboard operation, error announcements, and non-color status indicators are absent.

In short: the deck has the right product breadth and core metaphor. The remaining work is state-machine completeness, commercial-policy consistency, lifecycle management, and operational recovery—not more top-level feature categories.