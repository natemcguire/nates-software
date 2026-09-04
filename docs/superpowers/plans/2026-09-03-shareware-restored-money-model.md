# Shareware, Restored — Money Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 70/20/10 + 90/10 lineage split with the "Shareware, Restored" model: two license modes, a per-listing maker-chosen royalty rate frozen onto the fork edge, additive ancestor liens off a post-platform-fee base, house-first rounding, owner-only refunds, and a prove-it-works publish gate.

**Architecture:** The money math is enforced in **three independent layers** that must stay consistent: (1) the domain calculator `src/lib/commerceDomain.ts::calculateAllocations`, (2) D1 table CHECK constraints, (3) D1 triggers on the outbox/recovery tables. We add a **frozen lien snapshot** captured at fork-confirm time (`repository_forks` → new `repository_fork_liens` rows), a **per-listing royalty rate** on `commerce_products`, and rewrite settlement to read liens instead of re-deriving equal splits. Everything is additive-migration and forward-only; historical allocations are never rewritten.

**Tech Stack:** TypeScript, Cloudflare Pages Functions, D1 (SQLite), Vitest, React (Win95 UI), Stripe Connect.

## Global Constraints

- **Rate range:** royalty rate is integer basis points in `[0, 10000]` (0–100%). Stored per listing.
- **Platform base fee:** `floor(0.10 × G)` off the top. Remainder `R = G − platform_base`.
- **Additive liens off `R`:** each ancestor lien `pay_i = floor(r_i × R / 10000)`, oldest (root) first. NOT nested.
- **House tip:** every maker allocation uses `floor`. All rounding dust accrues to the platform, on sale and on refund. `platform_total + Σ ancestor + seller == G` exactly.
- **Frozen liens:** the set of `(ancestor_user_id, ancestor_repository_id, r_i)` is captured at fork-confirm time and never mutated. A descendant can never alter or drop an inherited lien.
- **Σr ≤ 100% enforced at fork time.** A fork whose inherited `Σr` + the parent listing's rate would exceed 10000 bps is blocked.
- **No 0-amount / 0-bps allocation rows.** The existing table CHECK is `basis_points > 0`; a lien or slice computing to 0 is simply **not written** (skipped), never written as a 0 row.
- **Dropped:** contributors, protocol liquidity pool, `COMMERCE_BASIS_POINTS` fixed splits, `contributor_shares` carve at buy time, the `contributor` and `protocol_pool` allocation roles.
- **Refunds:** all sales final. Only `role === 'super_admin'` (Nate, `usr_nate`) may initiate, via `requireSuperAdmin`. No buyer/maker refund path may be created.
- **Prove-it gate:** a `commerce_products` row may only be `status='active'` (purchasable) when its repo has a real built commit (extends the existing `repositoryHasCommit` honesty gate).
- **Every money change keeps all three layers consistent.** Touching the domain calc means auditing the table CHECKs and all four triggers (`commerce_outbox_requires_fulfilled_allocation`, `commerce_transfer_economics_immutable`, `commerce_recovery_matches_order_allocation`, `commerce_reversal_cumulative_guard`) and the role lists in `eventProcessor.ts`.
- **Commit after every green step.** Run `npm test` for money-touching tasks before committing.

---

## File Structure

**New files:**
- `migrations/0038_shareware_restored_money_model.sql` — additive: `repository_fork_liens` table, `commerce_products.royalty_bps` column, allocation `role` widening to `platform` (+ keep legacy roles readable), trigger updates.
- `src/lib/royaltyLiens.ts` — pure functions: capture liens at fork, compute `Σr`, the `Σr ≤ 100%` gate.
- `src/data/moneyModelData.ts` — the "Shareware, Restored" explainer markdown.
- `functions/api/payments/refund.ts` — owner-only (`requireSuperAdmin`) refund initiation endpoint.
- `tests/money-model-additive-liens.test.ts`, `tests/money-model-fork-lien-capture.test.ts`, `tests/money-model-refund-owner-only.test.ts`, `tests/money-model-publish-gate.test.ts`, `tests/money-model-explainer.test.tsx`.

**Modified files:**
- `src/lib/commerceDomain.ts` — rewrite `calculateAllocations` + `fetchRepositoryAncestry` → lien-based.
- `src/lib/commerce/recoveryDomain.ts` — house-first flooring in `calculateRefundAllocationDelta`.
- `src/lib/commerce/eventProcessor.ts` — payout role filter (`platform` excluded like `protocol_pool` was; drop `contributor`).
- `functions/api/payments/create-intent.ts` — feed liens into allocation.
- `functions/api/git.ts` — capture liens in the `gateway-confirm-fork` batch; `Σr ≤ 100%` gate in the `fork` phase.
- `functions/api/drops.ts` — accept + persist `royalty_bps`; keep the prove-it gate.
- `src/views/SlopshopView.tsx` — fix 70/20/10 copy, add explainer link, show `Σr` COGS.
- `src/views/WhitePapersView.tsx` + `src/data/whitepapersData.ts` (or new data file) — add explainer tab.
- `AGENTS.md`, `README.md` — model + ethos description.

---

## Phase A — Domain calculator (pure, no DB)

### Task A1: New allocation types + house-first additive calculator

**Files:**
- Modify: `src/lib/commerceDomain.ts`
- Test: `tests/money-model-additive-liens.test.ts` (create)

**Interfaces:**
- Produces: `interface LienInput { ancestorUserId: string; ancestorRepositoryId: string | null; bps: number; depth: number }`
- Produces: `calculateAllocations(input: AllocationCalculationInput): AllocationCalculationResult` where `AllocationCalculationInput` becomes `{ grossCents: number; currency: string; sellerUserId: string; sellerRepositoryId?: string | null; liens?: readonly LienInput[] | null }` (replaces `ancestors`/`contributors`).
- Produces: `OrderAllocationSnapshot` role union becomes `'platform' | 'ancestor' | 'seller'`.

- [ ] **Step 1: Write the failing test** — additive math + house tip + skip-zero.

```ts
// tests/money-model-additive-liens.test.ts
import { describe, it, expect } from 'vitest';
import { calculateAllocations } from '../src/lib/commerceDomain';

describe('additive frozen-lien allocations', () => {
  it('Ann->Bob->Carol all 10%, $100 → platform 1000, Ann 900, Bob 900, seller 7200', () => {
    const r = calculateAllocations({
      grossCents: 10000, currency: 'usd', sellerUserId: 'carol', sellerRepositoryId: 'repo_c',
      liens: [
        { ancestorUserId: 'ann', ancestorRepositoryId: 'repo_a', bps: 1000, depth: 2 },
        { ancestorUserId: 'bob', ancestorRepositoryId: 'repo_b', bps: 1000, depth: 1 },
      ],
    });
    const by = (role: string) => r.allocations.filter(a => a.role === role);
    expect(by('platform').reduce((s,a)=>s+a.amountCents,0)).toBe(1000);
    expect(by('ancestor').find(a=>a.recipientUserId==='ann')!.amountCents).toBe(900);
    expect(by('ancestor').find(a=>a.recipientUserId==='bob')!.amountCents).toBe(900);
    expect(by('seller')[0].amountCents).toBe(7200);
    expect(r.allocations.reduce((s,a)=>s+a.amountCents,0)).toBe(10000);
  });

  it('root sale (no liens) → platform 1000, seller 9000', () => {
    const r = calculateAllocations({ grossCents: 10000, currency: 'usd', sellerUserId: 'ann', sellerRepositoryId: 'repo_a', liens: [] });
    expect(r.allocations.find(a=>a.role==='platform')!.amountCents).toBe(1000);
    expect(r.allocations.find(a=>a.role==='seller')!.amountCents).toBe(9000);
    expect(r.allocations.some(a=>a.role==='ancestor')).toBe(false);
  });

  it('house tip: $9.95 dust accrues to platform, conservation exact', () => {
    // platform_base = floor(0.10*995)=99, R=896; lien 10% -> floor(0.10*896)=89 (bob), floor(0.10*896)=89 (ann)
    const r = calculateAllocations({
      grossCents: 995, currency: 'usd', sellerUserId: 'carol', sellerRepositoryId: 'repo_c',
      liens: [
        { ancestorUserId: 'ann', ancestorRepositoryId: 'repo_a', bps: 1000, depth: 2 },
        { ancestorUserId: 'bob', ancestorRepositoryId: 'repo_b', bps: 1000, depth: 1 },
      ],
    });
    const platform = r.allocations.filter(a=>a.role==='platform').reduce((s,a)=>s+a.amountCents,0);
    const sum = r.allocations.reduce((s,a)=>s+a.amountCents,0);
    expect(sum).toBe(995);            // conservation exact
    expect(platform).toBeGreaterThanOrEqual(99); // base + any dust
  });

  it('skips a 0% lien instead of writing a 0-amount row', () => {
    const r = calculateAllocations({
      grossCents: 10000, currency: 'usd', sellerUserId: 'carol', sellerRepositoryId: 'repo_c',
      liens: [{ ancestorUserId: 'bob', ancestorRepositoryId: 'repo_b', bps: 0, depth: 1 }],
    });
    expect(r.allocations.some(a=>a.role==='ancestor')).toBe(false);
    expect(r.allocations.every(a=>a.amountCents>0)).toBe(true);
  });

  it('throws if liens sum > 100%', () => {
    expect(() => calculateAllocations({
      grossCents: 10000, currency: 'usd', sellerUserId: 'x', sellerRepositoryId: 'r',
      liens: [{ ancestorUserId:'a', ancestorRepositoryId:'ra', bps: 9000, depth:2 }, { ancestorUserId:'b', ancestorRepositoryId:'rb', bps: 2000, depth:1 }],
    })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/money-model-additive-liens.test.ts`
Expected: FAIL (old `calculateAllocations` uses `ancestors`/`contributors`, no `platform`/`seller` roles).

- [ ] **Step 3: Rewrite the calculator.** In `src/lib/commerceDomain.ts`:
  - Replace `AllocationRole` with `export type AllocationRole = 'platform' | 'ancestor' | 'seller';`
  - Add `export const PLATFORM_FEE_BPS = 1000;`
  - Add `export interface LienInput { ancestorUserId: string; ancestorRepositoryId: string | null; bps: number; depth: number }`.
  - Change `AllocationCalculationInput` to `{ grossCents; currency; sellerUserId; sellerRepositoryId?; liens? }`.
  - New body (keep `validateGrossCents`/`validateCurrency`/`validateSellerUserId`):

```ts
export function calculateAllocations(input: AllocationCalculationInput): AllocationCalculationResult {
  const grossCents = validateGrossCents(input.grossCents);
  const currency = validateCurrency(input.currency);
  const sellerUserId = validateSellerUserId(input.sellerUserId);
  const liens = (input.liens ?? []).slice().sort((a, b) => b.depth - a.depth); // root (highest depth) first
  const totalLienBps = liens.reduce((s, l) => s + l.bps, 0);
  if (totalLienBps > COMMERCE_BASIS_POINTS.TOTAL) {
    throw new CommerceValidationError(`Inherited liens (${totalLienBps} bps) exceed 100%`);
  }

  const platformBase = Math.floor((grossCents * PLATFORM_FEE_BPS) / COMMERCE_BASIS_POINTS.TOTAL);
  const R = grossCents - platformBase;

  const allocations: OrderAllocationSnapshot[] = [];
  let sequence = 1;
  let ancestorTotal = 0;
  for (const lien of liens) {
    if (lien.bps <= 0) continue; // skip-zero: never write a 0-amount row
    const pay = Math.floor((R * lien.bps) / COMMERCE_BASIS_POINTS.TOTAL);
    if (pay <= 0) continue;
    ancestorTotal += pay;
    allocations.push({
      sequence: sequence++, role: 'ancestor', recipientUserId: lien.ancestorUserId,
      sourceRepositoryId: lien.ancestorRepositoryId, lineageDepth: lien.depth,
      basisPoints: lien.bps, amountCents: pay,
    });
  }

  const sellerCents = R - ancestorTotal;             // floored remainder of R
  const platformDust = grossCents - platformBase - ancestorTotal - sellerCents; // ≥ 0
  const platformTotal = platformBase + platformDust; // house tip

  allocations.push({
    sequence: sequence++, role: 'seller', recipientUserId: sellerUserId,
    sourceRepositoryId: input.sellerRepositoryId ?? null, lineageDepth: 0,
    basisPoints: null, amountCents: sellerCents,
  });
  allocations.push({
    sequence: sequence++, role: 'platform', recipientUserId: null,
    sourceRepositoryId: null, lineageDepth: null, basisPoints: null, amountCents: platformTotal,
  });

  const total = allocations.reduce((s, a) => s + a.amountCents, 0);
  if (total !== grossCents) {
    throw new Error(`FATAL INVARIANT VIOLATION: allocated cents (${total}) != gross cents (${grossCents})`);
  }
  // ... build snapshot/result object (see Step 3b) ...
}
```
  - `OrderAllocationSnapshot.basisPoints` becomes `number | null` (platform/seller have none). Update the interface.
  - Remove the `totalAllocatedBps === 10000` guard entirely (splits are dynamic now).
  - Simplify `AllocationCalculationResult` to `{ isRoot; grossCents; currency; platformCents; sellerCents; ancestorTotalCents; allocations; snapshot; snapshotJson; conservationVerified }`. `isRoot = liens.length === 0`.

- [ ] **Step 3b: Build the snapshot payload** matching the new result shape (drop maker/lineage/pool/contributor fields; add `platformCents`, `sellerCents`, `ancestorAllocations`). Serialize with `JSON.stringify`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/money-model-additive-liens.test.ts`
Expected: PASS (all 5 cases).

- [ ] **Step 5: Delete now-dead code** — `validateAncestors`, `validateContributors`, `ContributorInput/Node`, `AncestorInput/Node`, `COMMERCE_BASIS_POINTS.ROOT_*/FORK_*`, `MAKER_FLOOR_BPS`, `DEFAULT_LINEAGE_POLICY`. Keep `COMMERCE_BASIS_POINTS.TOTAL`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/commerceDomain.ts tests/money-model-additive-liens.test.ts
git commit -m "feat(money): additive frozen-lien allocation calculator with house-tip rounding"
```

---

### Task A2: `fetchRepositoryAncestry` → `fetchFrozenLiens`

**Files:**
- Modify: `src/lib/commerceDomain.ts` (replace `fetchRepositoryAncestry`)
- Test: covered by Task B2 integration (fork-lien capture) + a unit test here.

**Interfaces:**
- Produces: `async function fetchFrozenLiens(db, sellerRepositoryId: string): Promise<LienInput[]>` — reads the captured `repository_fork_liens` rows for the seller's repo, ordered root-first.

- [ ] **Step 1: Write failing test** with a fake DB returning lien rows; assert it maps to `LienInput[]` sorted by depth desc.
- [ ] **Step 2: Run — FAIL** (`fetchFrozenLiens` undefined).
- [ ] **Step 3: Implement** — single indexed query over `repository_fork_liens WHERE holder_of_repository_id = ?` (see schema in Task B1); map columns → `LienInput`. This replaces the per-generation walk (no more subrequest amplification).
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** `feat(money): read frozen liens instead of walking ancestry at buy time`.

---

## Phase B — Schema + fork-time lien capture

### Task B1: Migration 0038 (additive)

**Files:**
- Create: `migrations/0038_shareware_restored_money_model.sql`
- Test: `tests/migration-chain-integrity.test.ts` (existing — extend to assert 0038 applies)

- [ ] **Step 1: Write the migration.** Contents:
  - `ALTER TABLE commerce_products ADD COLUMN royalty_bps INTEGER NOT NULL DEFAULT 0 CHECK (royalty_bps >= 0 AND royalty_bps <= 10000);`
  - New table:
```sql
CREATE TABLE repository_fork_liens (
  id TEXT PRIMARY KEY,
  holder_of_repository_id TEXT NOT NULL REFERENCES repositories(id),  -- the descendant whose sales owe this lien
  ancestor_repository_id TEXT NOT NULL REFERENCES repositories(id),
  ancestor_user_id TEXT NOT NULL REFERENCES users(id),
  bps INTEGER NOT NULL CHECK (bps > 0 AND bps <= 10000),  -- 0% liens are simply not written
  depth INTEGER NOT NULL CHECK (depth > 0),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (holder_of_repository_id, ancestor_repository_id)
);
CREATE INDEX idx_fork_liens_holder ON repository_fork_liens(holder_of_repository_id, depth);
CREATE TRIGGER repository_fork_liens_immutable_update BEFORE UPDATE ON repository_fork_liens
  BEGIN SELECT RAISE(ABORT, 'fork liens are immutable'); END;
CREATE TRIGGER repository_fork_liens_immutable_delete BEFORE DELETE ON repository_fork_liens
  BEGIN SELECT RAISE(ABORT, 'fork liens are immutable'); END;
```
  - Widen the allocation role CHECK to accept the new roles while remaining backward-readable. Because SQLite can't ALTER a CHECK, and `commerce_order_allocations` is immutable-by-trigger, do a guarded table-rebuild ONLY if required; otherwise add the new roles via a compatibility approach. **Decision:** rebuild `commerce_order_allocations` CHECK to `role IN ('maker','ancestor','protocol_pool','contributor','platform','seller')` and change `basis_points` CHECK to `basis_points IS NULL OR (basis_points > 0 AND basis_points <= 10000)` (platform/seller rows carry NULL bps). Preserve existing rows, indexes, and immutability triggers. Update the recipient-nullability CHECK to: `(role='platform' AND recipient_user_id IS NULL) OR (role IN ('ancestor','seller','maker','contributor') AND recipient_user_id IS NOT NULL) OR (role='protocol_pool' AND recipient_user_id IS NULL)`.
  - Update the four economic triggers' role lists to include `'seller'` as payable and `'platform'` as non-payable (mirror how `protocol_pool` was excluded): `commerce_outbox_requires_fulfilled_allocation`, `commerce_recovery_matches_order_allocation` → `a.role IN ('maker','ancestor','contributor','seller')`. (`platform` is never paid out via Connect — it's the house.)

- [ ] **Step 2: Apply against a scratch D1** (local): `npx wrangler d1 execute nates-software-preview-db --local --file migrations/0038_shareware_restored_money_model.sql` (or the project's migration runner). Expected: applies clean.
- [ ] **Step 3: Run migration-chain test** — `npx vitest run tests/migration-chain-integrity.test.ts`. Expected: PASS.
- [ ] **Step 4: Commit** `feat(db): migration 0038 — fork liens table, royalty_bps, allocation roles`.

---

### Task B2: Capture liens in `gateway-confirm-fork`

**Files:**
- Modify: `functions/api/git.ts` (the confirm batch at ~`1126-1167`)
- Create: `src/lib/royaltyLiens.ts`
- Test: `tests/money-model-fork-lien-capture.test.ts` (create)

**Interfaces:**
- Produces (`royaltyLiens.ts`): `function buildInheritedLiens(parentLiens: LienInput[], parentListingBps: number, parentRepositoryId: string, parentUserId: string, childRepositoryId: string): { liens: NewLienRow[]; sumBps: number }` where `NewLienRow = { holderOfRepositoryId; ancestorRepositoryId; ancestorUserId; bps; depth }`.
- Produces: `function assertForkAllowed(sumBps: number): void` — throws `CommerceValidationError` if `> 10000`.

- [ ] **Step 1: Write failing test** for `buildInheritedLiens`: parent had liens `[Ann@10%,depth1]`, parent listing rate 10%, child fork → produces child liens `[Ann@10%,depth2],[Bob(parent)@10%,depth1]`, sum 2000.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement `royaltyLiens.ts`** — inherited liens = parent's own liens (depth+1) ∪ a new lien for the immediate parent at `parentListingBps` (depth 1), all `holder = childRepositoryId`; skip 0-bps; `sumBps = Σ`.
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Wire into `git.ts` confirm batch** — before the `repository_forks` insert, load the parent's `royalty_bps` (from `commerce_products` by parent repo) and parent's liens (`repository_fork_liens WHERE holder_of_repository_id = parentRepositoryId`), call `buildInheritedLiens`, and add `INSERT INTO repository_fork_liens (...)` statements for each new lien into the same atomic `db.batch`. (Immutable ancestry + immutable liens written together.)
- [ ] **Step 6: Integration test** (`money-model-fork-lien-capture.test.ts`) against a test D1: seed Ann root (10%), Bob forks (confirm), Carol forks Bob (confirm), assert `repository_fork_liens` for Carol's repo = Ann@1000/depth2 + Bob@1000/depth1.
- [ ] **Step 7: Run — PASS. Commit** `feat(fork): capture frozen royalty liens at fork-confirm`.

---

### Task B3: `Σr ≤ 100%` gate in the fork request phase

**Files:**
- Modify: `functions/api/git.ts` (the `action==='fork'` phase ~`2039-2106`)
- Test: extend `tests/money-model-fork-lien-capture.test.ts`

- [ ] **Step 1: Write failing test** — attempting to fork a chain whose inherited `Σr` + parent rate > 10000 bps returns a 4xx and writes no fork.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** — in the fork phase, compute prospective `sumBps` via `buildInheritedLiens` (dry, no write) and call `assertForkAllowed`; on throw, return `jsonError(...)` (match the file's existing error helper) before the provisioning batch.
- [ ] **Step 4: Run — PASS. Commit** `feat(fork): block forks whose total liens exceed 100%`.

---

## Phase C — Buy-time + payout wiring

### Task C1: Feed liens into `create-intent`

**Files:**
- Modify: `functions/api/payments/create-intent.ts` (~`347-463`)
- Test: `tests/commerce-create-intent.test.ts` (existing — update expectations)

- [ ] **Step 1: Update the existing create-intent test** expectations to the new roles/amounts (drop contributor/pool assertions; assert `platform`+`seller`+`ancestor` rows, house-tip conservation).
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** — replace `fetchRepositoryAncestry(...)` + `contributor_shares` load with `fetchFrozenLiens(db, sellerRepositoryId)`; call `calculateAllocations({ grossCents, currency, sellerUserId, sellerRepositoryId, liens })`. Update the allocation-insert loop to bind `basis_points` as nullable and to **skip** any allocation with `amountCents <= 0` (defense-in-depth; calculator already skips). Store the new `snapshotJson`.
- [ ] **Step 4: Run — PASS. Commit** `feat(money): settle purchases via frozen liens`.

### Task C2: Payout role filter

**Files:**
- Modify: `src/lib/commerce/eventProcessor.ts` (~`459-482`)
- Test: `tests/commerce-event-processor.test.ts` (existing — update)

- [ ] **Step 1: Update test** — payable roles are now `'ancestor'` and `'seller'`; `'platform'` is excluded (like `protocol_pool` was). No `contributor`.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** — change the filter to `if ((alloc.role === 'seller' || alloc.role === 'ancestor') && alloc.amountCents > 0 && alloc.recipientUserId)`.
- [ ] **Step 4: Run — PASS. Commit** `feat(payouts): pay seller + ancestors, house keeps platform slice`.

### Task C3: House-first refund flooring

**Files:**
- Modify: `src/lib/commerce/recoveryDomain.ts` (`calculateRefundAllocationDelta`)
- Test: `tests/commerce-refund-allocation.test.ts` (existing — update)

- [ ] **Step 1: Update test** — on partial refund, maker/ancestor clawbacks floor and the platform absorbs the dust; never claw back more than a recipient received.
- [ ] **Step 2: Run — FAIL** (if behavior differs).
- [ ] **Step 3: Implement** — ensure the delta uses `floor` per payable allocation and routes any remainder to the platform/non-payable bucket (never increases a maker clawback due to rounding).
- [ ] **Step 4: Run — PASS. Commit** `fix(refund): house-first flooring on clawbacks`.

---

## Phase D — Refund policy + publish gate

### Task D1: Owner-only refund endpoint

**Files:**
- Create: `functions/api/payments/refund.ts`
- Test: `tests/money-model-refund-owner-only.test.ts` (create)

**Interfaces:**
- Consumes: `requireSuperAdmin(request, env)` from `functions/api/ops/_guard.ts`.

- [ ] **Step 1: Write failing tests** — (a) non-super_admin session → 403; (b) unauthenticated → 401; (c) super_admin → issues `POST /v1/refunds` to Stripe (mock fetch) with the order's payment intent and returns 200.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** — `onRequestPost`: `const guard = await requireSuperAdmin(request, env); if (guard.errorResponse) return guard.errorResponse;` then validate the order id, look up the payment intent, `POST https://api.stripe.com/v1/refunds` with an idempotency key. Do NOT record money movement here — the existing `refundProcessor` webhook records it. Return the Stripe refund id.
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Grep guard** — add a test asserting no non-admin route anywhere POSTs `/v1/refunds` (protects the "buyer beware" invariant). Run `grep -rn "v1/refunds" functions/ src/` and assert only `refund.ts` (POST) + `refundProcessor.ts` (GET) match.
- [ ] **Step 6: Commit** `feat(refund): owner-only discretionary refund endpoint`.

### Task D2: Prove-it publish gate (assert + document)

**Files:**
- Modify: `functions/api/drops.ts` (~`383-392`, `564-565`)
- Test: `tests/money-model-publish-gate.test.ts` (create)

- [ ] **Step 1: Write failing test** — publishing a listing whose repo has no built commit yields `commerce_products.status='draft'` (not purchasable), and buy-time `create-intent` rejects a `draft` product. (This largely already holds — the test pins it as an invariant so a regression fails.)
- [ ] **Step 2: Run — likely PASS for the publish half; FAIL if any gap** on the buy-time reject. Fix any gap so both hold.
- [ ] **Step 3: Ensure** the `honestProductStatus` logic stays and add a code comment tying it to the ethos (spec §3.7). If `create-intent` doesn't already reject non-active products, add that check.
- [ ] **Step 4: Run — PASS. Commit** `feat(ethos): only proven-to-build listings are purchasable`.

---

## Phase E — Publish rate UI + explainer + copy

### Task E1: Accept `royalty_bps` at publish — API + the actual UI form

**Context:** The maker sets their listing PRICE in the "Set Listing Price" modal in `src/views/SlopshopView.tsx` (modal block ~`1416-1456`, state `publishPrice`/`setPublishPrice` at ~`67-68`, opened via `setModalType('price')` ~`1224`, button label ~`1228`). This same modal is where the maker must ALSO set their **royalty rate** — a real input, not a hardcoded value. The publish request flows to `POST /api/drops` (`functions/api/drops.ts`), which writes `commerce_products` (~`566-578`) with validation near `~431-492`. The `slop publish` CLI echo lines in SlopshopView (~`530`, ~`537`) must carry the rate too.

**Files:**
- Modify: `functions/api/drops.ts` (accept + validate `royaltyBps`; bind into the `commerce_products` insert)
- Modify: `src/views/SlopshopView.tsx` (add a royalty-% input to the Set-Listing-Price modal; new state `publishRoyaltyPct`/`setPublishRoyaltyPct`; thread it into the publish request body and the `slop publish` echo)
- Test (API): `tests/hotwire.test.ts` or `tests/checkout-flow.test.tsx` (whichever covers drops publish) — add a case.
- Test (UI): `tests/slopshop-redesign.test.tsx` (existing) — assert the royalty input renders and its value is sent on publish.

**Constraints (from Global Constraints):** rate is 0–100% shown to the user, stored as integer basis points `[0,10000]` (percent × 100). Default 0 (= free to fork & resell). NEVER hardcode the rate anywhere — it is always the maker's chosen value. Do not hardcode a suggested/placeholder rate that gets silently submitted; an empty field means 0.

- [ ] **Step 1: Write failing API test** — publishing with `royaltyBps: 1500` persists `commerce_products.royalty_bps = 1500`; `royaltyBps: 10001` is rejected (4xx); omitted → defaults to 0.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement API** — validate `royaltyBps` ∈ [0,10000] (integer; default 0), bind into the `commerce_products` insert. Match the file's existing validation/error style (see the `grantable_bps` validation nearby as a pattern).
- [ ] **Step 4: Run API test — PASS.**
- [ ] **Step 5: Write failing UI test** in `tests/slopshop-redesign.test.tsx` — the Set-Listing-Price modal renders a royalty-rate input (label mentions "royalty"/"%"); entering e.g. `15` and publishing includes `royaltyBps: 1500` in the request body. (Grep the modal's publish handler to see how the request is built; assert on the fetch/gateway payload.)
- [ ] **Step 6: Run — FAIL.**
- [ ] **Step 7: Implement UI** — add `publishRoyaltyPct` state (string, default ''), a labeled number input in the price modal ("Your royalty when someone forks & resells this (%)"), convert to bps (`Math.round(pct*100)`, clamp 0–10000) when building the publish body, and include it in the `slop publish` echo lines. Convert a blank field to 0.
- [ ] **Step 8: Run UI test — PASS. Commit** `feat(publish): maker sets per-listing royalty rate (API + form)`.

> NOTE: The 70/20/10 **split-preview** math inside this same modal (~`1446-1449`) is fixed in Task E3 (it rewrites all SlopshopView money copy in one pass). E1 adds the input + persistence; E3 rewrites the preview to the additive model driven by this input. The two tasks touch the same file — run E1 before E3 and let E3 rebase onto E1's changes.

### Task E2: "Shareware, Restored" explainer doc + tab

**Files:**
- Create: `src/data/moneyModelData.ts`
- Modify: `src/views/WhitePapersView.tsx` (add a 6th tab)
- Test: `tests/money-model-explainer.test.tsx` (create)

- [ ] **Step 1: Write failing test** — `WhitePapersView` renders a "Shareware, Restored" tab; the markdown contains "frozen", "10%", "buyer beware", and the Ann/Bob/Carol example; asserts it does NOT contain "70 / 20 / 10".
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Author `moneyModelData.ts`** — export a markdown string (manifesto voice, anti-slop) covering: the two modes, one rate frozen at fork, `Σr` COGS shown to forkers, additive settlement + house tip, all-sales-final + owner discretion, prove-it-before-sale ethos, worked example. Add it as `moneyModel` in the papers map with a title/subtitle/icon.
- [ ] **Step 4: Run — PASS. Commit** `feat(docs): Shareware, Restored explainer`.

### Task E3: Fix all remaining 70/20/10 copy (SLOPSHOP + ProfileView) + explainer link + Σr COGS

**Context:** After E1 adds the royalty input, the last hardcoded 70/20/10 money copy lives in two views. Rewrite ALL of it to the additive model. (MarketingWindow + TldrButton were already fixed ad-hoc in commit 935717d — do not touch those; just confirm no 70/20/10 remains anywhere with a grep.)

**Files:**
- Modify: `src/views/SlopshopView.tsx` — `STATUS_MESSAGES[4]` (~`42`, "Sales settle 70 / 20 / 10"), the `slop publish` help line "(70/20/10 split)" (~`615`), the publish-panel body string ~`550`, the "up the fork lineage" block ~`1123`, and the live split-preview math in the price modal (~`1446-1449`, the `* 0.7 / 0.2 / 0.1` lines + "protocol liquidity"). Replace with the additive preview driven by the E1 royalty input + inherited `Σr`: show platform 10%, each upstream lien, and the seller's remainder. Add a "📜 How the money works" affordance opening the E2 explainer (reuse an `onOpen*` prop or add `onOpenWhitePapers`).
- Modify: `src/views/ProfileView.tsx` — the earnings/Stripe labels at ~`658` ("Total earned · your 70% + 20% from forks"), ~`664` ("from your sales (70%) · … from forks of your apps (20%)"), and ~`956` ("Get paid via Stripe (your 70% + 20% from forks):"). Rewrite to model-neutral language: e.g. "Total earned · your sales + royalties from forks", "from your sales · from forks of your apps", "Get paid via Stripe". Do NOT invent new percentages — earnings are now dynamic per lien, so the labels must not state any fixed split. Verify the underlying `royalties.makerSalesCents` / `royalties.lineageEarnedCents` data still maps sensibly (rename display copy only; if those fields' semantics changed under the new model, note it — do not silently mislabel).
- Test: `tests/slopshop-redesign.test.tsx` (existing) and a ProfileView test if one exists (grep `tests/` for ProfileView; if none, add a minimal render assertion that no "70%"/"20%"/"70 / 20 / 10" text appears).

- [ ] **Step 1: Update/author tests** — assert neither SlopshopView nor ProfileView renders "70%", "20%", "70 / 20 / 10", "protocol liquidity", or "up the fork lineage"; SlopshopView renders a "How the money works" affordance; the price-modal preview shows platform 10% + seller remainder computed from the royalty input.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** the rewrites above.
- [ ] **Step 4: Grep guard** — `grep -rn "70 / 20 / 10\|70%\|20%\|protocol liquidity\|up the fork lineage" src/` returns nothing (except unrelated legitimate matches, which you must justify). 
- [ ] **Step 5: Run — PASS. Commit** `feat(ui): retire all remaining 70/20/10 copy; additive money preview + explainer link`.

---

### Task C4: Exclude 'platform' from refund/dispute recovery obligations

**Context:** C3's review surfaced that `src/lib/commerce/refundProcessor.ts` (~248) and `src/lib/commerce/disputeProcessor.ts` (~314) only exclude the legacy `'protocol_pool'` role when creating `commerce_recovery_obligations`. Under the new model the house role is `'platform'` (recipient null). So a refund/dispute of an order that has a platform allocation would attempt to create a recovery obligation against the house — wrong (you don't claw back the house's own fee from itself). This is a real money bug.

- [ ] **Step 1** — Write/extend a test: refunding an order with platform+seller+ancestor allocations creates recovery obligations ONLY for seller+ancestor, NOT for platform. (Also dispute path if it has a test harness.)
- [ ] **Step 2** — Run → RED (a platform obligation is wrongly created, OR it errors on the null recipient).
- [ ] **Step 3** — In both files, change the role-exclusion to skip BOTH `'protocol_pool'` AND `'platform'` (i.e. only create obligations for payable roles seller/ancestor/legacy maker/contributor; skip house roles). Match each file's existing guard style.
- [ ] **Step 4** — Run → GREEN. Commit `fix(refund): never claw back the house (exclude platform from recovery obligations)`.

## Phase F — Docs + full-suite green

### Task F1: AGENTS.md + README

**Files:** Modify `AGENTS.md` (§1 Lineage Ledger Economics), `README.md`.

- [ ] **Step 1: Rewrite** AGENTS.md §1 to the additive frozen-lien model + ethos; update README's money description. Remove 70/20/10 / 90/10 / protocol-pool language.
- [ ] **Step 2: Commit** `docs: AGENTS/README describe Shareware, Restored`.

### Task F2: Full suite + dead-test sweep

- [ ] **Step 1: Run** `npm test`. Expected failures: old contributor/pool/70-20-10 tests.
- [ ] **Step 2: For each failing legacy test** — if it asserts a dropped concept (contributor carve, protocol pool, 20% even split), delete it or rewrite to the new model. Files to sweep: `tests/royalty-lineage.test.ts`, `tests/contributor-revenue-sharing-schema.test.ts`, `tests/commerce-create-intent-contributors.test.ts`, `tests/marketplace-phase3a-grant-recording.test.ts`, `tests/acceptance-buy-own-fork-payout.test.ts`, `tests/commerce-domain.test.ts`.
- [ ] **Step 3: Run** `npm test` until green. Then `npm run build` (type-check).
- [ ] **Step 4: Commit** `test: align suite with Shareware, Restored money model`.

---

### Task E4: Sweep ALL remaining 70/20/10 copy across the app

**Context:** E3 (and the ad-hoc MarketingWindow fix) revealed the old 70/20/10 / 90/10 / "protocol pool" / "up the chain" language is scattered across ~14 files, far beyond SlopshopView/ProfileView. This task retires every remaining user-facing instance and any backend user-visible string.

**Files (verify with grep; some matches may be legit non-money e.g. CSS `70%` opacity — justify those):**
- `src/views/MarketingWindow.tsx` (the "Get paid on every sale" section ~165-172 — the earlier fix only got the top box)
- `src/components/CheckoutModal.tsx`, `src/components/ForkWithAiModal.tsx`, `src/components/AuthModal.tsx`, `src/components/ArtifactSandbox.tsx`
- `src/views/PostEditorView.tsx`, `src/views/SetupWizardView.tsx`, `src/views/GitsmithView.tsx`
- `src/lib/hotwireBackend.ts`, `src/lib/slopshopDomain.ts` (user-visible strings/help text)
- `src/lib/commerce/transferWorker.ts`, `src/lib/commerce/eventProcessor.ts` (comments/log strings — update if they assert the old split; code role-lists already handled in C2)
- `functions/tree/[app].ts`, `bin/slop.ts`

- [ ] **Step 1** — For each file, grep `70%|20%|90/10|70 / 20 / 10|70/20/10|protocol pool|protocol liquidity|up the chain|up the fork lineage`, read each match, and classify: money-model copy (rewrite to: platform flat 10%, upstream makers earn their frozen royalty, seller keeps the rest) vs. legit non-money (justify/keep).
- [ ] **Step 2** — Rewrite all money-model matches. Keep each edit minimal and in the surrounding voice.
- [ ] **Step 3** — Add/extend a test that greps the built source for banned money phrases and fails if any remain (a repo-wide guard test), excluding justified non-money matches by exact location.
- [ ] **Step 4** — `npm run build` (type-check) + run affected view tests. Commit `feat(ui): sweep all remaining 70/20/10 copy to the additive model`.

---

## Self-Review Notes (spec coverage)

- §3.1 two modes → E1/E2/E3 (rate + copy) and D2 (Personal=non-purchasable-until-built is the gate; "no resale" mode enforcement is a listing flag surfaced in copy — if a hard DB flag is wanted, add to B1's `commerce_products`).
- §3.2 one rate frozen at fork → B2 (capture), B3 (Σr gate), E1 (set rate).
- §3.3 settlement + house tip → A1.
- §3.6 owner-only refunds → D1 + C3.
- §3.7 prove-it ethos → D2.
- §4 invariants → A1 (conservation), B1 (CHECKs/triggers), C3 (house-first refund).
- Explainer/manifesto → E2. SLOPSHOP link/copy → E3. Docs → F1.

**Open item for executor:** §3.1 "Personal (no resale)" — decide in B1 whether to add an explicit `license_mode` column on `commerce_products` (`'personal' | 'resale'`) or derive it (resale iff `royalty_bps` set + resell allowed). Recommended: add the column for clarity; default `'resale'`.
