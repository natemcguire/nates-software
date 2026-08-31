# Nate's Software — UX Review (Onboarding, Copy, Friction, Engagement)

**Scope:** New-user experience only — the first-run journey, button/CTA clarity, friction and dead-ends, and engagement hooks. **Explicitly out of scope and not commented on:** colors, fonts, spacing, the Win95 aesthetic, visual hierarchy. The retro look is intentional and off-limits.

**Method:** Walked the live site at nates-software.com as a returning-but-fresh visitor (wizard steps 1→2→3, HOTWIRE, PROFILE.CFG) and read the onboarding source (`SetupWizardView`, `App.tsx`, `AuthModal`, `AuthContext`, `ForkWithAiModal`, `MarketingWindow`, `HotwireView`, `ProfileView`, `StartMenu`, `DesktopTaskbar`). Copy is quoted verbatim from source with locations.

**One premise correction up front:** the brief references a new **"Generate CLI token"** feature on PROFILE.CFG. It does **not exist** in current prod. The only credential surface is a *paste-your-own* "GITSMITH SSH Public Key" field. The `slop login` command is referenced in the terminal but there is no in-UI token to pair with it. This is called out in Friction #F3.

---

## The core problem, stated once

The wizard is well-built but points the wrong way. **It funnels a brand-new browser visitor who has run nothing yet into a native-terminal CLI install (`slop fork nate/dronehunter`) as the primary path, then ends on a screen that asks them to "Verify" something the site openly admits it cannot see.** The one thing a newcomer came to do — *see an app actually run in the browser* — is never the happy path, and the button that promises it ("Open Upstream App Preview") instead dumps them into the drops board showing a raw JSON error. Everything below ladders up to fixing that.

Priorities are ranked by impact on a new user reaching "I made/ran something" and coming back.

---

## First-run / Onboarding

### O1 — The wizard's happy path is "go install a CLI," not "try it in the browser." *(highest impact)*
**Where:** SETUP.EXE, Step 2 "Install, Then Start Your Engines." The main content is a dark terminal box with `slop fork nate/dronehunter` and a **"Copy Install Command"** button. The only in-browser option is buried in an amber side-note ("Persistent or Disposable?") whose button says **"Try Ephemeral Terminal"** and which warns the workspace "is deleted when the session ends."
**Problem:** A first-time visitor has installed nothing and has no reason to trust the product yet. Asking them to open a native terminal and run a CLI is the steepest possible first step, and the browser alternative is framed as the throwaway/lesser option. This is backwards: the browser is the on-ramp, the CLI is the power-user upgrade.
**Fix:** Make **"Run [App] in the browser now"** the primary Step-2 action (a real button that opens the live sandbox for the *selected* starter). Demote the CLI box to a secondary "Prefer your own machine? Install with SLOP" panel below it. Reframe the ephemeral terminal warning as a feature, not a threat: *"Runs in a fresh cloud sandbox — nothing to install. Closes when you leave."*

### O2 — Step 3 "Verify" is a dead-end that asks the user to verify something the site can't see.
**Where:** SETUP.EXE, Step 3. Copy reads **"Verify the Native Install — This website cannot inspect your native filesystem. Your fork exists only after SLOP prints a successful worktree path and its install checks pass."** There is no actionable control; it's a passive wall of text plus a royalty table.
**Problem:** A "Verify" step with nothing to click and an admission that verification is impossible here is the definition of an anticlimactic dead-end. The user's momentum dies on the last screen.
**Fix:** Replace the "Verify" step with a **"You're in — what's next"** step that offers three concrete, working actions: *"Open [App] live"*, *"See its code on GITSMITH"*, *"Browse today's drops."* If a real CLI-verification handshake ever exists (paste the token SLOP prints), that becomes the one interactive control; until then, don't label a passive screen "Verify."

### O3 — The three step labels don't describe what the user does. "Launch Agent" especially.
**Where:** SETUP.EXE step indicator: **"1. Starter → 2. Launch Agent → 3. Verify."**
**Problem:** "Launch Agent" is internal framing — Step 2 is actually *install and open the app*, and it's entirely possible to finish without launching any agent. "Verify" (see O2) describes a thing that can't happen. A newcomer can't predict the flow from these words.
**Fix:** Relabel to what the user actually does: **"1. Pick an app → 2. Get it running → 3. Start building."**

### O4 — The wizard opens on a wall of jargon before the user has picked anything.
**Where:** SETUP.EXE, Step 1 subhead: *"Pick one of Nate's 3 flagship shareware apps. Built with modular, runtime- and storage-independent architectures with automated 70/20/10 royalty lineage."*
**Problem:** "Runtime- and storage-independent architectures" and "70/20/10 royalty lineage" are seller/architecture concepts dropped on someone who just wants to try a game. It raises the cost of the very first decision.
**Fix:** Lead with the buyer benefit: **"Pick an app to try. You get the running app plus its full source — yours to fork, mod, and even resell."** Move the royalty math to the point where it's relevant (when the user considers publishing), not Step 1.

### O5 — README_FIRST.TXT never invites the newcomer to *do* the obvious first thing, and never mentions signing up.
**Where:** MarketingWindow. Hero: **"Stop renting software. Own your files. Mod with AI."** Primary footer CTA: **"Fork in SLOPSHOP →."** Six cards use invented verbs: **"Enter Mod Bay →," "Inspect Dynos (Ports 3001..3010) →," "Explore Bare Repos →."**
**Problem:** The strongest first-run surface's primary action ("Fork in SLOPSHOP") is un-actionable for someone who hasn't selected an app and doesn't know what "fork" or "SLOPSHOP" mean. The card CTAs describe rooms, not outcomes. And there is no "Create account / Sign up" prompt anywhere on the highest-traffic page.
**Fix:** Make the hero's primary button **"Try an app now →"** (opens SETUP.EXE Step 1). Rewrite card CTAs to outcomes: "Enter Mod Bay" → **"Mod an app with AI →,"** "Inspect Dynos" → **"See what's running →,"** "Explore Bare Repos" → **"Browse the code →."** Add a low-key secondary line: *"Free to browse and fork. Create a maker account when you're ready to publish."*

---

## Copy / Labels

### C1 — "Open Upstream App Preview" opens the drops board, not a preview. *(confirmed live; near-top impact because it's the wizard's payoff button)*
**Where:** SETUP.EXE Step 3 has **three** competing buttons: **"Open Upstream App Preview"** (blue), **"Inspect Upstream on GITSMITH,"** and a footer **"Open Upstream Preview."** In `App.tsx`, `onOpenSandbox` is wired to `openWindow('hotwire')` — so both "preview" buttons open HOTWIRE, and in my walkthrough the board auto-selected an unrelated app ("Hello Postgres") whose sandbox showed `{"success":false,"error":"Asset 'index.html' not found for active deployment of 'hello-pg'."}`.
**Problem:** The label promises "a preview of the app I just picked" and delivers "an unrelated board with a JSON error." This is the single worst label/action mismatch on the critical path — it breaks trust at the moment of payoff.
**Fix:** Either (a) actually open the selected starter's live sandbox and label it **"Run DroneHunter 95 now"** (interpolate the real app name), or (b) if it must open a board, label it honestly: **"Browse the drops board."** Never call something a "preview" of app X when it shows app Y. Collapse the three near-duplicate buttons into one primary + one secondary. And make sure the target renders the *selected* app, not a random one, and never surfaces a raw error JSON to a first-timer.

### C2 — The upvote control is an unlabeled flame; nobody will read it as "vote." 
**Where:** HotwireView, drop list. Each row shows a flame icon over a number (e.g. "0"), tooltip **"Upvote drop."** No visible text.
**Problem:** A flame + a "0" reads as a stat, not an action. New users won't discover that this is the voting mechanic — which is one of the site's core engagement loops.
**Fix:** On the selected/hovered drop, show a real button: **"▲ Upvote (0)."** Keep the compact flame in the list, but ensure the *primary* selected-drop CTA has the word "Upvote." (See E1 for the auth timing.)

### C3 — "Sign Up" vs "Create Account" vs "Create username": three verbs for one action.
**Where:** Taskbar button **"Sign Up"** (`DesktopTaskbar`); AuthModal tab and submit **"Create Account"**; SETUP.EXE identity block **"Create username."**
**Problem:** Same destination, three names. Inconsistent vocabulary makes the product feel less trustworthy and makes the action harder to recognize on repeat.
**Fix:** Pick one and use it everywhere. **"Create account"** is clearest for a consumer marketplace. Update the taskbar and the wizard to match.

### C4 — Backend nouns leak into user-facing copy across the app.
**Where:** ForkWithAiModal success: *"registered in D1 with immutable lineage tracking and outbox event dispatch"*; not-forkable state: *"Forge State: unlinked (repository_id is null)"*; HotwireView: *"cryptographic upvotes"*; ProfileView status pills: **"● D1 SYNCED," "saved to Cloudflare D1."**
**Problem:** "repository_id is null," "outbox event dispatch," and "D1" are implementation details. To a buyer they read as noise at best, as errors at worst.
**Fix:** Translate to user terms. "repository_id is null" → **"This app hasn't published its source yet, so it can't be forked."** "outbox event dispatch" → drop it. "D1 SYNCED" → **"Saved."** "cryptographic upvotes" → **"verified votes."**

### C5 — "Fork" is never defined for a non-developer, and logged-out users are shown "Fork: @guest."
**Where:** ForkWithAiModal. Lineage line shows **"Base: @author → Fork: @guest"** when logged out. No plain-language explanation of what forking gives you.
**Problem:** "Fork" is the central verb of the whole product and it's assumed knowledge. "@guest" as a fork owner implies a guest can own a fork, which isn't true.
**Fix:** Add one line at the top of the fork modal: **"Forking gives you your own private copy of this app's code to change with AI — and if you sell it later, you keep 70%."** For logged-out users, don't render "@guest"; show **"Fork: (your account)"** and note sign-in is needed to keep the fork.

---

## Friction / Dead-ends

### F1 — Auth is enforced *after* the click, silently, with no upfront cue (voting and forking).
**Where:** HotwireView upvote fires optimistically, then on server rejection rolls back with an alert: *"Authentication is required to record a verified upvote. Please sign in to vote for this drop."* ForkWithAiModal only checks auth when the real-fork CTA is clicked, then alerts *"You must be signed in to fork this project…"*. In `AuthContext`, `requireAuth` receives an `_actionDescription` that is **discarded** — so the login modal never says why it appeared.
**Problem:** The user acts, sees success (the flame lights), then it silently reverses with a modal. That "it worked, no it didn't" whiplash is worse than a clean upfront gate. And the login modal that appears gives no context for why.
**Fix:** Gate proactively and contextually. If logged out, the upvote button reads **"Sign in to vote"** and the fork CTA reads **"Sign in to fork."** Stop discarding `actionDescription` — pass it into the modal header so it reads, e.g., **"Sign in to upvote this drop."** (This alone recovers a value prop for the auth modal — see F4.)

### F2 — Empty states name a destination but don't link to it. *(applies to the shelf, published, royalties)*
**Where:** PROFILE.CFG shelf (confirmed live, empty even for the owner): **"Your Software Shelf is Empty — Acquire apps from the 12:01 AM Daily Drops or HOTWIRE feed to register authoritative licenses on your shelf."** Same pattern on Published Apps and Royalties tabs.
**Problem:** The copy tells you where to go but makes you go find it yourself. The empty screen should be the on-ramp, per the design principle "an empty screen is an invitation to act."
**Fix:** Add the button the sentence implies: **"Browse today's drops →"** (opens HOTWIRE) directly in the empty shelf. Same for Published: **"Publish your first app →"** (opens GITSMITH). Also drop "acquire" / "register authoritative licenses" for plain **"Buy or claim an app and it shows up here."**

### F3 — The credential story for the CLI is missing/mismatched.
**Where:** The brief expects a **"Generate CLI token"** button on PROFILE.CFG. It doesn't exist. The only credential control is **"GITSMITH SSH Public Key"** — a paste field with help *"Registers this public key for GITSMITH authorization,"* which assumes the user already has an Ed25519 keypair. The terminal separately says *"Type 'slop login' or click Log In,"* but there is no token to obtain.
**Problem:** A user who wants to use `slop` from their machine hits a wall: `slop login` implies a token flow that has no UI, and the SSH field assumes prior knowledge with no "how to generate a key" help. This is a broken bridge between the browser and the CLI.
**Fix (aligns with the CLI-token work in flight):** Add the **"Generate CLI token"** button the flow needs, with copy that shows exactly what to do: **"Run `slop login`, then paste this token."** For the SSH field, add a one-line **"Don't have a key? Run `ssh-keygen -t ed25519` and paste the `.pub` file"** helper. Until the token exists, don't let the terminal advertise `slop login`.

### F4 — The signup modal is a bare "SECURITY & AUTHENTICATION" dialog with zero reason to say yes.
**Where:** AuthModal title **"NATE'S SOFTWARE SECURITY & AUTHENTICATION."** Fields, a password rule, no value proposition. It's framed as a system dialog, not an invitation.
**Problem:** This is the single highest-intent conversion moment and it sells nothing. The one place with a half-decent pitch (ProfileView logged-out: "maker economics," "lineage royalties") is abstract.
**Fix:** Add one concrete benefit line at the top, ideally the action-specific one from F1: **"Create an account to keep your forks, vote on drops, and earn 70% when you sell."** Retitle the modal from the system-dialog framing to **"Join Nate's Software"** / **"Welcome back."**

### F5 — The desktop offers 14 icons and no "start here" signal beyond the wizard.
**Where:** Desktop grid: SETUP, GITSMITH, README_FIRST, RIG, TERMINAL, INBOX, CHAT, HOTWIRE, EDITORIAL, SLOPSHOP, DYNO, PROFILE, WHITE_PAPERS, Source on GitHub. The wizard auto-opens (good), but if the user closes it, they face 14 equally-weighted, mostly opaque icons (RIG.EXE, DYNO, SLOPSHOP mean nothing cold).
**Problem:** Once the wizard is dismissed there's no re-entry hint; the desktop is a flat menu of jargon. A returning user who bounced from the wizard has no obvious second try.
**Fix:** Keep SETUP.EXE labeled **"START HERE"** (or add that as its sublabel) so the entry point stays obvious. This is a labeling/wayfinding change, not a visual one.

---

## Engagement

### E1 — The daily-drops hook (the site's best retention mechanic) is undersold to a newcomer.
**Where:** HotwireView shows a live **"Next UTC Drop: 00h 37m 55s"** countdown (confirmed live) and filter tabs "Today / Top Forked / All-Time / Streaks." But the word **"drop"** is never defined, the countdown is in **UTC** (labeled "12:01 AM" which misleads anyone not on UTC), and voting's payoff isn't explained.
**Problem:** "A daily 12:01am batch of new shareware you can vote on" is a genuinely good habit loop — but a newcomer can't tell that's what they're looking at. "Drop" is undefined, and "12:01 AM" reading as *their* midnight when it's UTC erodes trust in the countdown.
**Fix:** Add a one-line definition at the top of HOTWIRE: **"Every day at 12:01 AM UTC, makers drop new apps. Vote for your favorites."** Show the countdown in the viewer's local time with a "(UTC)" note, or convert it. This tiny copy change turns a mysterious board into a reason to come back tomorrow.

### E2 — The 70/20/10 royalty story is shown to buyers before it's relevant, and to sellers without a path to act.
**Where:** The royalty split appears prominently in SETUP.EXE Step 3, on every drop row ("Fork policy: 70% if sold"), and in ProfileView. Yet PROFILE.CFG shows **"Stripe Payouts: Not Connected"** with no prompt to connect.
**Problem:** For a first-time *buyer/tinkerer*, royalty math is noise (they haven't made anything). For a would-be *seller*, the economics are advertised everywhere but the actual "connect payouts and start earning" step is a passive "Not Connected" pill with no CTA. The hook is loud but the conversion path is missing.
**Fix:** Move royalty messaging out of the newcomer's first-run and into the publish/sell moment. Where it belongs (a maker considering publishing), make it a live CTA: turn "Stripe Payouts: Not Connected" into a button **"Connect payouts to start earning →."** The economics are the reason serious makers stay — surface them at the decision point, not the arrival point.

### E3 — Nothing rewards or acknowledges the newcomer's first successful action.
**Where:** Across the flow, completing the wizard, forking, or voting produces either an alert full of backend nouns (ForkWithAiModal success) or a silent rollback (F1). There's no "you did it, here's what's next."
**Problem:** First-time users need a small win and a clear next step to form a habit. Right now the "win" moments are described in D1/outbox language or reversed silently.
**Fix:** After a real fork or first vote, show a short, plain success with one forward action: **"Nice — you forked DroneHunter 95. Open it in the browser →"** or **"Vote counted. See today's leaders →."** One concrete next step keeps the session going instead of ending it on a system message.

---

## Suggested order of attack (by leverage)

1. **O1 / C1** — Make "run it in the browser now" the wizard's primary path, and fix the "preview" button so it actually previews the selected app (and never shows raw error JSON). *This is the make-or-break of first-run.*
2. **O2 / O3** — Replace the "Verify" dead-end with a "what's next" step; relabel the three steps to plain actions.
3. **F1 / F4** — Gate auth proactively with context ("Sign in to vote/fork") and give the signup modal one real reason to exist.
4. **E1** — Define "drop," fix the UTC countdown, and explain voting — the daily-return hook.
5. **F2 / C2 / C3 / C4 / C5** — Wire empty states to their destinations; label the upvote control; unify "Create account"; de-jargon user-facing copy.
6. **F3 / E2 / E3** — Build the CLI-token bridge, turn the payouts pill into a CTA, and reward first actions.
