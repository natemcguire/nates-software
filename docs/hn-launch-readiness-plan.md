# HN Launch Readiness Plan (from production-readiness rescan, 2026-09-02)

> 25 adversarially-verified findings across 7 launch-blocking dimensions (38 agents). Verdict: close to launchable; the gap is honesty-debt in seed data + first-run funnel, not architecture.

Both confirmed exactly as described. The findings are accurate. Here is the launch plan.

---

# Nate's Software — HN Launch Readiness Plan

**Bottom line up front:** You are close. The money/auth/lineage engine is sound (multiple prior audits held). What stands between you and a confident HN launch is almost entirely **honesty of seeded data** and **first-run funnel quality** — not architecture. The critical path is a few hours of work: one cleanup migration, one copy fix, one filter, and three deletions.

---

## 1. SHIP-BLOCKERS (must fix before going live)

Ranked. A source-reading HN skeptic catches every one of these in the first five minutes.

| # | Blocker | One-line fix | File:line |
|---|---------|--------------|-----------|
| 1 | **Fabricated 420-upvote / 88-fork "LIVE" engagement** on DroneHunter + Certified Mailer, seeded in prod D1, sorts to top of HOTWIRE | Cleanup migration: `UPDATE app_listings SET upvotes=0, forks=0` for `dronehunter`,`certified-mailer` (match the honest 0/0 seeding of wallart/american-gardener) | `migrations/0001_production_schema.sql:213-214` |
| 2 | **False USPS capability claim** — live listing says Certified Mailer "generates official 20-digit USPS Certified Mail barcodes / ERR tracking"; the app is a browser-local journal. Reads as fraud on a paid $15 legal tool | Same migration: `UPDATE` tagline/description to the honest copy already written in `mockData.ts:152-153` (mirror the picfit fix in migration `0017`) | `migrations/0001_production_schema.sql:214` |
| 3 | **Fabricated testimonials + "Sam Altman" impersonation** — seeded comments with invented upvotes (24/19/15), and `usr_sam` = "Sam Altman" with `is_verified_maker=1`, rendered with a verified badge | Same migration: `DELETE FROM comments WHERE id IN ('c101','c102','c103')`; rename or drop `usr_sam` (currently only referenced by c103) | `migrations/0001_production_schema.sql:207, 225-229` |
| 4 | **Checkout falsely claims "Payment Confirmed / Your payment was received"** on a client-side poll timeout — including genuinely failed async payments. Screenshot-worthy money-path lie | Rewrite the `status==='timeout'` copy to an honest "not yet confirmed — if charged, license appears on your Shelf; otherwise no charge" state; swap the green ShieldCheck for a neutral icon. Do NOT assert success on poll exhaustion | `src/components/CheckoutModal.tsx:678-689` |

Blockers 1–3 are **one migration** (`0023_launch_honesty_cleanup.sql`). Blocker 4 is one component edit. Confirmed both #1 and #4 against live source — text matches exactly.

Also fold into the same cleanup migration (cheap, same class of dishonesty): set `merge_cleanliness='Not yet benchmarked'` and null/genericize `moddability_score` for dronehunter/certified-mailer (currently invented "99.9% clean" / 98) — finding #7. It ships in the public `/api/drops` JSON and RSS feed next to honest "Not yet benchmarked" rows, so the inconsistency itself tips off the skeptic.

---

## 2. DELETE LIST (less-is-more — cut these, don't fix them)

| Cut | Why it helps the launch |
|-----|------------------------|
| **hello-* / live-build E2E fixtures from the public catalog** (`listing_status='retired'` or exclude by tag) | These 5 internal CI/deploy-gate apps dominate the SETUP.EXE Step-1 "Pick an app" list and the HOTWIRE board — the marketplace reads as a Potemkin CI dashboard. This is the FIRST auto-opened "START HERE" screen. Retire them from the catalog and both surfaces instantly look like a real shareware store. (finding #1) |
| **EDITORIAL (Nate's Lab) tab + route** — unwire StartMenu entry, desktop icon, and `/editorial`/`/lab`/`/reviews` route branches | An entire promoted top-level surface containing only 3 articles all stamped "Illustrative Sample" / "SAMPLE ISSUE". Reads as half-built. Keep the files behind a flag; just don't ship it in launch nav. (finding #18) `StartMenu.tsx:97`, `App.tsx:51,505` |
| **`src/lib/featureMarketplace.ts` + its test** (120 lines) | Dead parallel money/dispute engine imported only by its own test. A source-reader auditing "the money code" may audit the wrong file — it's a decoy. Real engine is `commerce/*`. (finding #17) |
| **`src/lib/droneHunterDomain.ts` + its test** (462 + 326 lines) | Dead parallel game engine; the real game is static HTML in `public/dronehunter-game/`. Imported only by its own test. (finding #19) |
| **`INITIAL_APPS` fabricated payloads in `mockData.ts`** + the "View verified voters" tooltip wording (`HotwireView.tsx:665`) | Hardcoded "420 upvotes", fake voter list incl. "Sam (AI)", fabricated comments sitting in the shipped bundle. Currently inert (not on live board) but a source-reader can't tell it's dead. The word "verified" over invented names is the smell. (finding #8) |
| **MarketingWindow "Coming soon:" footer** (lines 105-107) | It calls the contributor-share feature "coming soon" — but that feature is **fully shipped, money-moving, and publicly listed** in the marketplace opportunities tab. Marketing contradicting shipped code reads as vaporware on the exact mechanic you're selling. Delete the line. (finding #16) |

Deletions 3–4 remove ~900 lines of dead code and two audit decoys. Deletions 1–2, 5–6 remove embarrassment surface.

---

## 3. PRODUCT / GROWTH FIXES (highest-leverage, makes it land on HN)

These aren't blockers but they're where the funnel leaks and where HN judges you.

1. **Fix the "Run in browser now" magic moment** (finding #2 — latent, high-leverage). The wizard's headline CTA renders an iframe on `isVerifiedActive` alone with no served-artifact check. The moment any container/Worker app (e.g. hello-python, which is live at its own host) is promoted to active, its iframe points at `/serve/<id>/index.html` → 404 blank iframe with no fallback. **Fix:** in `drops.ts` select `origin_ref`/workerUrl and surface it as the live URL so active apps use their real host; gate the bare `/serve/<id>` iframe on a known static artifact and fall through to the honest deployment surface on non-200. `EphemeralLiveApp.tsx:108`. Pair with retiring hello-* (delete #1) so the wizard only offers apps that actually render (dronehunter, american-gardener).

2. **Add OG/Twitter meta tags to `index.html`** (finding #20). Launch day, someone posts `nates-software.pages.dev` to HN/Twitter/Slack and it unfurls as a **bare URL** — while the bundled demo game inside it has a proper 1200x630 card. The flagship looks less finished than its own toy. Add `description` + `og:*` + `twitter:card`, point `og:image` at a real 1200x630 desktop screenshot. ~15 min.

3. **Mobile gate** (finding #22). ~half of HN traffic is mobile; the `fixed inset-0 overflow-hidden` desktop is unscrollable, control clusters collide, 3-pane GITSMITH windows (minWidth 220+160) overflow the ~335px frame with no scroll escape. Reads as flatly broken, not deliberately retro. **Cheapest honest fix:** a Win95 dialog below ~768px saying "designed for a larger screen" with a link to the explainer. Not a responsive rework. `App.tsx:410`.

4. **Logged-out wizard CTA honesty** (finding #3 — low). The marquee "1-Click Browser Fork" button silently requires an account (it does show an inline note one layer deep, so not dishonest). Relabel to "Create account to fork" when logged out, and lead logged-out users with the no-signup Step-2 sandbox. Conversion polish. `SetupWizardView.tsx:305`.

---

## 4. NICE-TO-HAVE (real, defer past launch)

- **Rate-limiting on `/api/auth`** (finding #10, high but mitigated). No throttle/lockout/CAPTCHA on login/register/claim; username-enumeration oracle (401 vs 403 vs 400). Mitigated by: seeded `nate` can't be logged into until claimed, PBKDF2-100k slows guessing, no money/auth bypass exposed. **Minimum viable = a Cloudflare WAF rate-limit rule on `/api/auth` + collapse the 403/404 branches into a uniform 401.** The WAF rule needs no code deploy — do it launch-day if time allows, otherwise fast-follow. Real KV/D1 counter is post-launch.
- **Refund-after-dispute over-clawback** (finding #9, high but fails closed at Stripe). Refund processor's `prior` map omits prior dispute clawbacks, so refund-after-partial-dispute opens excess reversal obligations. **Stripe rejects reversals exceeding the original transfer, so no one is over-debited** — harm is stuck `terminal_failure` rows + inconsistent ledger needing manual reconciliation. Mirror `disputeProcessor` (sum `commerce_recovery_obligations WHERE source_kind='dispute'` into the prior map + guard). Fix soon, but it can't lose real money and requires a specific refund-after-dispute sequence to trigger.
- **Raw exception `.message` leaked** to unauth callers (finding #15, low): `auth.ts:117/428`, `dyno.ts:214/940`, `git.ts:424`. `console.error` + return generic "Internal server error". Quick hygiene.
- **`dyno-verifier` admin bypass checks `'admin'` but role is `'super_admin'`** (finding #13, low, fails closed) — dead branch at `dyno-verifier.ts:93,240,270` + `dyno.ts:93`. One-word fix.
- **`<noscript>` fallback** (finding #21, low) — boot screen animates "INITIALIZING DESKTOP" forever with JS blocked. Add a `<noscript>` block; NoScript crowd will screenshot it.
- **PWA manifest never linked + "Local-First Local-First" typo** (finding #23, low). Per less-is-more: **delete** the unused SW precache lines + manifest + icons rather than wiring up A2HS on a desktop-only app. But fix the visible duplicated-word slop in the manifest description regardless (one word).
- **upvote GET full-table-scan + per-row rehash** (finding #11, low) — negligible at pre-launch vote volume; the whole no-appId branch is a delete-candidate (frontend can pass the app_id set).

**Explicitly NOT bugs (drop from the list):** constant-time login compare (#12 — hash-vs-hash, zero exploitability), no favicon.ico (#24 — data-URI emoji favicon works everywhere, it's an "add that" not a fix). Both are not-a-bug for launch.

---

## 5. VERDICT

**Genuinely close to launchable — yes.** The hard part (money conservation, CAS merge, lineage 70/20/10, session/CSRF, dispute/refund direction that IS covered) is done and has survived multiple audit rounds. What's left is not engineering risk; it's **honesty debt in seed data and a rough first-run funnel** — exactly the surface a skeptical, source-reading HN audience attacks first. None of the four ship-blockers is architectural; three of them collapse into a single cleanup migration.

**Critical path (ordered):**

1. **Write `0023_launch_honesty_cleanup.sql`** — zero upvotes/forks + honest Certified Mailer copy + delete c101/c102/c103 + drop/rename `usr_sam` + "Not yet benchmarked" for the fabricated scores. *(Blockers 1,2,3 + finding 7. One file.)*
2. **Fix CheckoutModal timeout copy** — no false "Payment Confirmed" on poll exhaustion. *(Blocker 4.)*
3. **Retire hello-*/live-build from the catalog** — so the wizard + board look like a real marketplace. *(Delete #1, unblocks the funnel.)*
4. **Fix the "Run in browser now" iframe** to use real host / fall through on non-200. *(Growth #1 — the magic moment.)*
5. **Delete the 4 dead/embarrassing items** — EDITORIAL nav, featureMarketplace.ts, droneHunterDomain.ts, INITIAL_APPS payloads + Marketing "coming soon" line. *(Removes decoys + ~900 dead lines.)*
6. **OG tags + mobile gate + `<noscript>`** — the three "unfurls/renders broken" embarrassments. *(Growth #2,#3 + NTH.)*
7. **Launch-day WAF rate-limit rule on `/api/auth`** (no deploy needed) if time permits; otherwise fast-follow.

Steps 1–5 are the real gate and are a few hours of work. Do those and run `npm run release` (the tested-promotion pipeline) and you can put it in front of Hacker News with confidence. The refund-after-dispute and rate-limit items are honest fast-follows — both fail closed and neither loses real money or grants access.
