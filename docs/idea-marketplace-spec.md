# IDEA MARKETPLACE + CONTRIBUTOR REVENUE-SHARING — Build-Ready Spec

> **⚠️ MIGRATION-NUMBER CORRECTION (mayor, 2026-08-31):** This spec was written as the Postgres add-on landed. `0027` is now TAKEN by `0027_app_postgres_addon.sql` (already applied to prod). **The contributor migration is `0028_contributor_revenue_sharing.sql`.** Every "`0027`" below that refers to the NEW contributor migration means `0028`. (Citations to *existing* migrations 0006/0009/0010/0011/0012/0024 are unchanged and correct.)


*Folds the user's marketplace framing + locked decisions onto the validated core ledger plan (contributor-plan.md). Money model unchanged from the core plan; renumbered and re-grounded against the current repo (migrations now run through 0026; several core-plan citations corrected below).*

---

## 0. The product, in one screen

A seeded **idea** is a repo that ships its own pitch: a **spec doc + business model + images**, all committed IN the repo. The marketplace renders those repo files as the listing (screenshots + spec body). The seeder puts a slice of future sales **"up for grabs"**; a builder who contributes code and gets merged is **granted** a cut of that pool by the seeder at approve time, and then **earns from every future sale, forever**, carved from the seeder's own share. A builder therefore has **two revenue streams**, both already backed by real ledger tables:

1. **Contribute-to-main → grantable pool** *(this feature)* — earn a % of the app's future sales, set by the maintainer at merge, immutable.
2. **Fork-and-sell → Lineage Ledger** *(already built)* — 70/20/10 split when your fork sells (`commerceDomain.ts:224-331`).

Both are the same money path: immutable per-order allocation rows → `commerce_transfer_outbox` → Stripe Connect. **No new payment plumbing.**

---

## 1. What carries over unchanged from the core plan (validated, do not re-litigate)

- **Perpetual carve-from-maker-remainder.** Contributor cents come out of the maker's conserved remainder (`makerCents = gross − protocol − lineage`, `commerceDomain.ts:253` root / `:284` fork). Subtracting contributor cents keeps `Σcents == gross` and `Σbps == 10000` by construction (`commerceDomain.ts:337-343`). Ancestors + protocol pool are never touched.
- **A one-time bounty is impossible without new plumbing** (protocol pool is a non-payable sink; the outbox trigger `commerce_outbox_requires_fulfilled_allocation`, migration `0010:69-86`, requires every outbox row to match a fulfilled-order allocation). Perpetual carve-out reuses every invariant. Closed by code fact.
- **Immutable economics, one-way lifecycle** `pending → active → revoked` on `contributor_shares` (economics frozen by trigger; status forward-only; revoke affects future sales only).
- **Sybil resistance is economically self-enforcing + owner-gated.** Granting to a sock puppet just moves the maker's own money to the puppet (net loss after Stripe fees). Plus owner-only mint (`inbox.ts:367`) and landing verification (`git.ts:1331-1337`). Guards: per-repo cap, reject `contributor == owner`, `UNIQUE(merge_attempt_id)`.
- **Transfer worker is role-blind** (`eventProcessor.ts:428` fan-out is the only settlement line to widen; `transferWorker.ts` pays any `destination_user_id`).

### Corrections to the core plan (grounded in the current repo — apply these)

1. **Migration number.** The core plan's `0013` is taken (`0013_commerce_refund_finalization.sql` exists; dir runs to `0026`). **The new migration is `0027`.** Verified: no migration 0013–0026 redefines `commerce_order_allocations`, `commerce_outbox_requires_fulfilled_allocation`, or `commerce_recovery_matches_order_allocation`, so the table-rebuild still recreates the 0009/0010/0012 definitions the core plan cites — just under the new number.
2. **The approve query does NOT already have the contributor id.** Core plan said "requested_by_user_id already JOINed at inbox.ts:229" — that is the *submit_proposal* query. The **approve** load query (`inbox.ts:351-363`) selects neither `mj.requested_by_user_id` nor `m.sender_id`. `merge_jobs` IS already joined (`inbox.ts:360`), so **add `mj.requested_by_user_id AS requestedByUserId`** to that SELECT. (Equivalently `inbox_messages.sender_id`, set to the requester at `inbox.ts:259`.)
3. **Landing activation needs NO SELECT change in git.ts.** Activation keys on `merge_attempt_id` (already in scope in the completion handler), because the contributor id was written into the pending row at approve time. Core plan's "add contributor id to the SELECT at git.ts:1287-1308" is unnecessary; just add one UPDATE to the landing batch at `git.ts:1342-1357`.
4. **Landing is asynchronous.** Approve queues a `merge.approved` `forge_outbox_events` row (`inbox.ts:426-439`) and sets `merge_jobs.status='landing'`; the outbox dispatcher → GITSMITH later calls `gateway-complete-merge` (`git.ts:1267-1367`) which flips `landed`/`stale`. So "record pending on approve, activate on landed" spans two handlers — correct and already the plan's intent, but the activation lives in `gateway-complete-merge`, not inline with approval.

---

## 2. NEW surface A — the seeded-idea "available %" (grantable pool)

**Where it lives: on `repositories`, not `app_listings`.** Everything downstream is repo-scoped (`contributor_shares.repository_id`, the owner gate on `repositories.owner_user_id`, settlement fetch by `repository_id`). The listing shows it via the existing `app_listings.repository_id` join (migration `0024`).

Migration `0027` adds:
```sql
ALTER TABLE repositories ADD COLUMN grantable_bps INTEGER NOT NULL DEFAULT 0
  CHECK (grantable_bps >= 0 AND grantable_bps <= 10000);
```
`grantable_bps` is the pool the seeder puts up. **This replaces the core plan's global `MAX_CONTRIBUTOR_BPS` constant with a per-repo, user-set cap** (locked decision #2). Keep an optional platform ceiling as belt-and-suspenders, but the per-repo value is primary.

**Validation at set-time (fail-closed):** `grantable_bps ≤ (isRoot ? 9000 : 7000) − MAKER_FLOOR_BPS`. The maker slice is 9000 root / 7000 fork (`commerceDomain.ts:7,9`), so Nate's "keep a 10% floor, make 90% grantable" example is **root-only**; a fork can grant at most 7000 minus its floor. Compute `isRoot` from lineage position (`repository_forks`, migration `0006:80`).

**Where the seeder sets it:** the HOTWIRE drop submit already accepts a repo link and a full column set. `drops.ts:222` destructures the body; `drops.ts:275` reads `body.repositoryId`; the `app_listings` upsert is `drops.ts:295-332`. Add `grantableBps` to the submit body and, when the drop links/creates a repo, `UPDATE repositories SET grantable_bps=? WHERE id=?` in the same `env.DB.batch([...])` (`drops.ts:350`). The author-side editor is `PostEditorView.tsx` (the field slots next to price).

**How it displays as upside (and the two-stream story on the listing):** the listing detail is `ArtifactSandbox` (rendered as the right pane of HOTWIRE's split layout, `HotwireView.tsx:526-542`; it is NOT a modal). Add a badge near the price (`ArtifactSandbox.tsx:371`) reading **"Up to N% of every sale available to contributors"** where `N = grantable_bps/100`. Present it **beside the existing fork entry point** (`ForkWithAiModal`, launched from the sandbox) so both builder paths are visible at once: *contribute-to-main → earn from this pool* vs *fork-and-sell → 70/20/10 Lineage Ledger* (locked decision #3). The drops GET already carries repo fields into each drop (`drops.ts:139-184`); add `grantable_bps` to the SELECT (`drops.ts:28-61`) so the client has it. Fail-closed rule: a listing with `repository_id IS NULL` has `grantable_bps` effectively 0 — no pool, no grants possible.

**Mayor decision (flag, don't decide):** can the seeder change `grantable_bps` after project-add? Safe default: **raisable anytime; lowerable only to ≥ SUM(active+pending granted bps)** so you can't strand existing grants. Enforce in the same UPDATE handler.

---

## 3. NEW surface B — the grant control at approve-and-merge

**The real button is "Approve Exact OID"** (`InboxView.tsx:766-773`), not "APPROVE & MERGE CAS REF" — the server rejects a `merge` action (`inbox.ts:347`). Approve posts `{ action:'approve', messageId, comment }` via `handleReviewProposal` (`InboxView.tsx:162-195`); the review textarea is at `:745-751`, inside the "Merge Control & Verification" box (`:704-781`), gated on `status.canApprove` (clean fast-forward only, `inboxDomain.ts:132-140`).

**UI:** next to the Approve button, add a **"Reward contributor"** bps/percent input (default 0 = decline). Live copy: *"Carved from your {70/90}% — ancestors and the protocol pool are unaffected. Permanent for future sales."* Show remaining headroom = `grantable_bps − SUM(active+pending granted bps)`. Post it as a new field on the existing approve body. Fetch the repo's `grantable_bps` + already-granted sum via the diff endpoint (`GET /api/inbox?action=diff`, `inbox.ts:47-95`, which already loads the repo through the merge chain) so the input can bound itself client-side.

**Server (`inbox.ts:349-448`):**
1. Add `mj.requested_by_user_id AS requestedByUserId` to the approve load SELECT (`inbox.ts:351-363`) — the contributor identity (correction #2 above).
2. Before the write batch (`inbox.ts:406`), enforce guards, else `422`:
   - `contributor_user_id != repositoryOwnerId` (guard b).
   - `SUM(bps WHERE status IN ('active','pending')) + newBps ≤ repositories.grantable_bps` (per-repo cap). Revoked shares (including stale-revoked) are excluded, so their headroom returns to the pool.
   - grant only allowed when `decision === 'approved'`.
3. Add to the existing `statements` batch (`inbox.ts:406-417`, atomic with the approval + `merge.approved` outbox event) an **`INSERT OR IGNORE INTO contributor_shares (... status='pending' ...)`** bound to `repositoryId`, `contributor_user_id=requestedByUserId`, `granted_by_user_id=userId` (owner, guaranteed by `:367`), `merge_job_id/merge_attempt_id/merge_approval_id`, `basis_points=newBps`. **`INSERT OR IGNORE` (not a bare INSERT) is required** — the approve handler is replayable (`ON CONFLICT` upsert on `merge_approvals`, `inbox.ts:410-412`); a bare insert would hit `UNIQUE(merge_attempt_id)` on replay and abort the whole batch (500). Consequence to state in the UI copy: **the % set at first approval is final for that attempt** — a re-approve cannot change it (economics immutable; the UNIQUE also blocks revoke-then-regrant on the same attempt). To change a grant, the owner must reject and the contributor re-submits a new attempt.

**Activation (`git.ts` `gateway-complete-merge`, `1267-1367`):** in the landing batch (`git.ts:1342-1357`), which handles **both** terminal statuses, add a 4th statement branched on `status`:
```sql
-- on 'landed':
UPDATE contributor_shares SET status='active', activated_at=CURRENT_TIMESTAMP
WHERE merge_attempt_id=? AND status='pending';
-- on 'stale':
UPDATE contributor_shares SET status='revoked', revoked_at=CURRENT_TIMESTAMP
WHERE merge_attempt_id=? AND status='pending';
```
keyed on `mergeAttemptId` (in scope) — no SELECT change. If the attempt lands, the share activates; if the CAS check marks it `stale` (`git.ts:1331-1337`), the share is **revoked, never activates → never pays, and releases its cap headroom** (critical: a pending grant on a stale attempt must not permanently consume the seeder's pool — the `pending→revoked` transition is already allowed by the status trigger). Fail-closed either way.

---

## 4. NEW surface C — idea-spec + images render as the listing

**The storage split:** Git (bare repos on disk) is authoritative for file bytes; D1 is a projection for identity + refs (`0006:1-3`, echoed `git.ts:249-252`). There is **no R2 for git content** (R2/`env.STORAGE` is only for deployed app artifacts, `serve.ts`). The file-read HTTP surface already exists — on the **GITSMITH gateway server** (`src/lib/gitsmith/server.ts`), not `functions/api/git.ts` (which is control-plane only). Two relevant routes, **both bearer-token gated** (`verifyToken`, `server.ts:69-79`):
- `GET /api/gateway/tree` (`server.ts:114`) — params `storageKey`, `commitOid`, `manifests`. Backed by `inspectCommitTree` (`gitStorage.ts:443`): returns the recursive file list **plus the text of matched manifest paths** (`gitStorage.ts:488-496`). **`spec.md`/`business.md` are readable over HTTP by path today** — pass `manifests=spec.md`.
- `GET /api/gateway/archive` (`server.ts:82`) — params `storageKey`, `commitOid`. Backed by `archiveAuthoritativeCommit` → `git archive` (`gitStorage.ts:362`, buffer, 64 MB cap). The only **binary-safe** HTTP read.

Underlying disk primitives (`gitStorage.ts`): `readAuthoritativeRef` (`:322`, ref→OID via `git rev-parse`), `listCommitFiles` (`:385`, `git ls-tree`), `readCommitFileContent` (`:411`, `git show <oid>:<path>`, **utf8-only, 1 MB** — corrupts binary), `archiveAuthoritativeCommit` (`:362`). Path-traversal + OID validation already enforced (`gitStorage.ts:78-131, 422-423`).

**What's actually missing (honest):**
- **Ref → OID resolution is free from D1** — the `repository_refs` projection maps `(repository_id, ref_name) → commit_oid` (`0006:51-59`), already joined in `deploy.ts:1114-1116`. No gateway token needed for this step.
- **Markdown needs no new endpoint** — the gateway `/tree` route already returns `spec.md` text. But the gateway is token-gated, so the browser can't call it directly.
- **Images have no by-path HTTP read** — `readCommitFileContent` is utf8-only; the only binary path is the whole-commit tarball.

**So the new work is a server-side proxy Pages Function** (reusing the exact pattern `deploy.ts` already uses — `verifySourceCommit`/`fetchSourceArchive` at `deploy.ts:125-139, 211-221`, holding `GITSMITH_GATEWAY_TOKEN`), e.g. `functions/api/repo-file.ts`: resolve repo (by `repositories.id` or `owner+slug` via `UNIQUE(owner_user_id, slug)`) → resolve OID from D1 `repository_refs` → for `spec.md` call gateway `/tree?manifests=spec.md`; for images either add a **base64 blob variant of `readCommitFileContent`** to `gitStorage.ts` + a `/tree`-style route (cleanest), or fetch `/archive` once and extract. Public-repo only (`repositories.visibility='public'`). This is fully "reuse GITSMITH storage" per locked decision #4 — no new asset subsystem, just a public projection of the token-gated read path.

**Where it renders:** `ArtifactSandbox` is the listing detail. It already renders `app.screenshots` as `<img>` in a "Shots" tab (`ArtifactSandbox.tsx:198,251-254`); the tab set is `'preview'|'screenshots'|'comments'` (`:43`). **There is no markdown renderer anywhere in `src/`** (confirmed — no `react-markdown`, no `marked`) and `app.description` is stored but never rendered in the detail view.

Two coherent options for wiring:
- **(preferred) Screenshots from repo files.** At submit, `drops.ts` can populate `app_listings.screenshots` with URLs pointing at the new `repo-file` endpoint (`…&path=screenshots/hero.png`), so the existing `<img>` gallery (`ArtifactSandbox.tsx:251-254`) renders repo images with zero UI change. `spec.md` gets a new **"Spec" tab** in ArtifactSandbox (add to the `:43` tab union) that fetches `…&path=spec.md`; ship a minimal safe markdown-to-HTML (or render as preformatted text first, upgrade later — this carries no money risk).
- Business-model doc renders the same way (another `path=business.md` fetch), either in the Spec tab or its own.

No new asset subsystem; repo is the source of truth; the site is a projection of committed files.

---

## 5. NEW surface D — the earnings view (both streams)

The profile earnings read is `functions/api/profile.ts:77-83` (SELECT over `commerce_order_allocations` joined to orders + listings, `WHERE recipient_user_id=? AND status='fulfilled'`) → `calculateMakerEconomics` in `profileDomain.ts:223-265`, which today groups only `maker` (`:240-242`) and `ancestor` (`:243-246`). The Royalties tab renders it (`ProfileView.tsx:509-563`), labeled "Maker Sales (70%) · Ancestor Lineage (20%)".

**Changes:**
1. `profileDomain.ts:243` — add a `role === 'contributor'` branch, accumulating a new `contributorEarnedCents` and per-app entry (mirror the ancestor branch).
2. `ProfileView.tsx` Royalties tab — add an **"Earning From"** section beside the existing lineage breakdown (`:532-561`): each repo where the user holds an **active** `contributor_shares` row — repo/app name, granted % (`bps/100`), granting merge, and lifetime settled contributor earnings.
3. **Accrued vs paid.** Today the profile reads only accrued allocations, never the outbox. To show "paid," `profile.ts` additionally reads `commerce_transfer_outbox` grouped by `status`+`destination_user_id` for this user. This is a shared improvement (helps makers too) — optional, but it's the natural home for a payout-status column.

**Two-stream story in the UI:** relabel the Royalties tab to make both streams explicit — "Direct sales (maker)", "Fork lineage (you're an ancestor)", and the new "Contributor shares (you shipped code upstream)". The `app_listings.screenshots`/repo linkage already ties each earning row to a real listing, so a builder sees, in one place, money from forks they sold and money from PRs they merged.

---

## 6. Data model — `contributor_shares` + the `commerce_order_allocations` rebuild (migration `0027`)

Exactly the core plan's schema, at number `0027`. Summary (full SQL is in contributor-plan.md §2):
- New `contributor_shares` table: `repository_id`, `contributor_user_id`, `granted_by_user_id`, `merge_job_id/attempt_id/approval_id`, `basis_points CHECK(>0 AND ≤10000)`, `status CHECK(pending|active|revoked)`, timestamps; `UNIQUE(merge_attempt_id)`; `CHECK(contributor != granted_by)`; two triggers (economics-immutable; status forward-only).
- **Table rebuild** (SQLite can't `ALTER` a CHECK): recreate `commerce_order_allocations` with `role IN ('maker','ancestor','protocol_pool','contributor')` (widen `0009:80`) and recipient-nullability widened to include `'contributor'` (`0009:88-91`); re-copy rows; recreate immutability triggers (`0009:121-131`) + recipient index. Drop/recreate `commerce_outbox_requires_fulfilled_allocation` with `'contributor'` on line `0010:79`. Drop/recreate `commerce_recovery_matches_order_allocation` (`0012:149`) with `'contributor'` so future refund clawback can recover the contributor slice.
- **Ship dark:** after `0027`, the schema admits the role and `contributor_shares` exists, but nothing emits a contributor allocation → allocation output is byte-identical → fail-closed.

Settlement wiring (unchanged from core plan): `commerceDomain.ts` `AllocationRole += 'contributor'` (`:16`); `calculateAllocations` takes `contributors?: {userId,bps}[]`, emits contributor rows sequenced **after ancestors, before protocol_pool**, carving `Σ contributor cents` from the maker remainder; caller (`create-intent.ts` near the lineage walk ~`:164`) fetches `contributor_shares WHERE repository_id=? AND status='active'` and passes them in (the batch insert loop `:205-226` is generic — no edit); widen the fan-out filter at `eventProcessor.ts:428` to include `'contributor'`.

---

## 7. Phased build order

Each phase is independently testable, fail-closed, reuses infra. Money phases (1,2,3b,4) are strictly ordered; rendering phases (A,C-render) carry no money risk and are **parallelizable**.

| Phase | Scope | Owner | Exit gate |
|---|---|---|---|
| **0 — Mayor decisions** | Per-repo `grantable_bps` semantics; maker-floor default; revocable vs irrevocable; can-lower-pool rule; the "permanent" copy. No code. | **Mayor (Nate)** | Decisions recorded as handler constants + migration defaults. |
| **1 — Dark migration 0027** | `contributor_shares` + triggers; `repositories.grantable_bps`; rebuild `commerce_order_allocations`; drop/recreate outbox + recovery triggers. Nothing emits contributor rows. | Agent | Applies to isolated preview D1; **existing allocation output byte-identical**; regression suite green; tamper tests (`RAISE(ABORT)`) on economics-update, backward status, allocation mutation. |
| **2 — Domain math** | `AllocationRole += contributor`; carve-out + sequencing in `calculateAllocations`. | Agent | Property tests: random gross+ancestors+contributors under cap → `Σcents==gross`, `Σbps==10000`, maker bps > 0, contributor-of-zero-cents still emits a valid row, ancestors/pool byte-identical to pre-change. |
| **A — Grantable field (parallel)** | `grantable_bps` in `drops.ts` submit + `PostEditorView` field + set-time validation; "up to N%" badge in `ArtifactSandbox`. | Agent | Seeding an idea with 90% grantable stores 9000 on the repo; listing shows the badge; fork capped at 7000; `repository_id IS NULL` → no pool. |
| **3a — Grant recording** | Approve SELECT += requester; grant input in InboxView; guards; pending insert in approve batch. | Agent | E2E: approve with 10% → `contributor_shares` pending; cap breach → 422; contributor==owner → 422. |
| **3b — Landing activation** | Status-branched UPDATE in `gateway-complete-merge` landing batch. | Agent | E2E: land → active; force-stale → **revoked** (never active, cap headroom released so the seeder can re-grant). |
| **4 — Purchase-time fan-out** | `create-intent` fetches active shares → passes in; widen `eventProcessor.ts:428`. | Agent | E2E: purchase app with active share → contributor allocation row; on `payment_intent.succeeded` a `commerce_transfer_outbox` row exists and the `0010:79` trigger accepts it. |
| **C-render (parallel)** | New server-side proxy `functions/api/repo-file.ts` (holds `GITSMITH_GATEWAY_TOKEN`, resolves OID from D1 `repository_refs`, proxies gateway `/tree` for markdown + a base64 image read); Spec tab + repo-image screenshots in `ArtifactSandbox`. | Agent | Public repo's `spec.md` renders in the Spec tab; `screenshots/*.png` render in the Shots gallery; private repo / `..` / absolute-path / missing-token rejected. |
| **5 — Earnings UI** | `profileDomain.ts` contributor grouping; "Earning From" + two-stream labels in ProfileView; optional accrued-vs-paid outbox read. | Agent | Contributor sees active shares + lifetime settled earnings; maker sees reduced slice; both streams labeled distinctly. |

**Overall exit gate (before `npm run release`):** one E2E — *seed idea with `spec.md`+images and 90% grantable → renders as a listing → merge a PR with a 15% grant → share lands active → buyer purchases → allocations conserve to gross → contributor `commerce_transfer_outbox` row created and accepted by the fulfilled-allocation trigger → immutability triggers reject any tamper on the allocation or the share economics.*

---

## 8. Invariants to preserve (non-negotiable)

- **Conservation:** `Σcents == gross`, `Σbps == 10000` (`commerceDomain.ts:337-343`) — held by the remainder pattern; property-tested Phase 2.
- **Ancestors + protocol pool untouched.** Contributor bps subtract only from the maker 7000/9000. Assert in tests.
- **Per-order allocation immutability** (`0009:121-131`) and **outbox economics immutability** (`0011:89-101`) — inherited free by the new role.
- **Past orders frozen.** Each order snapshots its split; revoking a share affects future orders only.
- **Owner-gated mint.** Only `repositories.owner_user_id` grants (`inbox.ts:367`); shares activate only on verified CAS landing (`git.ts:1331-1337`).

**Pre-existing platform gaps (list, don't fix here — they hit contributors and makers identically):** no `account.updated` handler so `payouts_enabled` never flips (`eventProcessor.ts:127`); no payout cron (outbox drains only via manual authenticated POST); refund/dispute clawback worker unrun. The feature is correct and fail-closed on top of these; when payouts are fixed platform-wide, contributors are already wired in.

**Files touched:** `migrations/0027_contributor_revenue_sharing.sql` (new); `src/lib/commerceDomain.ts` (role + carve math); `src/lib/commerce/eventProcessor.ts:428`; `functions/api/payments/create-intent.ts` (fetch active shares); `functions/api/drops.ts` (grantable_bps submit + GET); `src/views/PostEditorView.tsx` (grantable field); `functions/api/inbox.ts:351-448` (approve SELECT + grant input handling + pending insert + guards); `src/views/InboxView.tsx:745-773` (grant input UI); `functions/api/git.ts` (landing-batch activation UPDATE at `1342-1357`); `functions/api/repo-file.ts` (new public proxy over token-gated gateway `/tree`+image read); `src/lib/gitsmith/gitStorage.ts` (base64 image read variant); `src/components/ArtifactSandbox.tsx` (Spec tab + upside badge); `src/lib/profileDomain.ts:223-265` (contributor grouping); `src/views/ProfileView.tsx:509-563` (Earning From + two-stream labels). Read-path type unions to keep consistent: `recoveryDomain.ts:5`, `refundProcessor.ts:197`.
