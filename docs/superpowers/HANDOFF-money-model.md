# Handoff — "Shareware, Restored" money-model rewrite

**Status:** Feature-complete, reviewed, suite green. NOT merged, NOT deployed. Prod has test rows that block the destructive migration — read §4 before deploying.

**Branch:** `feat/shareware-restored-money-model` (git worktree `.claude/worktrees/money-model`), 25 commits on top of master (`a65f31d` base).

---

## 1. What this delivers

Replaces the old **70/20/10 + 90/10 lineage split** with:

- **Two license modes:** Personal (fork for self, no resale) / Resale r% (fork + resell, owe upstream).
- **One royalty rate** the maker sets when listing, **frozen onto the fork edge** at fork time (`repository_fork_liens`, immutable), runs with all descendants. `Σr ≤ 100%` gated at fork.
- **Settlement:** platform flat **10%** off the top, then **additive** ancestor liens off the remainder (roles `platform`/`ancestor`/`seller`), seller keeps the rest. **House-first floor rounding** (dust → platform). Conservation exact.
- **Payouts:** seller + ancestors paid via Stripe Connect; platform is the house (never paid out).
- **Refunds:** owner-only (`super_admin` / usr_nate) via `functions/api/payments/refund.ts`; **partials supported** with a proven-monotone clawback apportionment; house excluded from recovery obligations.
- **Prove-it gate:** a paid listing can't go on sale until its repo has a real built commit.
- **UI:** royalty input in the SlopshopView publish modal wired to a real `POST /api/drops`; all 70/20/10 copy retired; "Shareware, Restored" explainer added to White Papers; Grok-punched-up About page; contributor grants removed.

Full spec: `docs/superpowers/specs/2026-09-02-shareware-restored-money-model-design.md`
Plan + task ledger: `docs/superpowers/plans/2026-09-03-shareware-restored-money-model.md`, `.superpowers/sdd/progress.md`

## 2. Verification state

- `npm test` → **1320 passed / 0 failed / 2 skipped** (97 files).
- `npm run build` → clean (`tsc -b && vite build`).
- Every task passed an independent spec+quality review. The refund clawback math passed a **399,588-step adversarial chained-fuzz + mutation-testing** pass (two earlier attempts had a non-monotonicity bug that green tests missed — see §5).
- Whole-branch review (opus) found one Critical (maker earnings showed $0 — fixed, commit 7a77d32) and two Importants (grant CRUD removed d7d8876; the deploy caveat in §4), all resolved.

## 3. Key files changed

- `src/lib/commerceDomain.ts` — new `calculateAllocations` (additive liens, house-tip), `fetchFrozenLiens`.
- `src/lib/royaltyLiens.ts` — `buildInheritedLiens`, `assertForkAllowed`.
- `src/lib/commerce/recoveryDomain.ts` — monotone stable-order clawback apportionment.
- `src/lib/commerce/eventProcessor.ts` — payout filter (seller+ancestor; platform excluded).
- `functions/api/payments/create-intent.ts` — settle via liens.
- `functions/api/payments/refund.ts` — owner-only refund initiation (new).
- `functions/api/git.ts` — capture liens at fork-confirm + Σr≤100% gate at fork-request.
- `functions/api/drops.ts` — accept/persist `royalty_bps`.
- `migrations/0038_shareware_restored_money_model.sql` — **destructive**, see §4.
- UI: `SlopshopView.tsx`, `ProfileView.tsx`, `MarketingWindow.tsx`, `WhitePapersView.tsx`, `App.tsx`, `src/data/moneyModelData.ts`.

## 4. ⚠️ BLOCKER before deploy — prod is NOT empty

Migration `0038` does a **destructive `DROP TABLE`** (no backup) on:
`commerce_order_allocations`, `commerce_transfer_outbox`, `commerce_refund_allocations`, `commerce_recovery_obligations`.

The migration was written on a "zero users / zero rows" assumption. **That is now false.** Prod (`nates-software-prod-v2`) checked 2026-09-03:
- `commerce_order_allocations` = **8 rows**
- `commerce_transfer_outbox` = **2 rows**
- refund_alloc = 0, recovery = 0

Those 8+2 rows are **4 buy→own E2E TEST orders from Sept 1**: all `$15.00` (1500¢), all `recipient_user_id = usr_nate`, all **old-model** `maker`/`protocol_pool` roles (which the new schema doesn't even use). 2 are `fulfilled`, 2 stuck at `requires_payment`. **No real customer money.**

**Deploy was HALTED here.** Before `npm run release`, pick one:
1. **Clear the test rows** (they're superseded old-model self-tests), verify the 4 tables are empty, then deploy. Suggested cleanup (verify first!):
   ```sql
   -- inspect: SELECT * FROM commerce_orders WHERE created_at LIKE '2026-09-01%';
   -- then delete the 4 test orders + FK-dependent rows in the right order.
   ```
2. **Back up then clear** (export the 10 rows to a file first).
3. **Rewrite 0038 to be non-destructive** (real data migration) — overkill for test data, its own review.

Re-run the row-count check right before deploying (more test rows may have accrued):
```
npx wrangler d1 execute nates-software-prod-v2 --remote --json --command \
"SELECT (SELECT COUNT(*) FROM commerce_order_allocations) alloc, (SELECT COUNT(*) FROM commerce_transfer_outbox) outbox, (SELECT COUNT(*) FROM commerce_refund_allocations) refund_alloc, (SELECT COUNT(*) FROM commerce_recovery_obligations) recovery;"
```

## 5. Gotcha worth knowing (refund math)

Partial-refund clawback rounding must be **monotone across chained sequential refunds** or the pipeline throws "refund state regressed" and wedges. D'Hondt/divisor apportionment is NOT monotone in seat count. The fix (`recoveryDomain.ts::cumulativeTargets`) is a **stable-order per-cent assignment** (each cent → cheapest next unit by largest-remainder key, house-favoured ties) — monotone by construction. Strict "house absorbs every dust cent" was intentionally relaxed (provably incompatible with monotonicity). Don't "simplify" this back to a divisor method without re-running the chained fuzz.

## 6. Merge notes

- `npm run release` is the only prod path (clean commit, tests, build, isolated preview migrate, smoke, prod migrate, promote, smoke).
- Mislabeled commit `c43269b` says "refund endpoint" but contains the D2 publish-gate (a concurrent-commit race). Content is correct; message is cosmetic. Not reworded (462 commits stacked, unsafe rebase).
- CLAUDE.md is a symlink to AGENTS.md — both updated to the new model.
