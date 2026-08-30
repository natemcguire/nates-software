# Nate's Software — Combined Audit & Path to Production

**Date:** 2026-08-30 · **HEAD:** `0f6f127` · **Reviewers:** Codex (max-effort, read-only) + Claude (5-agent parallel rescan, live-probed)

This file merges two independent audits. Where we agree, the finding is high-confidence. Where I verified a specific Codex claim against the live tree, I mark it **[confirmed]**, **[adjusted]**, or **[stale]** with evidence.

---

## 1. Shared verdict

The foundations are strong and much of the system is genuinely real — but **the maker-to-merge journey is not one enforceable workflow yet**. The real subsystems (SSH forge, RIG Docker verification, INBOX CAS approval, commerce ledger) exist and mostly work in isolation; they are not yet connected into a single pipeline where policy is *enforced* rather than *projected after the fact*, and where a reviewer sees *evidence* rather than a *digest*. Both audits converge on this.

Both audits also agree on what's genuinely strong (see §5).

---

## 2. Blockers — merged & verified

Ordered by severity. Each carries the origin (Codex / Claude / both) and my live-tree verification.

### B1. SSH pushes bypass the workflow — post-receive projection, no pre-receive enforcement
**Origin: Codex · [confirmed]**
`src/lib/gitsmith/sshTransport.ts:73` writes only a **post-receive** hook; `:129` attaches it on write. Objects + ref are already committed before any policy runs. Grep for protected-ref / force-push / delete guards in the transport returns **nothing**. A writer with push access can rewrite or delete a protected ref, and D1 projection only *notices* afterward (that's what `forge_reconciliation_issues`, `git.ts:676-684`, exists to catch — detection, not prevention).
**Fix:** pre-receive hook that rejects the push *before* objects land — enforce protected refs, non-fast-forward policy, delete protection, and ancestry, calling the gateway policy check synchronously and failing the push on violation.

### B2. Cloudflare tunnel token exposed in process argv
**Origin: Codex · [confirmed]**
Live check: `cloudflared tunnel … run --token <JWT>` is visible in `ps` right now (PID 69604). Any local process can read it. **Codex's correction is also confirmed:** the RIG *service* secret is NOT in argv — it loads from Keychain at `ops/macos/run-rig-gateway.sh:21` (`security find-generic-password … com.nates-software.rig.gateway`). So this is specifically the **tunnel** credential.
**Fix:** rotate the tunnel token now (it may be in shell history / process listings / any prior `ps` capture), and move it to `cloudflared`'s credentials file or a Keychain-sourced env var, out of argv.

### B3. RIG evidence is not trustworthy enough to gate merges
**Origin: Codex (+ Claude flagged the requester-chosen-command angle yesterday) · [confirmed direction]**
Requesters choose their own build/test commands; verification permits network access; ancestry isn't enforced; the reviewer gets only a `resultDigest`, not logs/diffs/reports/artifacts. A verification you can't inspect and whose commands the submitter chose is attestation theater even when the container is real.
**Fix:** server-owned, offline (network-denied) verification policy keyed to the repo; capture and persist logs + diff + test report + artifacts to R2; surface them (not just a digest) to the reviewer; enforce that the verified OID is a descendant of the target.

### B4. INBOX lacks a real review package
**Origin: both · [confirmed]**
CAS approval is genuinely exact-OID-bound (`inbox.ts:82` shows `landed` only when `landedCommitOid === resultCommitOid` — correct and honest). But the reviewer can't see the diff, test logs, artifacts, ancestry, or which verification policy ran. Approval is a blind rubber-stamp of a hash. (Depends on B3 producing the evidence.)
**Fix:** render the B3 evidence bundle in the INBOX reading pane; show ancestry and the policy identity; block approval unless a passing, policy-compliant verification exists.

### B5. First-run repo onboarding is broken
**Origin: Codex · [confirmed plausible]**
UI advertises `slop fork` for a freshly created empty repo, but the CLI expects a recognized project manifest and fails on an empty clone. (`slop fork` still carries hardcoded fallbacks — github clone for `picfitai`, bundled starter for `dronehunter` — `bin/slop.ts` ~336-354; a bare empty repo hits no template.)
**Fix:** make `slop fork` succeed on an empty canonical repo (scaffold or clone-empty path), and stop advertising a flow the CLI can't complete.

### B6. Canonical forks & SLOPSHOP are disconnected from ancestry
**Origin: both · [confirmed]**
Immutable fork ancestry exists in the backend, but `slop fork`, HOTWIRE, and hosted SLOPSHOP don't consistently use it. `slop fork` does a filesystem clone and **never records forge fork lineage** (confirmed yesterday). So the lineage ledger that powers 70/20/10 can be bypassed by the actual fork entrypoint.
**Fix:** route `slop fork` and SLOPSHOP through the canonical fork API so every fork registers immutable ancestry; bind versioned feature refs (`refs/features/*`) into the flow.

### B7. Temp-directory leak — root cause live, volume already drained
**Origin: Codex · [adjusted — see note]**
Codex saw **1,371 `/tmp/slop-*` dirs = 23.27 GiB**. That was real when it ran. **Live now: 2 dirs, 40K** — I cleaned this earlier today (it was the same Codex/agent temp churn that filled the internal SSD). But the **root cause is unfixed and it will refill:** `bin/slop.ts:794` falls back to `/tmp`/homedir and does **not** honor your external `TMPDIR` (`/Volumes/Developer/DevCaches/tmp`), and successful runs don't clean up.
**Fix:** honor `process.env.TMPDIR`; clean worktrees on success; add a reaper for stale `slop-*`. (Note: this ties into the broader "move dev caches to MacMiniExtra" work we started — `slop` is one more tool ignoring the redirect. Same root cause as the Codex `ns-*` dirs that filled the SSD.)

### B8. Recovery risk — 120 commits unpushed
**Origin: Codex · [confirmed exactly]**
`origin/master..master` = **120** (198 total local). A day's worth of the real work exists only on this disk. One drive failure loses it.
**Fix:** push to origin (after deciding what's shareable). See §6 caveat — coordinate with the active Codex/agent sessions before force-anything.

---

## 3. Claude additions (not in Codex's list)

These came out of my rescan and complement Codex's workflow-security focus:

### C1. No ErrorBoundary — one view crash white-screens the whole OS
**[confirmed]** Grep for `componentDidCatch`/`ErrorBoundary` = zero. AuthProvider is now correctly mounted (yesterday's desktop-crash bug is fixed), but any thrown error in any view still takes down the entire desktop. Cheap, high-value insurance.

### C2. The money loop doesn't close
Commerce is real (Stripe PaymentIntents/Connect/Transfers, durable outbox, 70/20/10 settlement on verified webhook) but: (a) **disabled by default** (`PAYMENTS_ENABLED`/`PAYOUTS_ENABLED`/`STRIPE_*` unset → 503); (b) **no payout cron** — `process-transfers` drains the outbox only on manual authenticated POST (no `[triggers]` in `wrangler.toml`); (c) **refund/dispute clawback unimplemented** — `commerce_reversal_outbox`/`_attempts` tables exist but nothing executes reversals; disputes route to `terminal_failure` (`eventProcessor.ts:127-143`). Refunds record a recovery obligation but the money never moves back.

### C3. "Merge" is a CAS ref-repoint, not a real merge
**[confirmed]** `pipeline.ts:90` stores the source ref's existing tip as `result_commit_oid` — no `git merge-tree`/`commit-tree`, no merge commit, no divergence handling. A non-fast-forward would overwrite the target to the source tip. Real ref motion, but "land approved merges" oversells a verified ref-advance. (This intersects B1/B3: without pre-receive + ancestry enforcement, the "merge" can repoint a protected ref to an arbitrary descendant.)

### C4. No CI
**[confirmed]** No `.github/workflows`. Deploy + migration-apply is a single local `scripts/release.mjs` (preview→smoke→prod). Good script, but nothing runs the 1,019 tests on push, so B1–B8 regressions can't be caught automatically.

### C5. Frontend residue (minor, mostly labeled)
`wasmSqlite.ts` still dead / SQLite inspector fakes rows (now badged "Simulated Query Engine"); dead unreachable "License minted 70/20/10" success string (`ArtifactSandbox.tsx:655-661`); silent comment-POST failures with no rollback (`ArtifactSandbox.tsx:109-120`); Editorial reviews + claps fully mock ("DEMO REVIEWS"). Editorial is the last fully-mock vision pillar (NSW-12).

---

## 4. Corrections to the reviewers (for accuracy)

- **RIG service secret is NOT committed/exposed** (Codex already noted this) — Keychain-loaded, `run-rig-gateway.sh:21`. **[confirmed]** The argv exposure is the **tunnel** token only (B2).
- **Temp leak volume is stale** — 23.27 GiB was real at Codex's runtime but already drained; the *mechanism* is what matters and remains unfixed (B7). **[adjusted]**
- Everything else in Codex's blocker list verified as stated.

---

## 5. What is genuinely strong (both audits agree)

- Canonical repository/ref/fork/merge/build/deployment schema
- Immutable fork ancestry (backend)
- Correct 90/10 root and 70/20/10 downstream economics (cent-conserving)
- Durable outbox workflows (commerce + forge)
- Bare Git storage + real CAS ref updates (`git update-ref`), **deployed & live** (probed: `gitsmith-gateway-production.up.railway.app:10609` speaks `SSH-2.0-GITSMITH`)
- Real local AST splicing + rollback
- Real Docker provider, **deployed & live** (probed: `rig-provider.nates-software.com` `/healthz` 200)
- Exact-OID INBOX approval (CAS-bound, honest queued-vs-landed)
- Correct standalone DYNO model (real sandbox execution + server-side trace/score recomputation, no `Math.random()`)
- Strong candidate → smoke → destruction release flow (`scripts/release.mjs`)
- 1,019 tests passing, 2 skipped — against a real sql.js-emulated D1 applying the migration chain with FK enforcement

---

## 6. The milestone (Codex's, endorsed)

> Two real makers create SSH identities; one provisions a root repository; the other creates a canonical immutable fork and versioned feature ref; RIG applies a server-owned offline verification policy with inspectable evidence; INBOX displays that evidence; approval lands the exact verified descendant through CAS.

This is the right forcing function — it exercises every blocker at once and proves the workflow is one connected, enforceable pipeline.

## 7. Implementation order (merged)

Codex's 9-step order is sound. I've folded my additions in at the points where they belong:

0. **[Claude] Push the 120 commits** (B8) — do this first; it's pure recovery risk and coordination-gated (see caveat). Decide shareable scope, then push.
1. **Rotate & relocate the tunnel credential** (B2).
2. **Stop the temp leak & honor `TMPDIR`** (B7) — plus a stale-dir reaper. Ties into the DevCaches relocation work.
3. **Enforce protected refs with pre-receive hooks** (B1).
4. **Complete the SSH key / fingerprint / revocation model** (part of B1's auth surface).
5. **Fix empty-repo bootstrap & canonical `slop fork`** (B5 + B6).
6. **Connect SLOPSHOP to versioned feature refs & RIG** (B6).
7. **Produce trustworthy, inspectable verification evidence** (B3) — offline policy, persisted logs/diffs/artifacts.
8. **Render evidence in INBOX & enforce ancestry** (B4) — and make "merge" a real merge or rename it (C3).
9. **Run the real two-user SSH acceptance test** (§6 milestone).

Cross-cutting, do alongside:
- **[Claude] Add an ErrorBoundary** (C1) — small, independent, do anytime.
- **[Claude] Add CI** (C4) — a GitHub Action running `npm test` + build on push, so steps 1-9 don't regress.
- **[Claude] Close the money loop** (C2) — enable flags in a controlled env, add a payout cron, implement reversal execution. Independent of the forge track; schedule when commerce is the focus.

---

## Caveat on git operations
This repo is under active concurrent development by Codex/agent sessions (that's the source of the 120 unpushed commits and the temp churn). **Coordinate before any push/rebase/force** — a naive push could collide with in-flight agent work. Confirm no agent is mid-commit, then push.
