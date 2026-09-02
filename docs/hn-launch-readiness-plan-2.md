# HN Launch Readiness — Rescan #2 (2026-09-02)

> 21 verified findings → 7 real defects, all in the lineage/share code from the last 9 commits. Audited money/auth/70-20-10 core is clean.

Confirmed. The code matches the findings exactly: the earnings query (line 178-186) has no join to `commerce_orders` and no status filter, and `resolveRepositoryIdForApp` (line 60-64) only queries `repositories WHERE app_id = ?` (the unpopulated reverse link). Both root causes verified. I have enough to synthesize.

---

# Launch Plan — Nate's Software / HN Readiness (2nd rescan)

The 21 findings collapse to **7 real defects**. Twelve of them are the same two bugs seen from different angles. Good news: no money-movement, auth, CSRF, or 70/20/10 hole survived — every ship-blocker is in the **new lineage/share feature** (last 9 commits) and is either a broken funnel or a display-truth bug. Nothing in the actual payout path is wrong.

## 1. SHIP-BLOCKERS (ranked)

**All four block launch. #1 and #2 are one-line/one-clause fixes in the same file. Fix them and re-verify against prod, then you're clear.**

1. **Lineage tree app-id URLs 404 for all 4 real apps.** `resolveRepositoryIdForApp` reads `repositories.app_id` (NULL in prod); only the forward link `app_listings.repository_id` is populated. Every human-shareable `/tree/dronehunter` and `/api/lineage?appId=dronehunter` returns 404 — the whole viral feature is dead. → *In `lineageDomain.ts:60`, fall back to `SELECT repository_id FROM app_listings WHERE id = ?` when `app_id` lookup is null (or backfill `repositories.app_id`).* (Findings 11 + 14 — dupes.)

2. **Public "earned" dollars count unpaid/failed/refunded orders AND fold in whole-platform earnings.** `lineageDomain.ts:180` sums `commerce_order_allocations` with no join to `commerce_orders` and no `status='fulfilled'` filter, and no scoping to this lineage's repos. Result: a skeptic who starts a checkout and never pays inflates the public share card; two unrelated apps by the same maker both show his identical `$54 earned across the lineage`. The private profile (`profile.ts:117`) shows the correct lower number — the public brag card contradicts the owner's own ledger. → *`JOIN commerce_orders o ON o.id = a.order_id`, add `WHERE o.status='fulfilled'`, and add `AND a.source_repository_id IN (<tree node repo ids>)`. There is NO `livemode` column on `commerce_orders` — do not add that clause.* (Findings 1, 4, 6, 7, 15 — all the same bug.)

3. **Wizard's default first-run app iframes the marketplace inside itself.** `american-gardener` is `deployment_state='active'` in prod but its hostname serves the SPA fallthrough (`<title>Nate's Software…</title>`, zero gardener content). The marquee "Run it in the browser now" button renders the whole site recursively. → *Flip `american-gardener` (and re-verify `dronehunter`) off `'active'` until the hostname truly serves the app; add a content (not just HTTP-200) assertion to the release smoke.* (Finding 8.)

4. **HOTWIRE front page opens empty.** Default batch is `'today'` (`CatalogContext.tsx:48` + `HotwireView.tsx:50`); all catalog rows have frozen migration-time `created_at`, so `batch=today` returns 0 rows every day after seed → "📦 No Live Drops in Today's Batch." The flagship board looks abandoned. → *Default the landing to `'all'`/cumulative; only scope to `today` when today is non-empty.* (Finding 9.)

## 2. DELETE LIST (less-is-more — do all four, zero risk)

- `sites/lineage-preview/` — 680-line fabricated-earnings design mock, superseded by the now-real `/tree` feature, served by nothing. `git rm -r`. (Finding 19)
- `sites/slopshop-preview/` — 551-line never-adopted redesign comp, wired to nothing. `git rm -r`. (Finding 20)
- `INITIAL_FLEET` export in `src/lib/rigDomain.ts:187-225` — dead fabricated fleet fixture (fake `sam/retro-calc`, byte-exact sqlite sizes), zero importers. Delete. (Finding 21)
- Unsplash stock URL in `src/App.tsx:179` — set `screenshots: []`. Fabricated-screenshot artifact the honesty migration purged everywhere else; latent but one refactor from rendering. (Finding 5)

## 3. PRODUCT/GROWTH fixes (highest-leverage, cheap, do before or same-day as launch)

- **`/vision.md` downloads instead of rendering** (`text/markdown` + global `nosniff`) — the single most-clicked "what is this" link on a source-reader launch is a dead funnel. → Add a `public/_headers` rule forcing `Content-Type: text/plain; charset=utf-8` for `/vision.md` (min), or serve a rendered HTML page (better). **High leverage.** (Findings 13 + 16 — dupes.)
- **Lineage-tree entry point is invisible.** The only UI link to `/tree` is gated behind `forkCount>0` (`HotwireView.tsx:617`) and every prod app has 0 forks — the flagship new feature is 100% undiscoverable. → Surface the tree link on the app detail pane regardless of fork count. (Finding 10.)
- **The one tree that renders shows a raw repo UUID + synthetic `forker864e44` handle** as the product name (`rootAppId` null → falls back to `repo_251f…`). It's a retired `hello-forge` CI fixture. → `SELECT slug` in `fetchLineageTree`, fall back `appId → slug → repo id`; suppress share cards that resolve to a bare UUID; exclude synthetic `forker*` users from public surfaces. (Finding 12.)

## 4. NICE-TO-HAVE (defer past launch)

- SVG share-card error path returns `text/html` under an image request → emit a minimal valid SVG on error (broken-image cosmetic only). (Finding 3)
- 500 handlers leak stack traces (`deploy.ts:2751`) / raw `err.message` (`drops.ts:250` public, `auth.ts:117/428`) → return generic message, `console.error` server-side (pattern already in `lineage.ts`). Info-disclosure polish. (Finding 18)
- TL;DR button shows "Prompt copied!" even on clipboard failure → only `done()` inside `.then()`. Edge-case (prod is HTTPS top-level where it works). (Finding 17)
- Bare 0/0 upvotes/forks across catalog — honestly zero on a day-1 board; add "Day 1 — be the first" copy if you want, not required. (Finding 2/10 half)

## 5. VERDICT

**Not launchable as-is** — but the gap is small and concentrated. Every blocker is in the new lineage/share code shipped in the last 9 commits; the audited money/auth/CSRF/70-20-10 core is clean. This is a regression-cleanup, not a rebuild.

**Ordered critical path to launch (est. a few hours):**

1. **`lineageDomain.ts` — two changes in one file:** (a) app-id resolution fallback via `app_listings.repository_id` [blocker #1]; (b) earnings query `JOIN commerce_orders … WHERE status='fulfilled' AND source_repository_id IN (tree repos)` [blocker #2]. Add the CI regression test that seeds a `creating`/`payment_failed`/refunded order and asserts it's excluded (Finding 7 gap).
2. **Flip `american-gardener` off `deployment_state='active'`** in prod D1 [blocker #3]; verify no other `'active'` app iframes the SPA.
3. **Default HOTWIRE to `'all'`** [blocker #4].
4. **Deletes** (section 2) + **`/vision.md` header fix** + **un-gate the tree link** (section 3) — all cheap, ship together.
5. **Re-verify against prod:** `/tree/dronehunter` → 200 with real app name; `/api/lineage?appId=wallart` → 200; start-and-abandon a checkout, confirm `/tree` earned figure does NOT move; HOTWIRE loads populated; wizard "Run it" loads a real app or the honest deploy card.

Do steps 1–3 and re-verify, and you can launch confidently. Steps 4–5 are same-day and low-risk. Defer everything in section 4.

**One caveat I can't close from here:** blockers #1/#3/#4 depend on live prod D1 state (NULL `app_id`, `american-gardener`='active', frozen `created_at`) that was confirmed against prod on 2026-09-02 but is mutable — re-run the section-5 prod checks immediately before you post to HN, since a redeploy or data change could shift them.
