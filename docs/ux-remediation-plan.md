# UX + Logged-In Personalization Remediation Plan

Source: `docs/ux-review.md` (onboarding/copy/friction/engagement) + `docs/logged-in-view-suggestions.md`
(logged-in vs logged-out personalization). This is the executable rollup. The Win95 visual style is
INTENTIONAL and OFF-LIMITS — every item here is copy/logic/personalization, never restyling.

Status legend: [DONE] already shipped · [WAVE-N] assigned to a dispatch wave · [FOLLOW-UP] bigger, deferred.

## Already resolved (verify, don't rebuild)
- Buy → shelf loop (UX-scan Tier-1 #1): buy→own proven live in prod (order→pay→license). [DONE]
- Shelf refetch on login (Tier-1 #2): CatalogContext refetches shelf on auth change. [DONE]
- Chat identity/op/presence (Tier-1 #3): cluster G made chat real. [DONE — verify no `nate` default remains]
- Inbox unread total (item 8 bigger): F added `GET /api/inbox?action=unread-count` + badge. [DONE]
- "My contributor grants" read API (item 20 bigger): A2 added `GET /api/payments/grants` + earnings UI. [DONE]

## WAVE-UX-A — First-run wizard + marketing (owns: SetupWizardView, MarketingWindow, App.tsx onOpenSandbox)
Coordinated with the K agent (K owns SetupWizardView/ProfileView) — run AFTER K merges or hand these to K.
- O1: make "Run [App] in the browser now" the PRIMARY Step-2 action (opens the selected starter's live
  sandbox); demote the `slop fork` CLI box to a secondary "Prefer your own machine?" panel.
- C1: fix "Open Upstream App Preview" — it currently calls `openWindow('hotwire')` and shows an unrelated
  app's raw error JSON. Either open the SELECTED app's live sandbox labeled "Run {AppName} now", or label it
  honestly "Browse the drops board". Never show raw error JSON to a first-timer. Collapse the 3 near-dup
  preview buttons to one primary + one secondary.
- O2: replace Step-3 "Verify" dead-end with a "You're in — what's next" step (3 real actions: Open live /
  See code on GITSMITH / Browse drops).
- O3: relabel steps "1. Pick an app → 2. Get it running → 3. Start building" (kill "Launch Agent"/"Verify").
- O4: Step-1 subhead → buyer benefit ("Pick an app to try. You get the running app plus its full source —
  yours to fork, mod, and even resell."). Move 70/20/10 to the publish moment.
- O5: MarketingWindow hero primary → "Try an app now →" (opens SETUP step 1); card CTAs → outcomes
  ("Mod an app with AI →", "See what's running →", "Browse the code →"); add low-key "Free to browse and
  fork. Create a maker account when you're ready to publish."
- UX-scan #14: SetupWizard fork command → `slop fork {user.username}/{starter.id}` when logged in;
  Marketing "My Profile" card → `@{user.username}` not hardcoded `@nate`.
- UX-scan #6: only auto-open SETUP on first-run (persist a "seen" flag) and/or when logged out; skip the
  "Publishing Identity" step when logged in.

## WAVE-UX-B — Auth modal + proactive gating + desktop wayfinding (owns: AuthModal, AuthContext, DesktopTaskbar, App.tsx)
- F1: gate auth PROACTIVELY + contextually. Logged-out upvote button reads "Sign in to vote", fork CTA reads
  "Sign in to fork". Stop discarding `AuthContext.requireAuth(actionDescription)` — pass it into the modal
  header ("Sign in to upvote this drop"). No more optimistic-then-rollback whiplash.
- F4: AuthModal — retitle from "NATE'S SOFTWARE SECURITY & AUTHENTICATION" to "Join Nate's Software" /
  "Welcome back"; add one concrete benefit line ("Create an account to keep your forks, vote on drops, and
  earn 70% when you sell.").
- C3: unify signup verb to "Create account" everywhere (taskbar "Sign Up", wizard "Create username").
- F5 / UX-scan #5: SETUP.EXE icon sublabel "START HERE"; when logged in add a small greeting / "My Stuff"
  cluster (My Shelf, My Inbox, My Drops). [greeting = quick; My-Stuff cluster = bigger]
- UX-scan #7: standalone subdomain header (renderStandaloneWrapper) gets a compact account widget
  (@username/avatar when logged in, Log In/Sign Up when not).
- UX-scan #8: inbox window title `nate@natesoftware` → `@{user.username}'s inbox`.

## WAVE-UX-C — Per-app @nate/@guest de-hardcoding + "mine" states (owns: SlopshopView, GitsmithView, DynoView, RigRuntimeView, HotwireView, PostEditorView, drops.ts)
All frontend quick wins unless noted. Import useAuth where missing; NEVER trust client-sent identity for
writes (server already derives author from session — keep that).
- #11 SLOPSHOP: seed `makerHandle` from `@{user.username}` (default was `@nate`); "signed in as" line.
- #12 GITSMITH: "Mine" filter / "owned by you" badge via `repo.owner === user.username`; fork preview
  "your fork → @{user.username}/{repo.name}".
- #10 DYNO: import useAuth; gate "Submit Self-Reported Run" with requireAuth; badge username falls back to
  `user.username`; "My Runs" filter / owner column.
- #15 RIG: show "@{username}'s fleet" in HUD; label instances with owner. [sim per-user persistence = FOLLOW-UP]
- #13 ArtifactSandbox: MAKER badge from `user.role`/`app.author===user.username` not literal `nate`/`josh`;
  parametrize AI-workflow clone URLs to the user's fork namespace; gate buy button with requireAuth.
  (NOTE: ArtifactSandbox is touched by the I+J+L agent for link-gating — coordinate/sequence.)
- C2 / #9 HOTWIRE: selected-drop primary CTA shows the word "Upvote (N)"; "Mine" badge/filter
  (`app.author === user.username`); pre-gate Upvote with requireAuth (no optimistic rollback).
  Persistent "I voted" state = FOLLOW-UP (GET /api/drops isn't authed; drop_upvotes is write-only).
- #19 PostEditor/new-drop: seed template author from `user.username`/avatar (server already overrides on
  save — display fix); gate "Submit Drop" with requireAuth.
- E1 HOTWIRE: one-line definition ("Every day at 12:01 AM UTC, makers drop new apps. Vote for your
  favorites."); show countdown in viewer's LOCAL time with "(UTC)" note.

## WAVE-UX-D — De-jargon copy + empty-state links (cross-cutting; owns: ForkWithAiModal, ProfileView pills, HotwireView copy)
- C4: translate backend nouns — "registered in D1 with immutable lineage tracking and outbox event
  dispatch" → plain; "repository_id is null" → "This app hasn't published its source yet, so it can't be
  forked."; "D1 SYNCED"/"saved to Cloudflare D1" → "Saved"; "cryptographic upvotes" → "verified votes".
- C5: fork modal — one plain line ("Forking gives you your own private copy of this app's code to change
  with AI — and if you sell it later, you keep 70%."); logged-out don't render "@guest" as fork owner.
- F2: empty states get the button the sentence implies — empty shelf → "Browse today's drops →"; empty
  Published → "Publish your first app →"; drop "acquire"/"register authoritative licenses" for plain copy.
- E3: reward first action — after a real fork/vote show a short plain success + one forward action
  ("Nice — you forked DroneHunter 95. Open it in the browser →").

## Inbox approval visibility (UX-scan #4) — [WAVE E, in flight]
Hide/disable approve+reject+grant unless `direction !== 'sent'` and the viewer owns the target repo (server
already enforces owner-only at inbox.ts:392 → this is a client honesty fix). The E agent is adding the
server `canApprove` gate; ensure the buttons drive off it.

## CLI-token bridge (F3 / UX-scan #16) — [FOLLOW-UP]
"Generate CLI token" button on PROFILE.CFG paired with `slop login`; SSH field gets "Don't have a key? Run
ssh-keygen -t ed25519" helper; until the token exists, the terminal shouldn't advertise `slop login`.
Pass `user`/session into `runSlopCli` so `slop shelf`/`profile` reflect the real account. Bigger — needs the
device-auth flow (the earlier `slop login` "not commissioned" failure).

## Dead code (UX-scan) — [WAVE I+J+L, in flight]
`SharewareNagScreen.tsx` + `NatesLLMSpecsCard.tsx` are never imported. Either wire the ownership-aware nag
(check isOwned to suppress for owners) or remove. I+J+L agent is handling dead-code removal.

## Editorial admin authoring (#18) + RIG/sandbox per-user persistence (#15/#20) — [FOLLOW-UP]
Bigger backend work; not blockers for feature-complete.
