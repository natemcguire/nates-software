# Logged-In View Suggestions — Nate's Software

A prioritized survey of what should change when a user is **logged in** vs **logged out**, across the desktop shell and every app. Read-only audit; no code was changed.

**How auth works today:** `useAuth()` (`src/context/AuthContext.tsx`) exposes `user` (`username`, `displayName`, `avatar`, `role`, `isSuperAdmin`), `isAuthenticated`, `openAuthModal(tab)`, and `requireAuth(desc, cb)`. Ownership/shelf lives in `useCatalog()` (`src/context/CatalogContext.tsx`): `isOwned(appId)`, `shelfAppIds`, `recordPurchase()`. Session hydrates from `/api/auth?action=me` on mount.

**The overall pattern:** Only **ProfileView** and the **taskbar/StartMenu** truly personalize. Two views (Slopshop, Dyno, Editorial, Marketing, WhitePapers) never import `useAuth` at all. Several that *do* import `user` use it only as a refetch key or login gate and never read `user.username` to personalize display, authorize actions, or filter to "mine." Multiple surfaces hardcode `@nate`/`@guest`/`nate`/`josh`.

Each item: **location → logged-out now / logged-in now → the gap → suggestion**, tagged **[quick win]** or **[bigger]**, grouped by area, ranked by impact within the doc.

**Backend reality (confirms the labels):** The server already has a solid auth foundation — a shared `getSessionUser`/`requireAuth` (`functions/api/_auth.ts`) reads the `nsw_session` cookie and scopes `/api/shelf`, `/api/inbox`, `/api/comments`, `POST /api/drops`, and `/api/profile` (owner earnings) correctly per user. So most logged-in-view fixes here are **frontend quick wins**. The genuinely bigger backend gaps: per-drop `votedByMe`/`isMine` on the drops feed (GET `/api/drops` isn't even authenticated), a "my votes" read API, an inbox unread-total, and a "my contributor grants" read API (the `contributor_shares` table exists but has no read endpoint).

---

## TIER 1 — Highest impact (identity correctness + core "this product knows me")

### 1. Buying never touches the user's shelf/account — CHECKOUT / OWNERSHIP (cross-cutting)
- **Location:** `src/components/CheckoutModal.tsx` (no `useAuth`, no `useCatalog`); caller `ArtifactSandbox.tsx` L499–508 opens it with no `requireAuth`; `recordPurchase` (`CatalogContext.tsx:263`) has **zero call sites app-wide**; `sharewareSdk.saveStoredLicense` writes to **localStorage** (device-local).
- **Logged-out now:** Can open checkout and "pay" with no login prompt; no license bound to anyone.
- **Logged-in now:** Identical — no buyer identity shown, purchase is never recorded to `shelfAppIds`, no license key tied to the account.
- **Gap:** The entire "buy → it's on MY shelf with MY license key" loop is unwired. Ownership only exists via the initial `/api/shelf` fetch, never updated by a purchase.
- **Suggestion:** Require login before checkout; on success call `recordPurchase(app.id, key)` AND persist server-side so `/api/shelf` reflects it; show "Purchasing as @{username}" and the issued license key. Also: `CheckoutModal` hardcodes prices by `app.id` and ignores `app.price`, and hardcodes the royalty line to `@nate` — fix both. [**bigger**]

### 2. Shelf/ownership never refreshes on login or logout — CROSS-CUTTING
- **Location:** `src/context/CatalogContext.tsx` — `fetchAuthoritativeCatalog` runs once in a mount `useEffect` (L169–171); `/api/shelf` is fetched there and nowhere re-triggered by auth changes. `CatalogProvider` has no dependency on `AuthContext`.
- **Logged-out now:** Empty shelf (correct).
- **Logged-in now:** If a user logs in *after* first load (the normal case — they open the site, then click Log In), `shelfAppIds` is **not refetched**, so "My Shelf (N)" stays 0 and owned apps still show the "Register License" buy button until a manual reload.
- **Gap:** Logging in mid-session doesn't populate the things that make the app feel personalized (shelf count, owned badges).
- **Suggestion:** Re-run `refreshCatalog()` (or at least the `/api/shelf` fetch) whenever `useAuth().user` changes — both on login and logout. **Confirmed quick win:** `GET /api/shelf` already scopes to the session user server-side (`shelf.ts:12,25–27`), so only the frontend refetch trigger is missing. [quick win]

### 3. Chat: logged-out visitors post as `nate` (owner impersonation) — CHAT
- **Location:** `src/views/ChatView.tsx` — `currentNick` defaults to `'nate'` (L27); syncs to `user.username` only when logged in (L47–51); op styling is literal name match `sender === 'nate' || 'josh'` (L66); local messages self-declare `isOp: true` (L174) and POST `isOp: 1` (L188); presence list is static mock (`ircProtocol.ts:202–205`).
- **Logged-out now:** Posts messages as **`nate`** (the site owner), ungated, and can claim op.
- **Logged-in now:** `currentNick` = `user.username`, but `user.avatar` and `user.displayName` are never used; the real user is never inserted into the online-user list.
- **Gap:** Anonymous impersonation of the owner by default; logged-in identity only half-applied (no avatar, no presence, no display name).
- **Suggestion:** Default logged-out nick to a guest handle (or gate posting behind `requireAuth`); render `user.avatar`/`user.displayName`; insert the logged-in user into the presence list; derive op status from `user.role`, not a client-sent flag or name whitelist. (Security aside: `isOp` is client-trusted and `/nick` allows renaming to `nate`/`josh` — spoofable.) [quick win for the personalization; **bigger** for real presence/op]

### 4. INBOX shows APPROVE & MERGE to people who can't approve — INBOX
- **Location:** `src/views/InboxView.tsx` — `canApprove`/`canReject` come from `formatProposalStatus` (`inboxDomain.ts:69–141`), which decides purely from merge/approval state and diff mergeability; the approve/reject buttons (L812–829) and reward-grant control (L794–802) render on that alone. `direction: 'sent'|'received'` is used only to hide "Mark Read" (L561), never the approve controls.
- **Logged-out now:** 401 → "Log In to Authenticate" notice (correct).
- **Logged-in now:** Sees real threads scoped by the server, but the "Approve Exact OID" / "Request Changes" / grant-reward buttons appear even on proposals the user **sent** or on repos they don't own.
- **Gap:** UI honesty — the action is offered to the wrong person and only fails *after* they click. (Not a security hole: the server enforces `repositoryOwnerId !== userId → 403` at `inbox.ts:392`, and threads are already scoped to the user with a server-computed `direction`.) The UI implies a sender can approve their own proposal, then errors on POST.
- **Suggestion:** Hide/disable approve+reject+grant unless `direction !== 'sent'` and the viewer owns the target repo. Cleanest: have the server include a `canApprove` boolean per thread (it already knows the owner) and drive the buttons off that. [quick win — server authorization already correct; purely a client display fix]

---

## TIER 2 — Desktop shell & cross-cutting "signed-in-as" gaps

### 5. The desktop itself is identical logged-in vs logged-out — DESKTOP SHELL
- **Location:** `src/App.tsx` `AppInner` (desktop branch). Icons grid, themes, wallpaper, and window set never read `useAuth`.
- **Logged-out now / logged-in now:** Same icons, same layout, no greeting, no "your stuff."
- **Gap:** A logged-in user gets no desktop-level acknowledgment — no "Welcome back @{displayName}", no shortcuts to *their* shelf / inbox / drops, no owned-app icons on the desktop.
- **Suggestion:** When logged in, surface a small greeting and/or a "My Stuff" cluster (My Shelf, My Inbox, My Drops) — or pin owned apps as desktop icons. The taskbar/StartMenu already know the user; extend that to the desktop surface. [**bigger**]

### 6. SETUP.EXE auto-opens on every load for everyone, including returning logged-in users — DESKTOP SHELL
- **Location:** `src/hooks/useWindowManager.ts` — `setup.isOpen: true` unconditionally (L57–68); no first-run/localStorage/auth gate. `SetupWizardView` greets by name if logged in but does not shorten the flow.
- **Logged-out now:** Setup wizard opens (reasonable for a first-timer).
- **Logged-in now:** Setup wizard **still opens every time**, re-nagging established users to "create a username."
- **Gap:** Returning/logged-in users are treated as brand-new on every visit.
- **Suggestion:** Only auto-open SETUP for first-run (persist a "seen" flag) and/or when logged out. When logged in, collapse/skip the "Publishing Identity" step and greet by `displayName`. [quick win]

### 7. Standalone subdomains/routes have no auth chrome at all — CROSS-CUTTING
- **Location:** `src/App.tsx` `renderStandaloneWrapper` (~L185) and the `standalone_app` header (~L154) render views with **no `DesktopTaskbar`** — only a "Return to Web OS" link.
- **Logged-out now / logged-in now:** On `hotwire.nates-software.com`, `gitsmith.*`, `inbox.*`, etc., there is **no "signed in as @X" indicator and no Log In / Sign Up button** in the chrome. The only signal is whatever a view triggers internally.
- **Gap:** A whole class of entry points (the per-app subdomains, which are the shareable URLs) can't tell you who you are or let you log in.
- **Suggestion:** Add a compact account widget (reuse the taskbar's) to the standalone header — show `@username`/avatar when logged in, Log In/Sign Up when not. [quick win]

### 8. INBOX window title & desktop icon aren't personalized / no unread badge — DESKTOP SHELL + INBOX
- **Location:** `useWindowManager.ts:124` inbox title hardcodes `nate@natesoftware`; desktop INBOX icon (`App.tsx` L426) and StartMenu INBOX entry show no unread count; `InboxView` `counts.unread` is page-local, not a true server total.
- **Logged-out now:** N/A / 0.
- **Logged-in now:** Title still says `nate@natesoftware`; no unread indicator anywhere on the desktop.
- **Gap:** The mailbox doesn't show it's *my* mailbox or how many unread items I have.
- **Suggestion:** Title → `@{user.username}`'s inbox [quick win]; add an unread badge to the INBOX icon/StartMenu entry — **but** `/api/inbox` returns no aggregate unread total today (only per-thread `unread` on the loaded page), so a true badge needs a small new count endpoint/field [**bigger**].

---

## TIER 3 — Per-app personalization gaps

### 9. HOTWIRE: no "I voted" state and no "my drops" — HOTWIRE
- **Location:** `src/views/HotwireView.tsx` — no `useAuth`; `upvotedApps` is a session-local `useState<Set>` (L44), never seeded from real vote history; `app.voters` is rendered but never checked against `user.username`; drop author `by @{app.author}` (L437) is never compared to the user.
- **Logged-out now / logged-in now:** Identical board; on reload a logged-in user can't tell which drops they already upvoted, and can't see/filter their own submissions.
- **Gap:** No persistent per-user vote state; no "mine" badge/filter.
- **Suggestion:** (a) The "Mine" badge/filter (`app.author === user.username`) and importing `useAuth` are frontend **quick wins**. (b) The persistent "I already voted" state is **[bigger]**: `GET /api/drops` isn't even authenticated and returns no `votedByMe`, and `drop_upvotes` is write-only (no read API), so surfacing prior votes needs the drops GET to auth + join, or a new "my votes" endpoint. Also pre-gate the Upvote button with `requireAuth` (quick win) instead of optimistic-then-rollback.

### 10. DYNO: submit ungated, "my badge" ignores my username, no "my runs" — DYNO
- **Location:** `src/views/DynoView.tsx` — no `useAuth`; "Submit Self-Reported Run" (L659–667) → `handleSubmitBundle` POSTs to `/api/dyno` with no login prompt (despite L608 saying sign-in is required); `copyBadge` (L325–332) reads `username` from the **selected run record**, never `user.username`, and no-ops if absent; leaderboard (L782–844) has no owner column.
- **Logged-out now:** Can validate + click submit → raw server rejection, no login prompt.
- **Logged-in now:** No personalization; badge only works if the selected run happens to carry a username.
- **Gap:** Can't reliably get *my* badge (`/dyno/@{username}` plumbing exists in `dynoDomain.ts:116`), can't see *my* runs, submit doesn't know it's me.
- **Suggestion:** Import `useAuth`; gate submit with `requireAuth`; fall back badge username to `user.username`; add a "My Runs" filter / owner column. [quick win]

### 11. SLOPSHOP: maker attribution hardcoded to `@nate` — SLOPSHOP
- **Location:** `src/views/SlopshopView.tsx` — no `useAuth`; `makerHandle` state defaults to `'@nate'` (L44) and flows into every generated fork command, branch name, and downloaded `slop-feature.json`.
- **Logged-out now / logged-in now:** Identical — all generated artifacts are attributed to `@nate` unless the user manually retypes the free-text field.
- **Gap:** A logged-in maker's welds/forks are attributed to the site owner.
- **Suggestion:** Import `useAuth`; seed `makerHandle` from `@{user.username}` when authenticated; surface a "signed in as" line near the CAS gateway. [quick win]

### 12. GITSMITH: no "my repos" view and no "your fork lives at @you" preview — GITSMITH
- **Location:** `src/views/GitsmithView.tsx` — imports `user` but uses it only as a refetch key + create-repo gate; repo list (`/api/git?list=1`) is flat with no `repo.owner === user.username` highlight/filter; clone command uses `repo.owner` (L371–379); bundled repos hardcode `owner:'nate'`, `author:'nate'`.
- **Logged-out now:** Adaptive empty-state copy ("Sign in to create a repository…") — good.
- **Logged-in now:** Nearly identical; repo list isn't filtered/badged to the user; no indication where a fork of a repo would land.
- **Gap:** Can't distinguish my repos from all repos; forking doesn't preview my destination namespace.
- **Suggestion:** Add a "Mine" filter / "owned by you" badge via `repo.owner === user.username`; when forking, show "your fork → @{user.username}/{repo.name}". [quick win]
- **Note:** `ForkWithAiModal` itself already personalizes correctly (`makerHandle = user?.username || 'guest'`, gated at action time, post-success clone → `@{user.username}/…`). The fork-identity offenders are elsewhere (items 11, 13, 14).

### 13. ARTIFACTSANDBOX: hardcoded MAKER badge + hardcoded fork/clone owner — HOTWIRE detail
- **Location:** `src/components/ArtifactSandbox.tsx` — MAKER badge on a new comment is `isMaker: user.username === 'nate' || 'josh'` (L171); the "Local AI Agent Workflow" modal's clone commands hardcode `git clone https://github.com/natemcguire/{app.id}.git` (L601, L626, L644, L662, L680); "Register License" (buy) and "Fork with AI" open modals with no `requireAuth` (only comments are gated, L152).
- **Logged-out now:** Can open buy/fork modals; comments correctly prompt login.
- **Logged-in now:** Comments post as `@{user.username}` (good), but the MAKER badge is only granted to `nate`/`josh` literally, and every "fork this with AI" command points at `natemcguire`'s GitHub rather than the user's namespace.
- **Gap:** Maker status is name-hardcoded not role-based; AI-fork commands don't reflect who's forking.
- **Suggestion:** Derive MAKER from `user.role`/`isSuperAdmin` or `app.author === user.username`; parametrize the AI-workflow clone URLs to the user's fork namespace; gate the buy button with `requireAuth`. [quick win]

### 14. SETUP wizard & MARKETING hardcode `@nate` / `nate/…` — SETUP + MARKETING
- **Location:** `SetupWizardView.tsx` fork command `slop fork nate/${starter.id}` (L66–68), greets by `username` only, doesn't shorten flow when logged in; `MarketingWindow.tsx` "My Profile" card badge hardcodes `@nate` (L115) and says "your Shareware shelf" to everyone.
- **Logged-out now:** Register/Log-in CTAs (setup) / static cards (marketing).
- **Logged-in now:** Setup shows a green "Signed in as @{username}" badge but the fork command still says `nate/…`; Marketing's "My Profile" card still says `@nate` even for `@josh`.
- **Gap:** Personalized-looking surfaces show the owner's identity to everyone.
- **Suggestion:** Fork command → `slop fork {user.username}/{starter.id}` when logged in; Marketing "My Profile" card → `@{user.username}` + "Welcome back" vs "Sign up" CTA. [quick win]

### 15. RIG: fleet is "yours" in copy but never shows whose it is — RIG
- **Location:** `src/views/RigRuntimeView.tsx` — uses `useAuth` correctly to gate the live fleet fetch (L93, L110) and branch empty-state copy (L736–737), but never renders `user.username`/`displayName` in the HUD; simulation instances (`new RigControlPlane()` per mount, L35) aren't per-user persisted.
- **Logged-out now:** Sim fleet only; "Sign in, then supply an image digest…".
- **Logged-in now:** Live fleet fetched, copy says "your fleet," but the owner is never displayed and instances aren't labeled with an owner.
- **Gap:** No visible identity/ownership; sim state vanishes on reload and isn't tied to the account.
- **Suggestion:** Show "@{username}'s fleet" in the HUD header; label instances with owner; persist sim state per user. [quick win for display; **bigger** for persistence]

### 16. TERMINAL: SLOP CLI bridge is auth-blind — TERMINAL
- **Location:** `src/views/TerminalView.tsx` — `whoami` is correctly personalized (L197–207), but `runSlopCli(slopArgs)` (L129) receives no user context, so `slop shelf`/`status`/`list`/`profile` can't reflect the account from the client; fork hint hardcodes `slop fork nate/dronehunter` (L122).
- **Logged-out now:** `whoami` → "Guest User (Unauthenticated)"; correct.
- **Logged-in now:** `whoami` shows real account, but `slop shelf` etc. can't show *my* owned titles/keys unless the CLI shim independently reads the session.
- **Gap:** The advertised account-aware commands don't actually use the logged-in identity.
- **Suggestion:** Pass `user` (or a session token) into `runSlopCli`; make `slop shelf`/`profile` render the real account; default fork target to `{user.username}/…`. [quick win client-side; **bigger** if the shim needs a real session bridge]

### 17. PROFILE: header not seeded from `user` during load — PROFILE
- **Location:** `src/views/ProfileView.tsx` — the exemplar view (shelf, royalties, SSH keys, license keys, settings all gated on server `isOwner`), but it destructures only `isAuthenticated`/`openAuthModal`, not `user`; header shows placeholder `@` / "Anonymous Maker" until `/api/profile` resolves.
- **Logged-out now:** Dedicated guest screen (correct).
- **Logged-in now:** Brief flash of empty header before the fetch completes.
- **Gap:** Minor — could optimistically render identity from context.
- **Suggestion:** Seed header `displayName`/`avatar`/`@username` from `useAuth().user` immediately, then reconcile with the fetch. [quick win]

### 18. EDITORIAL: no maker/admin authoring or personalization — EDITORIAL
- **Location:** `src/views/EditorialView.tsx` — no `useAuth`; authors are hardcoded strings; claps are ephemeral `useState`, reset on remount, anonymous.
- **Logged-out now / logged-in now:** Identical; an `isSuperAdmin` user has no "New Review"/"Edit" affordance; claps aren't tied to the account.
- **Gap:** No admin write path, no "my claps"/"my reviews."
- **Suggestion:** Show "New Review"/"Edit" when `isSuperAdmin`; persist claps per user. [**bigger**]

### 19. New-drop editor shows "guest" as the author instead of the maker — HOTWIRE / POST EDITOR
- **Location:** `HotwireView.tsx` new-drop template hardcodes `author:'guest'`/`creator:'guest'` (~L175–178); `PostEditorView.tsx` never imports `useAuth`, so the editor UI never shows who's publishing.
- **Logged-out now:** Template says "guest" (fine — the server rejects unauthenticated POSTs).
- **Logged-in now:** A logged-in maker's editor still shows "guest" as the author, even though on save the **server correctly overrides it** with the session user (`drops.ts:264` `creatorId = authUser.id`).
- **Gap:** Cosmetic but confusing — the maker never sees their own attribution while editing; and "Submit Drop" isn't gated so a logged-out user only discovers the wall on submit.
- **Suggestion:** Seed the template from `user.username`/`user.avatar` and gate "Submit Drop" with `requireAuth`. Pure display fix — the persisted authorship is already correct server-side. [quick win]

### 20. ARTIFACTSANDBOX: no "you own this / your earnings on this app" beyond the shelf badge — HOTWIRE detail
- **Location:** `src/components/ArtifactSandbox.tsx` — `isOwned(app.id)` drives "License Active on Shelf" vs buy (L493–509, good); `grantableBps` shows "up to X% available to contributors" generically (L473–481).
- **Logged-out now / logged-in now:** The grant line reads identically to everyone; there's no indication whether *I* hold a grant on this app or what I've earned from it.
- **Gap:** A contributor who was granted equity in this app sees the same generic "up to X% available" text as a stranger, with no "you hold Y% / you've earned $Z here."
- **Suggestion:** When logged in, show the viewer's own grant/earnings on this app. Note: **"my earnings" (sales/lineage royalties) already exists** server-side via the `/api/profile` owner path (`profile.ts:103–156`, consumed by ProfileView), but **"my contributor grants" (the `contributor_shares` equity I hold in *others'* repos) has no read endpoint** — the table is written on inbox approval but never queried for display. So an app-scoped "your grant here" needs a new backend read API. [**bigger**]

---

## Backend labels — confirmed verdicts

The backend already resolves the session user via a shared `getSessionUser`/`requireAuth` (`functions/api/_auth.ts`, reading the `nsw_session` cookie) and scopes most per-user data correctly. Confirmed:

- **Item 1 (buy → shelf):** `POST` purchase flow is unwired client-side (`recordPurchase` has zero call sites; license saved to localStorage). **[bigger]** — needs client wiring + server-issued license bound to the account.
- **Item 2 (shelf refetch on login):** `GET /api/shelf` already scopes by session cookie (`shelf.ts:12,25–27`). **Frontend quick win** — just refetch on `user` change.
- **Item 4 (inbox approve visibility):** Server already enforces owner-only approval (`inbox.ts:392` → 403) and provides per-thread `direction`. **Frontend quick win** — hide buttons off `direction`/a server `canApprove`.
- **Item 8 (inbox unread badge):** Title personalization is a quick win; the badge is **[bigger]** — `/api/inbox` returns no aggregate unread total (only per-thread `unread` on the loaded page).
- **Item 9 (voted-by-me):** "Mine" badge/filter is a quick win; persistent "I voted" is **[bigger]** — `GET /api/drops` isn't authenticated and `drop_upvotes` is write-only (no read API).
- **Item 19 (drop authorship):** `POST /api/drops` already derives `creator` from the session and ignores the client field (`drops.ts:264`). **Frontend quick win** (display only) — not the data-integrity problem it first appears.
- **Item 20 ("my earnings"):** `/api/profile` owner path already returns sales + lineage royalties (`profile.ts:103–156`); a "my contributor grants" read API does **not** exist (`contributor_shares` is write-only). **[bigger]** for the grants piece.
- **Aside (spoofing, not a logged-in-view item):** `/api/comments` and `POST /api/drops` both derive author from the session and ignore client-sent `author`/`creator` — good, not spoofable. Chat's `isOp` flag, by contrast, is client-trusted (`ChatView.tsx:188`) and should be a server/role decision.

## Dead code (context, not action items)

`SharewareNagScreen.tsx` and `NatesLLMSpecsCard.tsx` are defined but never rendered/imported anywhere — the ownership-aware nag (which would check `isOwned` to suppress for owners) is unwired, reinforcing item 1.
