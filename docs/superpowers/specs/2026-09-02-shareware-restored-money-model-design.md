# Shareware, Restored — Money Model Redesign

**Date:** 2026-09-02
**Status:** Approved design, ready for implementation plan
**Scope:** Full rewrite — replaces the 70/20/10 + 90/10 lineage split with a decay-based royalty model. Touches the commerce engine, tests, UI copy, docs, and adds a user-facing explainer.

---

## 1. Problem

The current financial model conflates two competing philosophies and is confusing to explain:

- **Root app sale:** 90% maker / 10% protocol.
- **Fork sale:** 70% maker (minus contributors) / 20% split evenly across ancestors / 10% protocol.

Two different splits, a platform-imposed 20% "lineage tax" nobody chose, a contributor carve-out, and a "protocol liquidity pool." Makers cannot reason about it. The recurring hard questions ("how do I set the % fairly?", "lines of code doesn't work") all stem from the platform imposing the split instead of letting makers set it.

## 2. The insight

The confusion was never the fork chain — it was that **makers had to reason about the split**. The fix is not a simpler formula; it is hiding the formula. A maker sets **one number** and never sees the chain math. The engine does the rest silently, the way a driver never computes the platform's take.

## 3. The model

### 3.1 License modes (maker picks exactly one per app, at publish)

| Mode | Fork it? | Resell your version? | Owes upstream? |
|------|----------|----------------------|----------------|
| **Personal** | Yes (for yourself) | No | No |
| **Resale (r%)** | Yes | Yes | Yes — a frozen lien (§3.3) |

Two modes only. **Resale with `r = 0%` is the "free to fork and resell" case** — no separate FREE mode needed, which also removes the "Royalty 0% == Free" collision. An app is exactly one mode.

> **Why the change from an earlier draft:** an earlier version of this spec used *nested* per-maker decay (each maker's cut computed off their child's cut) and let every listing pick its rate independently. A steelman review (Grok, 2026-09-02) found three blocking failures in that shape: (1) any intermediate maker could republish their fork at 0% and **zero out every ancestor above them**; (2) nested decay made "I get r%" false past the first hop — grandparents earned dust ($0.90 on a $100 sale, rounding to zero at shareware prices); (3) rates weren't frozen at fork, so an ancestor could hike their rate after a descendant built a business (hold-up). The model below fixes all three: **frozen liens that run with descendants, applied additively off the same base.**

### 3.2 The one number — and it's frozen onto the fork edge

When a maker publishes a **Resale** app they set **one rate `r`**, any value in `0% … 100%`. When someone **forks** that app, `r` is **frozen onto that fork edge forever** and the lien **runs with all descendants** of the fork. The forker can change the rate on *their own* new listing (waiving or setting *their own* future claim), but **they cannot drop or alter the liens they inherited.** This is the critical fix: a child can never zero out its ancestors.

- To an **ancestor**, the meaning is simply: *"Anyone who forks me and sells owes me my frozen `r%` of their sale — and so does everyone who forks them."* No chain math.
- To a **forker**, before they clone, the platform shows **`Σr` (the sum of all inherited liens) as their cost-of-goods.** They see exactly what forking this app will cost them on every future sale. This is the second critical fix: **the forker sees COGS; nobody has to pretend the number is something it isn't.**

**This answers the original "how do I set a fair %?" question:** the platform doesn't — each maker sets their own `r`, the fork market prices it (a high `Σr` deters forks; a low one attracts them), and the rate is locked at fork time so it can't be weaponized later.

Rate is an integer basis-points value in `[0, 10000]` (0–100%). At fork time, if the inherited `Σr` plus the current app's rate would exceed 100%, the **fork is blocked** (or the excess is clamped — decided in the plan).

### 3.3 Settlement on a paid sale of gross `G` cents

1. **Platform fee:** `platform = round(0.10 × G)`, off the top. Remainder `R = G − platform`.
2. **Additive ancestor liens off the same base `R`:** for each frozen ancestor lien `r_i` on the seller's fork chain, **oldest (root) first**:
   - `pay_i = round(r_i × R)`, taken **from `R`** (not from another ancestor's cut — additive, not nested).
   - If the running total would exceed `R`, later liens are truncated to what remains (this cannot normally happen because forks with `Σr > 100%` are blocked at §3.2).
3. **Seller keeps** `R − Σ pay_i`.

No nesting, no dust: a grandparent's `10%` is `10% of R`, the same base as the parent's — so deep originators earn real money, not pennies. Because `Σr ≤ 100%` is enforced at fork time, the seller is never over-charged.

### 3.4 Dropped concepts

- **Contributors** — removed. Co-authors settle off-platform out of the seller's own share.
- **Protocol liquidity pool** — removed. The 10% platform fee replaces it.
- **70/20/10 and 90/10 fixed splits** — removed.
- **Nested bilateral decay** and **"the maker never sees the chain"** — removed (per the steelman). Liens are additive and the forker is shown `Σr` up front.

### 3.5 Worked example

Chain Ann → Bob → Carol, each fork edge frozen at `r = 10%`. Carol sells for $100 (10000¢):

| Party | Computation | Keeps |
|-------|-------------|-------|
| Platform | round(0.10 × 10000) | **1000¢** ($10.00) |
| — | R = 10000 − 1000 = 9000 | |
| Ann (root lien, 10% of R) | round(0.10 × 9000) | **900¢** ($9.00) |
| Bob (lien, 10% of R) | round(0.10 × 9000) | **900¢** ($9.00) |
| Carol (seller) | R − 900 − 900 | **7200¢** ($72.00) |

Ann **cannot** be zeroed by Bob choosing 0% — her lien is frozen and runs with descendants. Bob may set *his own* new listing to 0% to attract forkers, but that only waives *Bob's* future claim, never Ann's. Carol saw `Σr = 20%` COGS before she forked.

**Conservation:** 1000 + 900 + 900 + 7200 = 10000. ✓

## 4. Invariants (preserved from current engine)

- **Conservation of cents:** Σ all allocations == gross. Enforced by a fatal guard.
- **Deterministic:** same inputs → same allocation, always. No floating drift; integer-cents rounding with the remainder absorbed by the seller.
- **Immutable allocation rows** recorded at purchase time; webhooks never move money directly, only enqueue outbox work.
- **Frozen liens are immutable once a fork edge exists.** The set of `(ancestor, r_i)` liens on a fork chain is captured at fork time and never mutated by any later listing rate change. This is a new first-class invariant.
- **`Σr ≤ 100%` enforced at fork time**, so settlement can never over-allocate.
- **Basis-points guard** from the old engine is replaced by the conservation-of-cents guard as the source of truth (allocations no longer sum to a fixed 10000 across fixed buckets, since the split is dynamic).

## 5. Deliverables

1. **`src/lib/commerceDomain.ts`** — rewrite `calculateAllocations`: platform 10% off the top, then **additive frozen-lien** allocations (`round(r_i × R)` per ancestor, oldest first), seller absorbs remainder. Remove contributor/pool branches. Keep the conservation guard; drop the fixed-BPS guard. Input is now the seller's **frozen lien set**, not live ancestor rates.
2. **Fork-time lien capture + `Σr ≤ 100%` gate** — wherever a fork is created (forge/`slop fork` provisioning + listing publish), snapshot the inherited liens onto the new edge and block/clamp forks whose `Σr` would exceed 100%. Likely a schema addition (a `fork_liens` table or a frozen-liens column on the listing/repo edge) — validated in the plan against the current listings/lineage schema.
3. **`src/lib/commerce/*` + `functions/api/*`** — update outbox/event/transfer processors to the new allocation shape (payout targets: platform, each ancestor lien-holder, seller). Remove protocol-pool and contributor payout paths.
4. **Explainer doc** — new markdown in `src/data/` (e.g. `moneyModelData.ts`), manifesto-voiced under the title **"Shareware, Restored"**, added as a tab in `WhitePapersView`. Explains the two modes, the frozen-lien-at-fork rule, the `Σr` COGS shown to forkers, and the additive worked example.
5. **SLOPSHOP** — add a visible "📜 How the money works →" link that opens the explainer; fix the hardcoded 70/20/10 strings in `SlopshopView.tsx` (lines ~42, ~550, ~615, ~1123, ~1453) and the live-preview split math (~1453) to the additive frozen-lien model; surface `Σr` COGS at fork time.
6. **Tests** — rewrite commerce/royalty/lineage/acceptance suites for additive-lien math + conservation + `Σr ≤ 100%` fork gate + frozen-lien immutability (a child cannot zero an ancestor). Delete contributor/pool tests. Add additive + rounding + deep-chain + single-hop + root-sale + 0%-child-cannot-drop-ancestor cases.
7. **Docs** — update `AGENTS.md` §1 (Lineage Ledger Economics) and `README.md` to describe the new model.
8. **Grok steelman** — DONE (2026-09-02). The additive frozen-lien model in this spec *is* the result of that review. A follow-up round can steelman the revised model before/after implementation.

## 6. Migration & data

- Existing `commerce_order_allocations` rows are immutable historical records under the OLD model; they are **not** rewritten. New orders use the new engine. If a migration is needed for schema (e.g. an `allocation_kind` enum change), it is additive and forward-only.
- License mode is a new per-app property. Where apps currently have no explicit mode, default to the maker's current behavior (paid = royalty at a default rate, or free) — exact default TBD in the plan after inspecting the listings schema.

## 7. Out of scope

- Changing the Stripe integration mechanics (signature verify, inbox, idempotency) beyond the allocation shape.
- Re-pricing or retroactively re-settling past orders.
- UI for the maker to *set* the rate is in scope for copy but the publish-form field wiring will be validated against the existing publish flow in the plan.

## 8. Execution

- Work happens in an **isolated git worktree** (money-critical; keep master clean).
- Sequence: engine + types → processors → tests green → explainer doc → SLOPSHOP link/copy → docs → Grok prompt.
