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
| **Free** | Yes | Yes | No |
| **Source-available** | Yes (for yourself) | No | No |
| **Royalty** | Yes | Yes | Yes — decay (§3.3) |

An app is **exactly one** mode. It can never be both "free" and "royalty-bearing." This single rule eliminates the 90/10-vs-70/20/10 duality.

### 3.2 The one number

Every maker sets **one royalty rate** at publish — any value in **`0% … 100%`**, their free choice per listing. No platform-imposed default philosophy, no floor, no cap below 100%. Its entire meaning to the maker:

> "Fork me, sell it, I get my cut."

The maker never sees, reasons about, or configures the chain. The decay is an implementation detail. **This answers the original "how do I set a fair %?" question: the platform doesn't — the lister does, and the market self-regulates** (a greedy rate deters forks; a generous rate attracts them). A maker who wants a strong originator claim can set 90%; one who wants virality can set 2%.

Rate is a free integer/decimal percent in `[0, 100]`. `100%` means a direct forker owes their entire post-platform sale (they'd fork only for derivative/portfolio reasons). `0%` means fork-and-sell freely.

### 3.3 Settlement on a paid sale of gross `G` cents

1. **Platform fee:** `platform = round(0.10 × G)`, taken off the top. Remainder `R = G − platform`.
2. **Royalty decay up the ancestor chain (each cut is a bill paid out of the child's slice):**
   - Let the ancestor chain from the seller be `p1` (direct parent), `p2` (grandparent), … `pn` (root).
   - The seller owes their direct parent: `pay_1 = round(rate(p1) × R)`. This comes out of `R`.
   - Each ancestor then owes *their* parent, out of the cut they just received:
     `pay_i = round(rate(pi) × pay_{i-1})` for `i ≥ 2`.
   - Each ancestor `pi` **keeps** `pay_i − pay_{i+1}` (their received cut minus what they pass up). The root keeps its full `pay_n`.
   - Stop when a `pay` rounds to 0 or the chain ends.
3. **Seller keeps** `R − pay_1`.

Each cut is a bilateral bill: you owe your direct parent a slice of your revenue; they independently owe their parent a slice of *that*. Cuts shrink fast up the chain (each hop taxes only the hop below it), so upstream self-limits. **No cap needed**, and the seller only ever loses their direct parent's single cut off the top.

### 3.4 Dropped concepts

- **Contributors** — removed. Co-authors settle their split off-platform out of the seller's own share.
- **Protocol liquidity pool** — removed. The 10% platform fee replaces it entirely.
- **70/20/10 and 90/10 fixed splits** — removed.

### 3.5 Worked example

Chain Ann → Bob → Carol. All three set rate = 10%. Carol sells for $100 (10000¢):

| Party | Computation | Keeps |
|-------|-------------|-------|
| Platform | round(0.10 × 10000) | **1000¢** ($10.00) |
| — | R = 10000 − 1000 = 9000 | |
| Carol (seller) | R − pay to Bob = 9000 − 900 | **8100¢** ($81.00) |
| Bob (parent) | received round(0.10 × 9000)=900, owes Ann round(0.10 × 900)=90, keeps 900−90 | **810¢** ($8.10) |
| Ann (grandparent, root) | received 90, owes no one | **90¢** ($0.90) |

Each cut is a bill out of the child's slice: Carol pays Bob $9 out of her $90; Bob pays Ann $0.90 out of his $9. Cuts shrink fast up the chain.

**Conservation:** 1000 + 8100 + 810 + 90 = 10000. ✓

## 4. Invariants (preserved from current engine)

- **Conservation of cents:** Σ all allocations == gross. Enforced by a fatal guard.
- **Deterministic:** same inputs → same allocation, always. No floating drift; integer-cents rounding with the remainder absorbed by the seller (the last `flow`).
- **Immutable allocation rows** recorded at purchase time; webhooks never move money directly, only enqueue outbox work.
- **Basis-points guard** from the old engine is replaced by the conservation-of-cents guard as the source of truth (BPS no longer sums to a fixed 10000 across fixed buckets, since the split is now dynamic).

## 5. Deliverables

1. **`src/lib/commerceDomain.ts`** — rewrite `calculateAllocations` (and remove contributor/pool branches). New allocation types reflect `platform` + ordered `ancestor` + `seller` allocations. Keep the conservation guard; drop the fixed-BPS guard.
2. **`src/lib/commerce/*` + `functions/api/*`** — update outbox/event/transfer processors to the new allocation shape (payout targets are now: platform, each ancestor, seller). Remove protocol-pool and contributor payout paths.
3. **Explainer doc** — new markdown in `src/data/` (e.g. `moneyModelData.ts`), manifesto-voiced under the title **"Shareware, Restored"**, added as a tab in `WhitePapersView`.
4. **SLOPSHOP** — add a visible "📜 How the money works →" link that opens the explainer; fix the 5 hardcoded 70/20/10 strings in `SlopshopView.tsx` (lines ~42, ~550, ~615, ~1123, ~1453) and the live-preview split math (~1453) to the new model.
5. **Tests** — rewrite commerce/royalty/lineage/acceptance suites for decay math + conservation. Delete contributor/pool tests. Add decay + rounding + deep-chain + single-hop + root-sale cases.
6. **Docs** — update `AGENTS.md` §1 (Lineage Ledger Economics) and `README.md` to describe the new model.
7. **Grok steelman prompt** — a self-contained prompt (model + goals + this model) for the user to paste into Grok.

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
