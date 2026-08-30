# Dogfood Plan: Hotwire = Product Hunt of real, forkable, deployed forge projects

**Date:** 2026-08-30 · **Goal:** every Hotwire listing is a real GITSMITH repo (real commit), onboarded exactly as a user would (real `git push` over the SSH gateway), forkable for real, and rendered at its standalone hostname from a real RIG build+serve. Our own demos must go through this flow — if they can't, the product doesn't work. Dogfood it.

## Decisions (from Nate)
- **Import path:** REAL PUSH, like a user would (no server-side import shortcut). Demos enter the forge via actual `git push` to a fresh GITSMITH repo over the real SSH gateway.
- **Un-bundle target:** DEPLOYED APP (real). Standalone hostname renders the app built+served from its forge repo via RIG. This requires COMMISSIONING the RIG build+serve pipeline (currently fail-closed/uncommissioned).
- **picfit/picfitai:** REMOVE completely from nates_software. Do NOT touch the original picfitai project or its GitHub repo (Nate's separate concern; its public-photo exposure is out of scope here).
- **mini's `gardening` dir:** forget entirely (wrong project; private Amazon-scraper data).

## Demo roster (final)
| Demo | Real source | State | Onboard |
|---|---|---|---|
| american-gardener | `~/Projects/americangardener` on the Air (Tailscale/SSH); "American Gardener's Calendar 1857", static Next.js, 1 commit, CLEAN | real repo, clean | push from the Air (or via tailnet) |
| dronehunter | `/Volumes/MacMiniExtra/Projects/dronehunter`, static HTML game, 16 commits, public GH remote, CLEAN. NOTE: the bundled `public/dronehunter-game/index.html` is NEWER/diverged — pick canonical | real repo | push tracked source |
| certified-mailer | `/Volumes/MacMiniExtra/Projects/certified-mailer`, python+node+static, 2 commits, no remote, `private/` legal PDFs UNTRACKED (0 tracked-sensitive), self-referential symlink | real repo, git-clean at HEAD | push TRACKED files only (never cp -r) |
| wallart | `/Volumes/MacMiniExtra/Projects/wallart`, node "wallart-studio", has `slop` remote to gitsmith but 0 commits (empty) — needs a first commit | needs first commit | commit + push |
| ~~picfit/picfitai~~ | REMOVED from site entirely | — | — |

## Current-state facts (from the 4-agent map, master 0e872bd)
- **`app_listings` has NO repository_id/repo column.** Listing↔repo link is only transitive via `active_deployment_id → deployment_revisions(repository_id, commit_oid)`, OR the reverse FK `repositories.app_id → app_listings.id`. Cards never surface canonical repo identity (GET /api/drops joins only app_listings→users).
- **Two competing repo models:** legacy `git_repositories`/`git_refs` (0001, seeded with app-id repo_ids) vs canonical `repositories`/`repository_refs`/`deployment_revisions` (0006). Fork uses the canonical one.
- **"Fork" is clipboard-only** — the UI copies `slop fork nate/<id>`; no server fork, no forks++ .
- **`slop fork` DOES call the real fork API** (action:'fork' on /api/git) but REQUIRES an active canonical `repositories` row + a `repository_refs` head for the parent. Fork from a listing with no repo → 404/409. It also needs a reachable git source to clone the worktree.
- **NO import path exists.** `create-repository` makes an EMPTY bare repo (`git init --bare`); objects/refs only arrive via a real `git push` over the SSH gateway (`gateway-record-ref`) or `cloneOrFetchForFork`. ← this is why "real push" is the right dogfood.
- **Deploy pipeline is fail-closed/uncommissioned.** No code path sets `deployment_state='active'` or inserts `deployment_revisions`. Standalone hostname renders content ONLY for the 3 hardcoded client-demo ids (dronehunter iframe, CertifiedMailerStudio, WallArtStudio bundled components) or a (never-set) verified-active. Everything else → honest "No deployable revision exists" error.
- **The SSH gateway IS deployed & live** (gitsmith-gateway on Railway, port 10609, real git receive-pack). So real push is actually possible.
- **RIG Docker gateway IS deployed & live** (rig-provider.nates-software.com) with real container execution — so a real build+serve is buildable on top of it.

## The gap, precisely
To make a Hotwire card a real forkable+deployed project, we need, per app:
1. a canonical `repositories` row (active) + a `repository_refs` head at a real commit  ← via **real push**
2. the `app_listings` row LINKED to that repo (so the card shows real repo identity, and Fork can resolve the parent)  ← **new linkage**
3. Fork button that actually forks (server call, forks++, lineage)  ← **wire Fork**
4. a real RIG build → artifact → smoke → promote → serve at the hostname  ← **commission deploy**
5. un-bundle the studios so the hostname serves the DEPLOYED app, not a component baked into the site

## Phased execution (dependency-ordered — do NOT parallelize across phases)

### Phase 0 — Remove picfit (independent, safe, do first)
Remove all picfit/picfitai references from nates_software ONLY: mockData.ts, ForkWithAiModal presets, CheckoutModal, GitsmithView, migrations that seed/retire it (0017/0022 already retire picfitai — verify it's gone from the live catalog), any bundled PicFit component. Do NOT touch `/Volumes/MacMiniExtra/Projects/picfitai` or its GitHub. Verify build+tests green.

### Phase 1 — Listing↔repo linkage + real Fork (data model + API + UI)
- Add a first-class link from `app_listings` to its canonical `repositories` row (either a `repository_id` column on the listing, or make GET /api/drops join repositories.app_id and surface repo slug + head commit). Prefer an explicit, migration-added `repository_id` FK for clarity.
- Make the "Fork" button call the real fork API (action:'fork') with the resolved parent repository, increment forks, record lineage; show honest error if the listing has no repo yet. Replace the clipboard-only affordance (keep "copy CLI command" as a secondary option).
- GET /api/drops surfaces real repo identity (slug, head commit, visibility) so cards show it.

### Phase 2 — Prove REAL PUSH onboarding for one app (dronehunter or wallart), end to end
- Using the REAL flow a user would: create-repository (empty bare) → real `git push` over the SSH gateway → gateway-record-ref projects the head → repositories row goes active → app_listings linked. NO server-side import shortcut.
- This must be a genuine `git push` from a working tree to `ssh://git@gitsmith-gateway…/nate/<app>.git`. Prove the whole chain works for ONE app first (de-risk before doing all).
- Register/patch the app_listings row to point at the new repo (source_ready).

### Phase 3 — Commission the RIG build→serve→promote pipeline (the big one)
- Real per-commit build on the rig-provider Docker gateway (build the pinned commit, produce a real artifact digest), real smoke/health check, promote → insert a REAL `deployment_revisions` row, set `deployment_state='active'` with `active_deployment_id`. Honor the invariant: active ⟺ real evidence.
- Hostname→serve: the standalone hostname must serve the deployed artifact (static export served from R2/gateway, or the running container). For static apps (american-gardener, dronehunter, wallart-studio if static) this is serving the built `out/` — simplest. Certified-mailer (python) may be a container.
- Fail closed honestly where a given app's runtime can't be served yet.

### Phase 4 — Un-bundle the studios
- Remove CertifiedMailerStudio.tsx / WallArtStudio.tsx (and the dronehunter bundled game) from nates_software. The standalone hostname renders the DEPLOYED app from Phase 3, not a bundled component. EphemeralLiveApp stops special-casing the 3 demo ids; it renders whatever the deployment lifecycle says (active → serve; else honest state).

### Phase 5 — Onboard all remaining demos through the proven flow
- Repeat Phase 2+3 for american-gardener (push from the Air), certified-mailer (tracked files only), wallart (commit first, then push). Each ends as a real, forkable, deployed Hotwire card.

## Hard safety rules (per the security findings)
- NEVER `cp -r` any demo source. Use `git archive`/tracked-files-only. certified-mailer has untracked `private/` legal PDFs + a self-referential symlink (infinite-loop on cp -r). gardening (mini) has live Amazon auth — forget it entirely.
- american-gardener: import the Air's real repo (clean); never the mini's gardening dir.
- picfit: removal only; do not touch the external project/GitHub.

## Dogfood acceptance (the whole point)
For each surviving demo: a real user could see it in Hotwire, click Fork and get a real fork with lineage, visit its hostname and see the DEPLOYED app — with everything backed by a real GITSMITH repo + commit + deployment revision. Nothing bundled, nothing mocked, honest states where a step isn't commissioned yet.
