# Nate's Software — Full Fake / Stub / Placeholder Audit

**Audit date:** 2026-09-01  
**Scope:** Rendered web desktop, standalone routes, Cloudflare functions, local gateways/CLI, persistence schema, commerce, contributor economics, and obvious dead exports.  
**Method:** Every rendered view and interactive handler was traced to its API, storage, and downstream worker. Keyword hits were not automatically treated as defects: test-only mocks and simulations that are clearly labeled as simulations are excluded unless they replace a promised product capability. Conversely, an honestly labeled “unavailable” state is still cataloged when it blocks feature-completeness.

## Executive verdict

The codebase contains several genuinely real foundations: D1-backed accounts, drops, votes, comments, profiles, shelf records, chat messages, inbox threads, canonical repositories/forks, CAS ref motion, Docker-provider operations, DYNO run ingestion, Stripe PaymentIntent creation, webhook verification, immutable allocation rows, licenses, and transfer outboxes. The product is nevertheless **not feature-complete** because the principal user loop is broken at the seams:

1. A buyer cannot actually enter payment details or confirm the PaymentIntent.
2. The checkout UI displays a made-up price/split rather than the authoritative commerce product returned by the server.
3. Contributor grants are persisted, but checkout never loads them into the allocation calculation.
4. Payout onboarding is not synchronized from Stripe and transfer draining has no scheduled production runner.
5. Browser SLOPSHOP is a command/manifest generator, not the advertised visual AI/AST welding workflow.
6. Verification and approval do not yet form a trustworthy, inspectable, policy-enforced merge pipeline.
7. Several user-facing “live” social/editorial states start from hardcoded people, messages, scores, and benchmark claims.

Severity used below: **Critical** = breaks buy/own/publish/fork or money correctness; **High** = central app promise is absent/misrepresented; **Medium** = meaningful user feature is fake, local-only, or incompletely wired; **Low** = peripheral/demo/dead-code residue.

---

## CHECKOUT, OWNERSHIP, PAYMENTS, AND PAYOUTS

### 1. Checkout cannot take or confirm a payment

- **Evidence:** `src/components/CheckoutModal.tsx:43-59`, `src/components/CheckoutModal.tsx:122-130`
- **User sees/expects:** “SECURE STRIPE MARKETPLACE CHECKOUT,” a product total, split, and a checkout action.
- **Actually happens:** The UI calls `create-intent`, throws away the returned `clientSecret`, `publishableKey`, and allocations, and then says the Stripe Payment Element is not available. No card entry, `stripe.confirmPayment`, success state, order polling, or receipt exists.
- **Severity:** **Critical**
- **Make it real:** Integrate Stripe.js/Elements, send an idempotency key, confirm the PaymentIntent, poll/read order fulfillment, then refresh shelf/license state.

### 2. The current checkout request is rejected even if payments are enabled

- **Evidence:** `src/components/CheckoutModal.tsx:47-51`; `functions/api/payments/create-intent.ts:29-42`
- **User sees/expects:** “Check checkout availability” should at least create a valid pending order.
- **Actually happens:** The frontend sends no `Idempotency-Key`; the backend requires one and returns HTTP 400 before looking up the product.
- **Severity:** **Critical**
- **Make it real:** Generate and retain a per-attempt idempotency key in the modal and include it in the request header.

### 3. Checkout price is hardcoded by app ID and ignores `app.price`

- **Evidence:** `src/components/CheckoutModal.tsx:34-38`
- **User sees/expects:** The listing's current price.
- **Actually happens:** Every unknown app displays $15; only three IDs get special constants. A maker-edited price or authoritative `commerce_products.price_cents` is ignored.
- **Severity:** **Critical** (misstating money)
- **Make it real:** Render only the authoritative amount/currency returned by a product/checkout quote endpoint; do not calculate from catalog props.

### 4. Checkout lineage split is a client-side guess

- **Evidence:** `src/components/CheckoutModal.tsx:40-45`, `src/components/CheckoutModal.tsx:105-117`
- **User sees/expects:** An exact “Where your money goes” breakdown.
- **Actually happens:** Fork status is inferred solely from optional `app.forkDepth`, which the live catalog mapping does not populate (`src/context/CatalogContext.tsx:75-122`). The UI therefore commonly shows 90/10 even when canonical ancestry requires 70/20/10, and it cannot show individual ancestors or contributors.
- **Severity:** **Critical**
- **Make it real:** Return an authoritative signed/immutable checkout quote or use the `lineageSnapshot`/`allocations` returned by `create-intent` before displaying a breakdown.

### 5. Payments are deliberately disabled by default

- **Evidence:** `functions/api/payments/create-intent.ts:8-15`; `functions/api/payments/webhook.ts:20-25`; `functions/api/payments/onboard.ts:32-39`
- **User sees/expects:** Buy-once ownership and maker payout onboarding.
- **Actually happens:** Unless deployment secrets explicitly set `PAYMENTS_ENABLED=true` (and `PAYOUTS_ENABLED=true` for onboarding), checkout/webhook/onboarding fail closed with “being commissioned.”
- **Severity:** **Critical**
- **Make it real:** Commission a controlled Stripe environment, complete the missing lifecycle items below, configure secrets/flags, and run an end-to-end live/test-mode acceptance purchase.

### 6. Successful backend purchase is not connected back to the browser shelf

- **Evidence:** `src/context/CatalogContext.tsx:263-265`, `src/context/CatalogContext.tsx:286`; repository-wide search finds no `recordPurchase` call site.
- **User sees/expects:** A successful purchase immediately becomes owned and exposes its license/downloads.
- **Actually happens:** `recordPurchase` only mutates a React `Set`, ignores the license key, and is never called. The real webhook can create shelf/license rows, but there is no checkout completion UI that waits for or fetches them.
- **Severity:** **Critical**
- **Make it real:** Delete the fake helper or replace it with server fulfillment polling plus `/api/shelf` refresh and receipt/license presentation.

### 7. Stripe Connect onboarding status never receives `account.updated`

- **Evidence:** `functions/api/payments/onboard.ts:88-111` initially stores `charges_enabled=0`, `payouts_enabled=0`; no `account.updated` handler exists under `functions/` or `src/lib/commerce/`.
- **User sees/expects:** Completing Stripe onboarding enables payouts.
- **Actually happens:** The database remains disabled forever unless modified out of band, so `transferWorker` rejects it (`src/lib/commerce/transferWorker.ts:416-440`).
- **Severity:** **Critical**
- **Make it real:** Ingest and authoritatively refetch `account.updated`, persist capabilities/requirements, and expose onboarding status to makers.

### 8. No scheduled transfer/payout drain

- **Evidence:** `functions/api/payments/process-transfers.ts:1-160`; `wrangler.toml` has no `[triggers]` cron configuration and no scheduled worker entry point.
- **User sees/expects:** Earned maker/ancestor/contributor funds are paid automatically.
- **Actually happens:** The transfer worker is reachable only through an authenticated/manual POST. Durable outbox rows can remain pending indefinitely.
- **Severity:** **Critical**
- **Make it real:** Add a least-privilege scheduled worker/queue consumer with leases, retries, alarms, reconciliation, and operational dashboards.

### 9. Contributor shares never enter purchase allocation

- **Evidence:** `functions/api/payments/create-intent.ts:163-173` calls `calculateAllocations` with gross/currency/seller/repository/ancestors only; `src/lib/commerceDomain.ts:65`, `src/lib/commerceDomain.ts:345-443` supports `contributors` but none are supplied.
- **User sees/expects:** “Up to X% of every sale available to contributors” (`src/components/ArtifactSandbox.tsx:473-479`) and an approved grant means recurring sale revenue.
- **Actually happens:** `contributor_shares` can be created by INBOX, but checkout snapshots allocate zero contributor cents. The marketplace's headline contributor economics are disconnected from commerce.
- **Severity:** **Critical**
- **Make it real:** Query active contributor shares for the repository inside checkout, validate/cap them server-side, pass them into `calculateAllocations`, and snapshot them immutably per order.

### 10. Refund accounting exists, but recovery money movement is not executed

- **Evidence:** `src/lib/commerce/refundProcessor.ts:189-217` creates `commerce_recovery_outbox`; there is no production recovery worker analogous to `transferWorker` that debits/reconciles completed transfers.
- **User sees/expects:** Refunds and chargebacks reverse licenses and seller obligations correctly.
- **Actually happens:** Refund observations and recovery obligations are durable, but money already transferred is not recovered automatically. Dispute events remain unsupported by the general processor (`src/lib/commerce/eventProcessor.ts:127-143`).
- **Severity:** **Critical**
- **Make it real:** Implement recovery/negative-balance execution, dispute lifecycle handling, license suspension policy, and reconciliation.

### 11. No buyer-facing order, receipt, or purchase-status read endpoint

- **Evidence:** Payment functions expose create, webhook, onboarding, and worker POSTs only; `/api/shelf` returns fulfilled titles but there is no scoped order/status/receipt route.
- **User sees/expects:** See pending/succeeded/failed purchase, receipt, and delivery progress after payment confirmation or reload.
- **Actually happens:** A delayed webhook leaves the buyer with no way to distinguish pending fulfillment from failure.
- **Severity:** **High**
- **Make it real:** Add authenticated `GET /api/payments/orders/:id` (buyer-scoped), receipt/download metadata, and UI polling/recovery.

### 12. Shareware licensing UI is dead and client-forgeable

- **Evidence:** `src/components/SharewareNagScreen.tsx:16-105` accepts a manually typed key through callbacks; `src/lib/sharewareSdk.ts:37-59` trusts `localStorage`; `SharewareNagScreen` has no renderer/import call site.
- **User sees/expects:** Cryptographic license enforcement and a real shareware trial gate.
- **Actually happens:** The component is unused; the SDK stores arbitrary strings locally and counts runs locally. Clearing/editing storage defeats it, and it is not bound to commerce licenses.
- **Severity:** **High**
- **Make it real:** Render the gate in distributable apps, validate signed offline license payloads, and support authenticated activation/recovery without trusting raw localStorage.

---

## HOTWIRE / CATALOG / DROP PUBLISHING

### 1. Seed marketplace inventory masquerades as product content when live fetch fails

- **Evidence:** `src/context/CatalogContext.tsx:27-35`, `src/context/CatalogContext.tsx:133-163`; hardcoded apps/metrics/comments/voters in `src/data/mockData.ts:88-291`.
- **User sees/expects:** A marketplace board.
- **Actually happens:** Network/backend failure swaps in invented apps, hundreds of votes/forks, people, comments, prices, and screenshots. It is now visibly badged “DEMO,” which makes it honest, but it still substitutes a fake product surface for an empty/error state.
- **Severity:** **High**
- **Make it real:** Keep fixtures in Storybook/tests or a separately entered demo mode; production should show retry/error/empty states only.

### 2. “Have I voted?” is local React state, not authoritative

- **Evidence:** `src/views/HotwireView.tsx:44`, `src/views/HotwireView.tsx:116-137`; `functions/api/upvote.ts` provides POST only.
- **User sees/expects:** Their vote state survives reload and is correct across devices.
- **Actually happens:** D1 deduplicates votes, but the UI's `upvotedApps` starts empty on every mount. A prior voter sees an enabled vote button, clicks it, then receives an error instead of seeing “voted.”
- **Severity:** **High**
- **Make it real:** Add viewer-specific `hasVoted` to drops or a scoped vote-state read endpoint and hydrate the UI.

### 3. Fork count increment is browser-only and can lie until refresh

- **Evidence:** `src/context/CatalogContext.tsx:259-261`; invoked after fork at `src/components/ForkWithAiModal.tsx:145-148`.
- **User sees/expects:** Fork totals represent canonical forks.
- **Actually happens:** A successful fork only increments the local catalog object; no authoritative catalog refresh occurs. Other users and reload depend on a separate backend projection being correct.
- **Severity:** **Medium**
- **Make it real:** Return authoritative fork totals or refresh the catalog after canonical fork creation; remove the local counter helper.

### 4. Live catalog mapping fabricates defaults for missing business data

- **Evidence:** `src/context/CatalogContext.tsx:77-110`
- **User sees/expects:** Maker, price, screenshots, moddability score, and merge cleanliness are real listing facts.
- **Actually happens:** Missing values become `nate`, `$15`, an Unsplash image, score 95, and “99.8% clean.” These are not labeled per-field estimates and can turn incomplete records into polished-looking claims.
- **Severity:** **High**
- **Make it real:** Make required fields schema-required or display “not supplied/not measured”; never invent maker identity or quality metrics.

### 5. Demo voter identities and maker leaderboard are hardcoded

- **Evidence:** `src/data/mockData.ts:105-119`, `src/data/mockData.ts:293-330`; `src/views/HotwireView.tsx:332-338`, `src/views/HotwireView.tsx:548-552`.
- **User sees/expects:** Verified voters and maker streak rankings.
- **Actually happens:** Nate/Josh/Sam profiles, streaks, totals, and voter lists are fixture data. The voter modal is marked demo, but the surrounding product still devotes first-class UI to invented social proof.
- **Severity:** **Medium**
- **Make it real:** Add privacy-safe voter/profile reads and calculate streak/leaderboard data from canonical drops/votes.

### 6. Drop creation does not create the underlying app/repository/product loop

- **Evidence:** `src/context/CatalogContext.tsx:218-249` posts listing metadata; `functions/api/drops.ts:325-335` allows no repository when no grant pool is requested.
- **User sees/expects:** Publishing an app makes a buyable/forkable title.
- **Actually happens:** A drop can exist without canonical source, deployable artifact, or active commerce product; the UI later disables fork and launch. Publishing is metadata submission, not product commissioning.
- **Severity:** **High**
- **Make it real:** Create a staged publish workflow with repository, verified revision, artifact/download, product price, maker payout readiness, and explicit activation checks.

### 7. A real app with zero comments can display fixture comments as if live

- **Evidence:** `src/components/ArtifactSandbox.tsx:132-145`
- **User sees/expects:** The comments tab contains persisted comments for this listing.
- **Actually happens:** The API response is accepted only when `comments.length > 0`; a successful authoritative empty list falls back to `app.comments`. For seed-derived or stale catalog objects this can show Nate/Josh/Sam fixture praise on a real empty thread.
- **Severity:** **High**
- **Make it real:** Treat `success: true` plus an empty array as authoritative; use fixtures only in explicit demo mode and label them.

---

## SLOPSHOP / FORKING / MODDING

### 1. Web SLOPSHOP does not splice code or run an AI agent

- **Evidence:** `src/views/SlopshopView.tsx:95-173` creates/copies/downloads commands and manifests; `src/views/SlopshopView.tsx:764-775` explicitly says execution must happen locally.
- **User sees/expects:** “AI Speed Shop & AST Feature Splicer,” visual welding, generated code, tests, and reversible landing.
- **Actually happens:** The rendered web app is a preset/prompt/command generator. It neither invokes the existing AST engine nor an agent, creates a worktree, changes code, runs verification, nor publishes a feature ref.
- **Severity:** **High**
- **Make it real:** Connect the UI to a trusted local-agent bridge or remote isolated job API that invokes the real mod engine, streams diff/test evidence, and returns a signed feature ref.

### 2. Landing and rollback buttons are explanatory no-ops

- **Evidence:** `src/views/SlopshopView.tsx:175-201`, `src/views/SlopshopView.tsx:827-842`
- **User sees/expects:** CAS landing and rollback controls.
- **Actually happens:** Both actions show instructions/alerts; neither calls GITSMITH, changes a ref, or creates a proposal.
- **Severity:** **High**
- **Make it real:** Wire authenticated proposal creation, verified evidence binding, CAS landing, and inverse/revert proposal APIs—or rename them unambiguously as documentation.

### 3. “Fork with AI” creates only a canonical Git fork

- **Evidence:** `src/components/ForkWithAiModal.tsx:107-151`, button copy at `src/components/ForkWithAiModal.tsx:416-424`.
- **User sees/expects:** One click forks and starts AI coding.
- **Actually happens:** The button calls only `/api/git` action `fork`; no agent/tool is launched and the chosen prompt/tool is not included in the request. Tool tabs are cosmetic around a copied CLI command.
- **Severity:** **High**
- **Make it real:** Split truthful actions (“Create forge fork” / “Open in local agent”) or implement a local handoff/job session that consumes the selected prompt and fork coordinates.

### 4. Embedded “Run” only hands text to TERMINAL, whose workspace is ephemeral

- **Evidence:** `src/components/ForkWithAiModal.tsx:382-392`; `src/views/SetupWizardView.tsx:359`; terminal sessions explicitly delete workspaces.
- **User sees/expects:** Run the fork command and keep a modifiable local worktree.
- **Actually happens:** At best the command runs in a commissioned ephemeral VM; it cannot install a durable worktree on the user's machine.
- **Severity:** **Medium**
- **Make it real:** Provide a native/local bridge or make copy-to-native-terminal the primary durable path; offer export/push before ephemeral teardown.

### 5. `slop fork` onboarding and canonical fork recording are separate paths

- **Evidence:** UI command generation at `src/components/ForkWithAiModal.tsx:91-97`; canonical fork creation is a browser `/api/git` call at `:130-140`; CLI fork implementation lives separately in `bin/slop.ts` and clones a repository/worktree.
- **User sees/expects:** The official CLI fork participates in immutable lineage automatically.
- **Actually happens:** Copying/running `slop fork owner/repo` is not the same transaction as the browser `action: fork`; lineage can be omitted unless the user first creates the canonical child in UI.
- **Severity:** **Critical**
- **Make it real:** Make CLI `slop fork` authenticate and call the canonical fork API, then clone the returned child repository.

### 6. App-detail “Local AI Agent Workflow” bypasses GITSMITH with hardcoded GitHub URLs

- **Evidence:** `src/components/ArtifactSandbox.tsx:591-705`
- **User sees/expects:** Fork the canonical app, modify it locally, and push a lineage-aware feature back to GITSMITH.
- **Actually happens:** Every Claude/AGY/Aider/Cursor command clones `https://github.com/natemcguire/${app.id}.git` into a predictable `/tmp/slop-${app.id}` path, regardless of `repositoryId`, owner, canonical clone coordinates, or whether that GitHub repo exists. The final instruction is a generic `git push origin my-feature-branch`, which pushes to GitHub—not GITSMITH—and the text claims upstream gets 20% without registering lineage.
- **Severity:** **Critical**
- **Make it real:** Delete this legacy modal path or generate commands solely from authenticated canonical fork responses, collision-safe worktrees, and GITSMITH SSH coordinates.

---

## GITSMITH / MERGE / SOURCE BROWSING

### 1. GITSMITH initializes from bundled fake repositories and files

- **Evidence:** `src/views/GitsmithView.tsx:103-200`, initial state at `src/views/GitsmithView.tsx:205-207`.
- **User sees/expects:** A live repository forge/browser.
- **Actually happens:** The component initially selects a hardcoded DroneHunter repository with invented file contents, commits, and lineage. A later live fetch replaces the catalog; examples are optionally exposed, but initial render and failure behavior remain fixture-driven.
- **Severity:** **High**
- **Make it real:** Initialize empty/loading, render examples only in an explicit demo gallery, and never mix example repo IDs with canonical operations.

### 2. Repository file browser still has a synthetic README fallback

- **Evidence:** `src/views/GitsmithView.tsx:390-393`
- **User sees/expects:** Selected file content from Git objects.
- **Actually happens:** When object browsing is unavailable, it manufactures README prose from control-plane metadata rather than showing an empty/unavailable file pane.
- **Severity:** **Medium**
- **Make it real:** Use `/api/repo-file`/gateway for tree/blob reads and show a clear transport error with no fake file.

### 3. SSH write policy is incomplete and marked TODO

- **Evidence:** `functions/api/git.ts:532`, `functions/api/git.ts:601`; transport historically projects pushes through hooks rather than applying the full repository policy table before mutation.
- **User sees/expects:** Protected, signed, verified atomic pushes.
- **Actually happens:** Rich branch protection (required signers, approvals, CI checks) is not implemented. A CAS database projection is not equivalent to rejecting an invalid Git receive before ref mutation.
- **Severity:** **Critical**
- **Make it real:** Enforce delete/non-fast-forward/protected-ref/required-check rules in a synchronous pre-receive boundary and fail closed when the control plane is unavailable.

### 4. “Approve & merge” is ref landing, not a computed merge

- **Evidence:** `functions/api/pipeline.ts:80-99` records the source ref tip as the result OID; INBOX approval moves the target to that OID (`functions/api/inbox.ts:500-560`).
- **User sees/expects:** A merge with ancestry/divergence handling.
- **Actually happens:** No merge-tree/merge commit is created. The operation is a verified CAS ref advance/repoint and can be semantically different from merging.
- **Severity:** **High**
- **Make it real:** Enforce fast-forward ancestry or create/test a real merge commit; rename the action if only fast-forward landing is intended.

### 5. Repository provisioning readiness can exist without usable object transport

- **Evidence:** `src/views/GitsmithView.tsx:216-220`, `src/views/GitsmithView.tsx:392`, `src/views/GitsmithView.tsx:610`.
- **User sees/expects:** Creating a repository yields something cloneable/browsable.
- **Actually happens:** Control-plane metadata, storage gateway readiness, and SSH transport readiness are separate. The UI can show canonical metadata while file browsing or first push remains unavailable.
- **Severity:** **High**
- **Make it real:** Treat repo activation as a single readiness contract proven by authenticated clone/push/blob-read probes.

---

## RIG.EXE / DEPLOYMENT / VERIFICATION

### 1. Default RIG mode is a browser simulation

- **Evidence:** `src/views/RigRuntimeView.tsx:54-57`; simulated lifecycle timers at `src/views/RigRuntimeView.tsx:193-227`; UI disclosure at `src/views/RigRuntimeView.tsx:425`, `:692`, `:738-748`.
- **User sees/expects:** A micro-container fleet runtime.
- **Actually happens:** Until provider readiness succeeds and the user switches modes, launches merely advance an in-memory deterministic state machine; no command, health probe, container, or persistence occurs. It is honestly labeled, but it is the default surface for a core app.
- **Severity:** **High**
- **Make it real:** Default to live provider when ready; move simulator into an explicit “manifest playground,” and persist provider fleet/events server-side.

### 2. Live provider supports only prebuilt Docker image digests

- **Evidence:** `src/views/RigRuntimeView.tsx:144-153`, adapter options `src/views/RigRuntimeView.tsx:510-517`, build-command label `:540-546`.
- **User sees/expects:** Runtime-agnostic builds for process, Docker, WASM, and custom adapters.
- **Actually happens:** Commissioned live launch accepts only Docker and requires an OCI digest; the entered build command is explicitly not run by the provider.
- **Severity:** **High**
- **Make it real:** Commission builder adapters and artifact ingestion for the advertised runtimes, or narrow product claims to immutable Docker execution.

### 3. Verification accepts requester-selected commands and lacks a complete review artifact

- **Evidence:** `functions/api/rig-verification.ts` accepts verification input and returns/persists digest-oriented results; INBOX fetches repository diff separately (`src/views/InboxView.tsx:120-135`) rather than a signed evidence bundle.
- **User sees/expects:** RIG verification proves the revision is safe/tested for merge.
- **Actually happens:** A requester can choose weak commands; the reviewer does not receive a server-owned policy identity plus immutable full logs, test reports, artifacts, and network/isolation attestations in one package.
- **Severity:** **Critical**
- **Make it real:** Repository-owned immutable verification policy, network-denied execution, R2 evidence bundle, signed digest, ancestry check, and mandatory display in INBOX.

### 4. Deployment backends surface uncommissioned infrastructure

- **Evidence:** `functions/api/deploy.ts:725`, `:2423`; `functions/api/_aws.ts:509`.
- **User sees/expects:** Publish a verified app to a stable URL.
- **Actually happens:** Missing ECR/R2/provider resources end the workflow with “not provisioned/unavailable.” This is truthful but means publishing is environment-dependent and incomplete.
- **Severity:** **High**
- **Make it real:** Provision production ECR/R2/router dependencies, add readiness preflight, and prevent publish controls until the full path passes smoke tests.

---

## INBOX / CONTRIBUTOR MARKETPLACE

### 1. Contributor marketplace has no “my grants/earnings” read surface

- **Evidence:** Grants are inserted in `functions/api/inbox.ts:576-603`; repository search finds no endpoint selecting grants by the authenticated contributor for a profile/dashboard.
- **User sees/expects:** Contributors can see accepted revenue shares, status, repository, and resulting earnings.
- **Actually happens:** Only proposal owners see remaining pool context during review. A contributor grant becomes a hidden database row.
- **Severity:** **High**
- **Make it real:** Add authenticated contributor-grants and allocation/earnings endpoints plus Profile/Shelf UI.

### 2. No discoverable contribution marketplace

- **Evidence:** Marketing says “Coming soon” at `src/views/MarketingWindow.tsx:68`; current UI exposes only a listing's grantable percentage (`src/components/ArtifactSandbox.tsx:473-479`) and approval-time grant entry (`src/views/InboxView.tsx:780-805`).
- **User sees/expects:** Browse opportunities, contribute code, and earn a cut.
- **Actually happens:** There is no opportunity feed, claim/proposal workflow entry point, grant history, revocation UI, or marketplace search.
- **Severity:** **High**
- **Make it real:** Build grantable-project discovery, contribution proposal creation, status/history, and contributor portfolio flows on the existing schema.

### 3. Unread count is local to fetched pages and not globally exposed

- **Evidence:** `src/views/InboxView.tsx:39-50`, pagination at `:66-78`; no dedicated unread-count endpoint or desktop polling consumer exists.
- **User sees/expects:** Desktop/taskbar inbox badge is correct without opening/loading every page.
- **Actually happens:** Folder counts derive from the currently loaded thread slice; older unread pages are invisible to the count.
- **Severity:** **Medium**
- **Make it real:** Add authenticated aggregate counts/last-event cursor and wire taskbar notifications.

### 4. Approval can be a blind hash-level decision

- **Evidence:** `src/views/InboxView.tsx:601-631`, diff fetch `:120-135`, approval controls `:764-824`.
- **User sees/expects:** Inspect code, commits, tests, artifacts, and policy evidence before merge.
- **Actually happens:** Diff is optional/lazy and verification evidence is not a complete inspectable bundle. Approval can proceed without reading files or logs.
- **Severity:** **Critical**
- **Make it real:** Block approval until required evidence loads, validates, matches exact OID/target ancestry, and the reviewer acknowledges it.

---

## CHAT

### 1. Chat opens with hardcoded users and messages

- **Evidence:** `src/views/ChatView.tsx:24-31`; fixtures at `src/lib/ircProtocol.ts:202-245`.
- **User sees/expects:** Live lounge presence/history.
- **Actually happens:** Initial messages and online users are invented. API polling only appends new messages; it does not replace fixtures or fetch presence, so fake people remain online and fixture messages coexist with D1 data.
- **Severity:** **High**
- **Make it real:** Start empty/loading; add paginated history and heartbeat/presence endpoints with expiry.

### 2. Nick, topic, WHO/NAMES, and presence are browser-only

- **Evidence:** `src/views/ChatView.tsx:111-160`; only ordinary messages are POSTed at `:179-199`.
- **User sees/expects:** IRC-like shared channel semantics.
- **Actually happens:** `/nick`, `/topic`, `/who`, and user list mutations affect one tab only. Other users never see topic/presence changes.
- **Severity:** **Medium**
- **Make it real:** Persist/channel-broadcast nick/topic/presence events with authorization and heartbeat expiry.

### 3. Operator status is hardcoded and client-supplied

- **Evidence:** `src/views/ChatView.tsx:66`, `:173`, `:188`; `functions/api/chat.ts` stores request message data but has no role/presence model.
- **User sees/expects:** `@`/operator badges indicate trusted moderation roles.
- **Actually happens:** Nate/Josh are locally declared ops and every outbound message sends `isOp: 1`; this is presentation, not authorization.
- **Severity:** **High**
- **Make it real:** Derive roles server-side from authenticated memberships; ignore client `sender`/`isOp` and use session identity.

### 4. Chat sender identity can diverge from authenticated identity

- **Evidence:** `/nick` changes `currentNick` locally (`src/views/ChatView.tsx:111-127`); POST sends that arbitrary sender (`:183-188`).
- **User sees/expects:** Messages are attributable to account handles.
- **Actually happens:** The optimistic row temporarily presents the arbitrary nick as identity. The API correctly derives the persisted sender and operator role from the authenticated user (`functions/api/chat.ts:33-67`), so polling/confirmation repairs the row; `/nick` is therefore a misleading local cosmetic feature rather than an actual impersonation vulnerability.
- **Severity:** **Medium**
- **Make it real:** Remove `/nick` or add a server-owned display-nick model; render optimistic identity from the session, never user-entered sender text.

---

## DYNO

### 1. Default model/harness choices are hardcoded product claims

- **Evidence:** `src/views/DynoView.tsx:59-63`
- **User sees/expects:** Available benchmark subjects/runtimes reflect commissioned integrations.
- **Actually happens:** The setup defaults to `gemini-3.7-flash-high`, “Antigravity CLI,” and a shell command regardless of what tools/models are installed or supported.
- **Severity:** **Medium**
- **Make it real:** Discover installed harness adapters or require explicit custom subject configuration; version and validate capabilities server-side.

### 2. Verifier worker can be entirely uncommissioned

- **Evidence:** `functions/api/dyno-verifier.ts:112`, trace-storage failures `:150-153`, `:247-272`.
- **User sees/expects:** Submitted benchmark results can become reproduced/verified.
- **Actually happens:** The API returns “DYNO verifier workers are not commissioned” without required worker/storage bindings, so self-reported imports may never advance to verified status.
- **Severity:** **High**
- **Make it real:** Deploy verifier consumers, R2 trace retention, lease/retry scheduling, and surface queue status/ETA.

### 3. Fixture cache methods are TODO stubs

- **Evidence:** `src/lib/dyno/fixtures.ts:127-133`
- **User sees/expects:** Repeatable fixture caching with TTL/capacity behavior.
- **Actually happens:** LRU access update, TTL checks, and capacity eviction are explicitly unimplemented.
- **Severity:** **Medium**
- **Make it real:** Implement deterministic bounded cache semantics and tests, or remove the advertised cache layer.

---

## TERMINAL.EXE

### 1. Local terminal mode is a command emulator, not a shell

- **Evidence:** `src/views/TerminalView.tsx:19-29`, command dispatch in `src/views/TerminalView.tsx:105-300`.
- **User sees/expects:** “DOS/UNIX shell” and CLI commands.
- **Actually happens:** Local mode recognizes a fixed set of commands and prints generated responses; it has no filesystem/process access. Only gateway mode can execute in a real ephemeral service.
- **Severity:** **High**
- **Make it real:** Label it “command guide/emulator” or route all execution-capable commands to an authenticated sandbox terminal.

### 2. Real terminal is unavailable unless an external gateway proves readiness

- **Evidence:** `src/lib/terminalClient.ts:118-151`; `functions/api/terminal-session.ts:112`, `:163`.
- **User sees/expects:** Open TERMINAL and run commands.
- **Actually happens:** Missing ledger/gateway configuration returns 503; there is no local fallback capable of executing commands.
- **Severity:** **High**
- **Make it real:** Commission and monitor the ephemeral VPS gateway, or ship a supported local bridge; make service status visible before opening a session.

### 3. Terminal command history is in-memory only

- **Evidence:** `src/views/TerminalView.tsx:22-29`
- **User sees/expects:** Shell history usually survives navigation/session.
- **Actually happens:** Output and command history disappear on remount; ephemeral VM workspace also disappears by design.
- **Severity:** **Low/Medium**
- **Make it real:** Persist non-secret command history per user/device with clear retention controls; keep VM deletion explicit.

---

## EDITORIAL

### 1. All articles, dates, scores, authors, and benchmark numbers are constants

- **Evidence:** `src/views/EditorialView.tsx:19-84`
- **User sees/expects:** Published editorial reviews and lab benchmarks.
- **Actually happens:** Three static articles contain unverified claims such as 12 ms boot, 168.2 tok/s, 99.2% recall, ratings, awards, and authorship. A “DEMO REVIEWS” badge at `:103-106` is honest, but there is no editorial CMS/evidence trail.
- **Severity:** **Medium**
- **Make it real:** Store articles/revisions/authors in a publishing backend and link quantitative claims to reproducible DYNO/artifact evidence.

### 2. Editorial claps are useState-only

- **Evidence:** `src/views/EditorialView.tsx:87-93`, button `:197-203`
- **User sees/expects:** A social reaction count.
- **Actually happens:** Invented starting counts increment in one tab and vanish on reload; there is no deduplication or API.
- **Severity:** **Medium**
- **Make it real:** Add article/reaction tables and viewer reaction state, or remove claps from demo content.

### 3. “Launch in Sandbox” can target draft demo apps

- **Evidence:** `src/views/EditorialView.tsx:205-212`; demo app deployment errors in `src/data/mockData.ts:88-181`.
- **User sees/expects:** Launch the reviewed product.
- **Actually happens:** The linked listing may explicitly have no deployable revision, so the launch leads to an unavailable shell rather than the reviewed app.
- **Severity:** **Medium**
- **Make it real:** Only render launch for active deployment IDs; otherwise label “View draft listing.”

---

## PROFILE / SHELF / SETUP.EXE

### 1. Activity tab has no dedicated event source

- **Evidence:** `src/views/ProfileView.tsx:25`, profile fetch at `:118-166`; no activity endpoint is called.
- **User sees/expects:** Account activity/audit history.
- **Actually happens:** The tab is derived from whatever published/shelf/profile data is already loaded rather than a canonical activity stream.
- **Severity:** **Medium**
- **Make it real:** Add authenticated/publicly filtered activity events with pagination and privacy rules.

### 2. Royalties are aggregates without payout/allocation drill-down

- **Evidence:** `src/views/ProfileView.tsx:54-60`, assignment from profile response `:142-153`.
- **User sees/expects:** Understand sales, lineage/contributor earnings, pending vs paid amounts.
- **Actually happens:** Only summary fields are shown; no order/allocation/transfer ledger read UI exists.
- **Severity:** **High**
- **Make it real:** Add scoped ledger and transfer-status endpoints with reconciliation-safe summaries.

### 3. Setup starter catalog is hardcoded

- **Evidence:** `src/views/SetupWizardView.tsx:18-52`, selected in state at `:62-64`.
- **User sees/expects:** Available starter apps/templates.
- **Actually happens:** Starter availability, descriptions, and repo targets are baked into the bundle rather than checked against canonical active repositories.
- **Severity:** **Medium**
- **Make it real:** Fetch verified forkable starters from GITSMITH/HOTWIRE with readiness and template-version metadata.

### 4. Setup success means only “fork API returned success”

- **Evidence:** `src/views/SetupWizardView.tsx:483-507`
- **User sees/expects:** Setup completed and app is ready locally.
- **Actually happens:** The success alert fires after canonical fork creation; it does not prove clone, local tool launch, dependency install, build, or run.
- **Severity:** **High**
- **Make it real:** Turn setup into a resumable checklist/job with verified clone/bootstrap/build/launch receipts, or rename completion to “Forge fork created.”

---

## WALLART AND DISTRIBUTED APPS

### 1. WALLART is a draft catalog promise, not a shipped app

- **Evidence:** `src/data/mockData.ts` demo listings are marked `deploymentState: 'draft'`; `src/components/EphemeralLiveApp.tsx` renders honest deployment-state messaging rather than a bundled WallArt implementation. Tests explicitly assert the unbundled draft behavior in `tests/wallart.test.tsx:7-165`.
- **User sees/expects:** The flagship 3D canvas customizer and print queue described by product documentation.
- **Actually happens:** No rendered WallArt studio/domain implementation exists in the current `src/`; the listing opens an unavailable/draft shell.
- **Severity:** **High**
- **Make it real:** Import the source into canonical GITSMITH, implement/upload the actual app, verify/deploy it, and bind downloads/data-export/commerce product.

### 2. Catalog live links can be synthesized from app ID

- **Evidence:** `src/components/ArtifactSandbox.tsx:259`, `:302`, `:511`.
- **User sees/expects:** “Open live app” reaches a commissioned deployment.
- **Actually happens:** Some links fall back to `https://${app.id}.nates-software.com` even without an authoritative active deployment/hostname.
- **Severity:** **High**
- **Make it real:** Render links only from active deployment records/hostnames returned by the backend; otherwise show deployment status.

### 3. GITSMITH link is a hardcoded external hostname/query contract

- **Evidence:** `src/components/ArtifactSandbox.tsx:519`
- **User sees/expects:** Browse the app's repository.
- **Actually happens:** It constructs `https://gitsmith.nates-software.com?repo=...` rather than opening the in-app canonical repo route, and may pass app ID fallback rather than repository identity.
- **Severity:** **Medium**
- **Make it real:** Use repository ID/slug and the actual configured forge route; disable when no canonical repo exists.

---

## DEAD / UNWIRED / RESIDUAL CODE

### 1. `SharewareNagScreen` is never rendered

- **Evidence:** Component definition `src/components/SharewareNagScreen.tsx:16`; repository-wide search finds no import/use outside the file.
- **User sees/expects:** N/A directly; product docs imply shareware trial/license gating.
- **Actually happens:** The implemented-looking nag screen is dead code.
- **Severity:** **Medium**
- **Make it real:** Integrate it into distributable app runtime with real signed license validation, or delete it.

### 2. `NatesLLMSpecsCard` is never rendered

- **Evidence:** `src/components/NatesLLMSpecsCard.tsx:8`; no import/use call site.
- **User sees/expects:** N/A; looks like a product specification card.
- **Actually happens:** Dead component with no product surface.
- **Severity:** **Low**
- **Make it real:** Integrate into an evidence-backed app/DYNO view or remove it.

### 3. `recordPurchase` is dead and misleading

- **Evidence:** `src/context/CatalogContext.tsx:263-265`, exported at `:286`; no caller.
- **User sees/expects:** Internal ownership recording appears implemented.
- **Actually happens:** It merely mutates memory and ignores the license key.
- **Severity:** **High**
- **Make it real:** Remove in favor of authoritative fulfillment refresh (see Checkout finding 6).

### 4. Browser-only shareware SDK is unwired

- **Evidence:** `src/lib/sharewareSdk.ts:37-59`; no production consumer outside the unused nag screen path.
- **User sees/expects:** Trial run counting and license recovery.
- **Actually happens:** LocalStorage helpers exist but do not enforce any shipped title.
- **Severity:** **Medium**
- **Make it real:** Package as a documented SDK with cryptographic licenses and integrate/test in actual apps.

### 5. Mock Docker runner is production-source residue

- **Evidence:** `src/lib/rigDockerProvider.ts:173-275` exports `MockDockerCommandRunner` and fabricated container IDs/logs.
- **User sees/expects:** Production provider observations are real.
- **Actually happens:** Current usage is primarily tests, and provider code distinguishes simulation, so this is not presently a user-facing fake; keeping the mock exported beside production code raises accidental-wiring risk.
- **Severity:** **Low**
- **Make it real:** Move mock runner to test utilities and make production constructors accept only the real runner.

---

## CROSS-CUTTING MISSING READ MODELS AND OPERATIONS

### 1. No unified product-readiness endpoint

- **Evidence:** Readiness is independently fetched from catalog, GITSMITH, RIG, terminal, payments, and deployment views.
- **User sees/expects:** A title is either buyable, forkable, runnable, downloadable, and payout-ready—or clearly staged.
- **Actually happens:** Each seam can be green while the end-to-end loop is red. This produces “published but not forkable,” “priced but not purchasable,” and “repo exists but object gateway unavailable.”
- **Severity:** **Critical**
- **Make it real:** Add a server-computed readiness projection with explicit blockers for source, build, deployment, product, seller, payment, license, export, and fork transport.

### 2. No end-to-end acceptance test for buy → own → download/fork → contributor payout

- **Evidence:** Numerous subsystem tests exist, but no browser/worker acceptance scenario crosses CheckoutModal, Stripe confirmation, webhook, shelf, canonical fork, contributor allocation, and transfer completion.
- **User sees/expects:** The product promise works as one loop.
- **Actually happens:** Unit/integration tests can all pass while the frontend omits the idempotency key and Payment Element and contributors receive zero allocation.
- **Severity:** **Critical**
- **Make it real:** Add a Stripe test-mode end-to-end suite with two makers, buyer, ancestor, contributor, webhook delivery, shelf/license assertion, and transfer/recovery assertions.

### 3. No automated production worker health/reconciliation surface

- **Evidence:** Transfer, webhook inbox, verifier, deployment, and forge outboxes each have code/tables but no consolidated operations UI or alarms in the web product.
- **User sees/expects:** Pending work eventually completes and failures are actionable.
- **Actually happens:** Durable queues can silently accumulate; users see stale states without ETA or operator-visible cause.
- **Severity:** **High**
- **Make it real:** Scheduled consumers, dead-letter views, queue-age metrics, reconciliation jobs, and user-safe status messaging.

---

## TOP 10 TO MAKE REAL FIRST

1. **Ship the Stripe Payment Element and checkout completion flow** — include an idempotency key, confirm the real PaymentIntent, poll order fulfillment, and refresh the shelf/license.
2. **Make checkout display the authoritative product/lineage/contributor quote** — remove all client price and split guesses.
3. **Load active contributor grants into every commerce allocation snapshot** — today the contributor marketplace promises recurring revenue but allocates none.
4. **Complete Stripe Connect lifecycle and automatic settlement** — handle `account.updated`, schedule transfer draining, reconcile payouts, and expose status.
5. **Complete refund/dispute recovery money movement** — durable obligations without actual recovery do not close the ledger.
6. **Make `slop fork` create canonical immutable lineage before cloning** — one official path must guarantee the fork economics.
7. **Turn SLOPSHOP from a command generator into an executed, evidence-producing mod workflow** — real worktree, AST changes, agent, tests, feature ref, and rollback.
8. **Enforce trustworthy Git/verification policy before ref mutation** — pre-receive protection, server-owned offline checks, ancestry, and immutable evidence.
9. **Require an inspectable evidence package in INBOX before approval and perform a real fast-forward/merge** — eliminate blind hash approvals and semantic “merge” overclaiming.
10. **Create a single publish/readiness workflow and acceptance test** — repository → verified build → live artifact/download → active product/payouts → buy → shelf/license → canonical fork → contributor/ancestor transfer.
