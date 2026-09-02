# Feedback batch — 2026-09-02 (Nate, ~17 screenshots)

Captured so context isn't lost. Ordered roughly quick-fix → deep-rework.

## Bugs / quick fixes
1. **Setup wizard "Loading forkable starters..." fails** → "Failed to load starters from catalog / Failed to retrieve drops" (500s on /api/drops, /api/auth, /api/shelf in console). RETRY worked. So it's a transient/race — likely the wizard fetches before session/catalog ready, or a 500 under some condition. Console shows: content.js useCache TypeError, share-modal.js addEventListener null (browser-extension noise, ignore), but ALSO real: `Failed to load resource: 500` on auth:1, drops:1, shelf:1. Investigate the real 500s.
2. **Login (bottom-left / Start menu) does nothing** — clicking Log In in the taskbar bottom-left doesn't open the auth modal. (Start-menu login we added — but the bottom-left taskbar one may be separate/broken.)
3. **Wizard "Continue →" button should be PINNED** (sticky footer, always visible — currently scrolls with content).
4. **Publishing Identity "Copy" copies a random token** — `25ccd92acf905ad3d8...` — a CLI token. Is this intended? Screenshot shows "CLI token copied to clipboard". Nate flags it as unclear/random. Clarify or remove — probably should copy a real, labeled SLOP CLI auth token, or remove if not meaningful.
5. **GITSMITH: code doesn't load / no preview** — clicking spec.md → "File Read Unavailable / File not found (HTTP 404)". Files don't load or preview. The forge file viewer is broken for these repos.
6. **GITSMITH: remove "STANDALONE ROUTE" indicator** (the badge next to GITSMITH FORGE header).
7. **Login must PERSIST across subdomains** — logging in on gitsmith.nates-software.com should share session with nates-software.com. Currently host-only cookie (deliberate for security). NEED CAREFUL approach: cross-subdomain SSO without reintroducing the account-takeover vector (tenant apps are untrusted!). Only first-party subdomains (gitsmith, hotwire, etc.) should share; tenant app hosts (<app>.nates-software.com) must NOT. This is the hard-rail tension — solve it right.
8. **PROFILE.CFG → rename to ACCOUNT.CFG (Profile)**. And **remove AI-slop copy** like "Deterministic State Machine Preview: This manifest builder remains a local simulation..." (the RIG preview blurb) and similar.
9. **Profile tabs: combine "Royalties ($27)" + "Earnings (0)" into ONE "SALES & ROYALTIES" tab.**
10. **Profile "Published & Shelf" summary tab — unclear point, REMOVE. Just keep "MY SHELF".**
11. **Profile: DroneHunter appears TWICE in My Shelf (two licenses NSW-DR-...08AE and ...7150) → should be ONE.** De-dupe owned apps.
12. **Rename profile tabs: "My Shelf" → "OWNED APPS", "Published Apps" → "PUBLISHED APPS".** (My Shelf and Published Apps are confusingly different — clarify: PUBLISHED = apps I made, OWNED = apps I bought.)
13. **Desktop icons should be draggable/reorganizable** — move them around the screen, positions persist.

## Deep reworks (need spec + design)
14. **RIG UI still makes no sense.** Nate: get a UX design agent to review the WHOLE app + specifically figure out how to turn RIG into an ENGINE with NO UI (it's infra, not a user-facing app). Remove RIG.EXE as a desktop app; fold its function into the deploy pipeline invisibly.
15. **INBOX / Agent Inbox — redo entirely.** It doesn't make sense. Nate's vision:
    - (1) Have a **file/repo to clone and run** — its own repo (the agent-inbox is already a real thing: natemcguire/agent-inboxes exists per memory).
    - (2) The app spins up a **simple server where agents can file emails to other agents, and we can observe.**
    - Spec out how it works: **each agent gets an email address**, we show **threaded discussions**.
    - The OTHER tabs (Cloud Proposals, Marketplace) are **not needed** — strip to just the agent mailbox.
    - Needs a real spec first.

## Approach
- Do the quick fixes (1-13) as concrete edits, deploy in batches.
- For 14 (RIG) + 15 (Inbox rework): dispatch a UX-design-review agent to spec them, THEN implement. These are "less is more / make it make sense" reworks, not new features.
- Honor hard rails on #7 (cross-subdomain login) — first-party only, never tenant hosts.

## Status (updated 2026-09-02) — all shipped to prod except the two reworks
- ✅ #1 (500s / wizard "failed to load starters") — client retry-with-backoff + auth `me` soft-200 on transient D1. Deployed b377150.
- ✅ #2 (taskbar/Start login "does nothing") — Start-menu pointerdown fix (earlier) + the wizard 500 was the real "login feels dead" cause; modal wiring verified correct. Deployed.
- ✅ #3 Continue pinned · ✅ #4 CLI token labeled · ✅ #6 STANDALONE badge removed · ✅ #8-12 profile overhaul · ✅ #13 draggable icons — AGY batch, deployed c081982/5d18a96.
- ✅ #5 GITSMITH file viewer — showcase repos now render embedded file content (no doomed fetch → no 404). Verified live on dronehunter. Deployed b377150.
- ✅ #7 cross-subdomain login (first-party SSO) — apex-brokered single-use ticket, tenant hosts structurally excluded. Verified live (apex→hotwire inherit works; american-gardener tenant refused). migration 0037, deployed a66ebdd. Design: docs/superpowers/specs/2026-09-02-first-party-sso-design.md.
- 🔨 #14 RIG → no-UI engine — spec in progress (docs/superpowers/specs/2026-09-02-rig-engine-no-ui-design.md).
- 🔨 #15 Agent Inbox rework — spec in progress (docs/superpowers/specs/2026-09-02-agent-inbox-rework-design.md).
