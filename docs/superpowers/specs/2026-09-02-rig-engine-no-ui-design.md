# RIG: Engine, Not App — Remove the RIG.EXE User-Facing Surface

**Date:** 2026-09-02
**Author:** UX/systems review (per Nate's feedback)
**Status:** Spec — ready to implement. No app code changed by this document.

---

## Summary

RIG.EXE is presented to users as a standalone "Micro-Dyno Container Fleet Runtime" desktop app with a 1067-line HUD (`RigRuntimeView.tsx`). Nate's verdict: **"Rig UI still makes no sense... make it an engine without a UI, e.g. it's infra, not a user-facing app. Remove RIG.EXE as a desktop app; fold its function into the deploy pipeline invisibly."**

That fold has **already happened** everywhere that matters. The real RIG functions are:

- **Deploy build engine** — `src/lib/rig/deployExecutor.ts` (`executeRigDeployBuild`), invoked by `functions/api/deploy.ts:2347`. This is how a forge commit becomes a live app.
- **Merge-verification worker endpoint** — `functions/api/rig-verification.ts` (build claim/complete, evidence bundles, feeds INBOX merge proposals).
- **Live container gateway proxy** — `functions/api/rig.ts` (`/api/rig`), a thin authenticated proxy to a Docker provider gateway. **Already consumed invisibly by SLOPSHOP** (`SlopshopView.tsx` calls `createRigInstance` inside its fork→slop→run loop).
- **Domain/provider libs** — `rigDomain.ts`, `rigBackend.ts`, `rigDockerProvider.ts`, `rig/server.ts`, `rig/stateStore.ts`, `rig/verificationWorker.ts`.

The only thing that is **user-facing and largely a SIMULATION** is `RigRuntimeView.tsx` — its "Offline Manifest Simulator" fabricates lifecycle transitions with `setTimeout`, and its "Live Provider" mode is a manual container-console (paste an OCI digest, launch, fetch logs) that duplicates what the deploy pipeline and SLOPSHOP already do automatically.

**Decision: DELETE the RIG.EXE desktop app, standalone view, Start-menu entry, desktop icon, window registration, and the `rig` route branch. KEEP every backend/engine file — they are load-bearing infra. Keep `rig.nates-software.com` in the router exclusion list (so it never dispatches to a tenant), and repoint the `/rig` route to a tiny "this is now infra" redirect home.**

Net: RIG stops being an app the user opens and becomes what it already is under the hood — the invisible build/run engine behind GITSMITH, the deploy pipeline, and SLOPSHOP.

---

## What is REAL vs SIMULATED

| Concern | File | Real or Sim | Verdict |
|---|---|---|---|
| Deploy build (forge commit → live app) | `src/lib/rig/deployExecutor.ts` | **REAL** — imported by `functions/api/deploy.ts:2347`, `functions/api/serve.ts:5`, `functions/serve/[app]/[[path]].ts:4` | **KEEP** |
| Merge verification worker | `functions/api/rig-verification.ts` | **REAL** — claims `build.verification_requested` outbox events, writes evidence bundle to R2, inserts INBOX proposal | **KEEP** |
| Live container gateway proxy | `functions/api/rig.ts` (`/api/rig`) | **REAL** — proxies to `RIG_GATEWAY_URL` Docker provider; used by SLOPSHOP | **KEEP** |
| Provider / Docker adapter | `src/lib/rigDockerProvider.ts`, `src/lib/rig/server.ts`, `src/lib/rig/stateStore.ts`, `src/lib/rig/verificationWorker.ts` | **REAL** — back the gateway + verification worker | **KEEP** |
| Domain types & validators | `src/lib/rigDomain.ts` | **REAL** — `isValidImageDigest` used by `functions/api/pipeline.ts:7`; `RigSpec` used by `SlopshopView.tsx`; consumed by provider/backend | **KEEP** |
| In-browser control-plane sim | `src/lib/rigBackend.ts` (`RigControlPlane`, port allocator, memory governor) | **SIM** — its *only* runtime consumer is `RigRuntimeView.tsx`. Pure, deterministic, well-tested; but with the HUD gone it has no caller. | **KEEP FILE (do not delete now)** — see Backend section. It is imported only by the HUD and by no test; harmless to leave, but it becomes dead code. Deleting it is optional cleanup, out of scope for the safe UI removal. |
| API client wrappers | `src/lib/rigClient.ts` (`createRigInstance`, `listRigInstances`, …) | **REAL client** — also used by `SlopshopView.tsx:18` (`createRigInstance`) | **KEEP** |
| **The HUD itself** | `src/views/RigRuntimeView.tsx` | **SIM-heavy UI** — `setTimeout`-driven fake lifecycle in simulation mode; manual container console in provider mode | **DELETE** |

**Bottom line:** the engine is real and stays. The app window is the thing to remove.

---

## Inventory — every RIG user-facing registration (keep / delete / relocate)

References are `file:line` at the time of writing.

### DELETE — the desktop app surface

1. **Desktop icon** — `src/App.tsx:632-637`
   ```
   { id: 'rig', label: 'RIG.EXE (Runtime)', icon: '⚙️', onClick: () => { playClickSound(); openWindow('rig'); } }
   ```
   **DELETE** this object from the desktop icon array. Reason: RIG is not an app the user launches.

2. **Floating window mount** — `src/App.tsx:870-889` (the `{/* 4. Rig.exe Runtime HUD */}` `<ErrorBoundary>` + `<RetroWindow>` wrapping `<RigRuntimeView />`).
   **DELETE** the whole block. Reason: no window to render once the app is gone.

3. **Standalone view route render** — `src/App.tsx:349`
   ```
   case 'rig': return renderStandaloneWrapper(route.title || "RIG.EXE", <RigRuntimeView />);
   ```
   **DELETE** this `case`. Reason: `/rig` and `rig.` no longer render a HUD. (See Router/DNS for the replacement redirect.)

4. **`resolveAppRoute` `rig` branch** — `src/App.tsx:55-57`
   ```
   if (hostname.startsWith('rig.') || pathname.startsWith('/rig') || pathname.startsWith('/runtime') || viewQuery === 'rig') {
     return { type: 'standalone_view', id: 'rig', title: 'RIG.EXE MICRO-CONTAINER & STORAGE HUD' };
   }
   ```
   **RELOCATE (rewrite), do not silently delete.** Replace with a branch that resolves `rig`/`/rig`/`/runtime` to a small redirect-home marker so a bookmarked `rig.nates-software.com` doesn't 404 or fall through to the app-tenant resolver. Two safe options:
   - **(Preferred)** Return a new `standalone_view` id like `rig-infra` whose render is a one-line "RIG is now infrastructure — it runs behind the deploy pipeline" note with a "Return to Nate's Software" button (reuse `renderStandaloneWrapper`). Keeps the route inside the reserved-view space so it can never be interpreted as a tenant app id.
   - **(Simpler)** Keep returning `{ type: 'standalone_view', id: 'rig', ... }` but point the `case 'rig'` at a tiny inline redirect component (`window.location.href = 'https://nates-software.com'`). Either way the id must remain in `RESERVED_VIEW_HOSTS`.

   Reason: `rig` must stay reserved (see #7) so it never resolves as a `standalone_app` tenant; but it should no longer open the HUD.

5. **Import of the HUD component** — `src/App.tsx:113`
   ```
   import { RigRuntimeView } from './views/RigRuntimeView';
   ```
   **DELETE** the import once #2 and #3 are removed. (If you keep option 4-simple with an inline redirect, this import is fully unused.)

6. **The HUD file** — `src/views/RigRuntimeView.tsx` (entire 1067-line file).
   **DELETE.** Reason: it is the presentational simulation layer Nate wants gone. Nothing else imports it except `tests/rig-view.test.tsx` (deleted — see Test Impact).

7. **`RESERVED_VIEW_HOSTS` `'rig'`** — `src/App.tsx:11-16`
   ```
   const RESERVED_VIEW_HOSTS = new Set([ 'gitsmith', 'git', 'hotwire', 'slopshop', 'rig', 'inbox', ... ]);
   ```
   **KEEP `'rig'` in the set.** Reason: this is a security-relevant guard — it prevents `rig.nates-software.com` (and `?app=rig`) from ever being treated as a user tenant app and dispatched to R2/containers. Removing it would let someone register an app named `rig`. (Also keep `'rig-provider'` — that's the gateway host, unrelated to the HUD.)

8. **Start-menu entry** — `src/components/StartMenu.tsx:104-110`
   ```
   <div onClick={() => handleItemClick('rig')} ...>
     <Cpu ... /> <span>RIG.EXE (Containers)</span>
   </div>
   ```
   **DELETE** this `<div>`. Also remove the now-unused `Cpu` import from StartMenu **only if** it isn't used elsewhere in that file (grep first).

9. **`useWindowManager` `rig` window config** — `src/hooks/useWindowManager.ts:131-143` (the `rig: { id: 'rig', title: "RIG.EXE — [Ephemeral Runtime & Build HUD]", ... }` entry) plus its sizing constant at line 49 (`const rigConfig = getResponsiveWindowConfig(40, 1060, 640);`).
   **DELETE** both. Reason: windows are a plain `Record<string, WindowState>` and `openWindow`/`focusWindow` take `string`, so there is **no union type to update** and no other refactor needed. After deletion, `windows.rig` no longer exists — which is why App.tsx #2 must be removed in the same change (it references `windows.rig`).

10. **MarketingWindow "RIG.EXE / RUNTIME" card** — `src/views/MarketingWindow.tsx:75-84`
    ```
    { key: 'rig', onOpen: onOpenRig, icon: <Cpu .../>, title: 'RIG.EXE', tag: 'RUNTIME',
      body: 'Runs your app in a sandboxed container. It sleeps when idle...', cta: "See what's running", ... }
    ```
    **DELETE** this card object from the cards array. Reason: it's the "enter this shop" tile for an app that no longer opens. The SLOPSHOP card already tells the honest story: *"...runs your fork for you — the old 'RIG' runtime is part of this now."* (`MarketingWindow.tsx:51`) — **keep that sentence.**

11. **`onOpenRig` prop plumbing** — `MarketingWindow.tsx:10` (interface `onOpenRig: () => void;`), `:23` (destructure), and every call site: `App.tsx:334` (explainer standalone), `App.tsx:764` (desktop mktg window). Also the standalone explainer passes `onOpenRig={goHome}`.
    **RELOCATE decision — KEEP the prop, drop only its usage, OR remove the prop entirely.**
    - **Safest / least churn (recommended):** Keep the `onOpenRig` prop in the interface and keep passing it (`onOpenRig={() => openWindow('rig')}` becomes dead since `openWindow('rig')` no-ops on a missing key — it early-returns `if (!target) return curr;`). But cleaner: keep the prop, pass `onOpenRig={() => {}}` or reuse an existing handler. This keeps `tests/explainer-view.test.tsx` (which passes `onOpenRig={noop}`) compiling unchanged.
    - **Full cleanup:** Remove `onOpenRig` from the interface, the destructure, and all call sites (`App.tsx:334`, `App.tsx:764`, and `tests/explainer-view.test.tsx:22`). This is tidier but touches a test.

    **Recommendation:** keep the prop to minimize blast radius; just remove the card (#10) that consumed it. Revisit prop removal as later cleanup.

### KEEP — engine/infra (do NOT touch)

- `functions/api/rig.ts`, `functions/api/rig-verification.ts` — real endpoints.
- `functions/api/pipeline.ts:7` (`import { isValidImageDigest } from '../../src/lib/rigDomain'`).
- `functions/api/deploy.ts:2347`, `functions/api/serve.ts:5`, `functions/serve/[app]/[[path]].ts:4` — deploy/serve engine imports.
- `src/lib/rig/*`, `src/lib/rigDomain.ts`, `src/lib/rigDockerProvider.ts`, `src/lib/rigClient.ts`.
- `src/views/SlopshopView.tsx` — the **intended** invisible consumer of the RIG gateway. Untouched.
- Router: `EXCLUSION_HOSTNAMES` `rig.nates-software.com` and `rig-provider.nates-software.com` (`workers/router/src/index.ts:77,83`); `RESERVED_ROUTER_SUBDOMAINS` `'rig'`, `'rig-provider'` (`:97-98`). All KEEP.
- `WHITEPAPERS_DATA.rig` white paper (`src/data/whitepapersData.ts`) — this is documentation of the runtime boundary, not the HUD. KEEP (tests depend on it).

---

## Real function to preserve, and where it lives (already relocated)

The genuinely-useful capabilities the HUD gestured at already have real homes — **no new UI surface needs to be built** to satisfy Nate's request:

1. **"Is my app building / deployed?"** — surfaced by the **deploy pipeline** and the **drop's deployment state**. `functions/api/deploy.ts` drives `executeRigDeployBuild`; deployment status is reflected in `deploymentState` on the app listing (rendered in HOTWIRE / the standalone app header, e.g. `App.tsx:218-231` shows `deploymentState` / `activeDeploymentId`). This is the correct place for build/deploy status — not a container HUD.
2. **"Run my fork live"** — surfaced by **SLOPSHOP** (`SlopshopView.tsx`, the "Run" step, real `/api/rig` gateway, honest offline/pending states). This is exactly the invisible fold Nate asked for.
3. **"Merge verified?"** — surfaced by **INBOX** merge proposals, which `rig-verification.ts` populates after a passing build.

**Everything unique to `RigRuntimeView.tsx` (the manifest builder form, the 9-state simulation timeline, OOM/crash/expiry fault-injection buttons, the port-grid HUD) is simulation and has no relocation target — it is deleted, not moved.** If a future need arises to show a maker their live gateway containers, it belongs as a small read-only panel in **ACCOUNT.CFG / My Shelf** or the app's deployment panel — not a standalone "fleet" app. That is out of scope here; the current request is removal.

---

## Router / DNS — `rig.nates-software.com`

**Keep the router exclusion; kill the HUD render.**

- `workers/router/src/index.ts`: **no change.** `rig.nates-software.com` stays in `EXCLUSION_HOSTNAMES` (`:77`) and `'rig'` stays in `RESERVED_ROUTER_SUBDOMAINS` (`:98`). This means the router already refuses to dispatch that host to any tenant origin — it falls through to the Pages app. Removing it would be a security regression (someone could claim `rig`).
- `rig-provider.nates-software.com` (`:83`) is the **gateway host** and must stay excluded regardless. Unrelated to the HUD.
- **App behavior for the excluded host:** because the Pages app receives `rig.nates-software.com` / `/rig`, `resolveAppRoute` must resolve it to the small "RIG is now infra" redirect/notice (Inventory #4), **not** a HUD and **not** a tenant app. Safest UX: redirect to `https://nates-software.com`. This keeps old bookmarks/links from breaking.

No DNS record changes required. No `wrangler.toml` route changes required.

---

## Backend — what stays, what is now dead

**Stays (real deploy/verify/run pipeline — do NOT delete):**
`functions/api/rig.ts`, `functions/api/rig-verification.ts`, `src/lib/rig/deployExecutor.ts`, `src/lib/rig/server.ts`, `src/lib/rig/stateStore.ts`, `src/lib/rig/verificationWorker.ts`, `src/lib/rigDockerProvider.ts`, `src/lib/rigDomain.ts`, `src/lib/rigClient.ts`.

**Becomes dead code after the HUD is deleted (optional later cleanup, NOT part of this safe removal):**
- `src/lib/rigBackend.ts` (`RigControlPlane`, `MicroDynoPortAllocator`, `RigMemoryGovernor`) — its only runtime importer is `RigRuntimeView.tsx`. After the HUD is gone it has no caller and **no test** (grep confirms no `rigBackend` reference in `tests/`). It is safe, pure, and self-contained. **Recommendation: leave it in place for this change** (deleting it expands the diff and risks a missed re-export); file a follow-up to remove it if desired. Do **not** delete it in the same PR as the UI removal unless build/typecheck stays green after.
- Note: `rigClient.ts` is **NOT** dead — `SlopshopView.tsx` imports `createRigInstance` from it. Keep.

**Do NOT delete `rigDomain.ts`** — three real consumers (`pipeline.ts`, `rigDockerProvider.ts`, `rigBackend.ts`, plus `SlopshopView.tsx` and `rigClient.ts` type imports).

---

## Test impact

Grep results and required actions:

1. **`tests/rig-view.test.tsx`** — renders `RigRuntimeView` and asserts HUD copy ("RIG.EXE CONTROL-PLANE PREVIEW", "Runtime Manifest Builder", "No Active RIG Instances", etc.).
   **DELETE this test file** (its subject is deleted).

2. **`tests/e2e-api-route-qa.test.ts:223`** —
   ```
   expect(resolveAppRoute('rig.nates-software.com', '/')).toEqual({ type: 'standalone_view', id: 'rig', title: 'RIG.EXE MICRO-CONTAINER & STORAGE HUD' });
   ```
   **UPDATE** to match the new resolution (either the `rig-infra` notice id/title, or the retained `id: 'rig'` with a new title if you keep option 4-simple). Must stay `standalone_view` (never `standalone_app`).

3. **`tests/explainer-view.test.tsx`** —
   - `:22` passes `onOpenRig={noop}` to `MarketingWindow`. If you keep the `onOpenRig` prop (recommended), **no change**. If you remove the prop, delete this line.
   - `:64` asserts the SLOPSHOP card body still contains `the old &quot;RIG&quot; runtime is part of this now`. **KEEP that copy** (it's on the SLOPSHOP card, which survives) — this assertion should still pass. Verify the test does **not** assert a standalone RIG card renders (it does not, per review).
   - `:111-115` renders `StartMenu` and asserts a "What is this?" entry — unaffected by removing the RIG start-menu row, **unless** the test also asserts the RIG row exists (it does not, per review). Re-run to confirm.

4. **`tests/storage-freedom-surfaces.test.ts`** — asserts on `WHITEPAPERS_DATA.rig` (the white paper), **not** the HUD. **No change.**

5. Other `tests/*` that merely contain the substring "rig" (e.g. commerce, slopshop-pipeline `RIG_TOOLCHAIN_VERSION`, `mockDockerRunner`, `rig-verification` coverage) reference the **engine**, not the HUD. **No change.**

Expected: 1 test file deleted, 1 assertion updated, 0–1 line touched in explainer test (depending on prop decision).

---

## Migration / rollout checklist

Do it in one coherent change so the build never references a half-removed window key:

1. [ ] `src/App.tsx`: delete the desktop-icon object (`:632-637`).
2. [ ] `src/App.tsx`: delete the RIG window block (`:870-889`, the `{/* 4. Rig.exe Runtime HUD */}` ErrorBoundary+RetroWindow).
3. [ ] `src/App.tsx`: rewrite `case 'rig'` (`:349`) to render the "RIG is now infra" redirect/notice (or an inline redirect-home component).
4. [ ] `src/App.tsx`: rewrite the `resolveAppRoute` `rig` branch (`:55-57`) to resolve to the redirect/notice view id; **keep `rig` returning `standalone_view`** so it never becomes a tenant app.
5. [ ] `src/App.tsx`: keep `'rig'` (and `'rig-provider'`) in `RESERVED_VIEW_HOSTS` (`:11-16`) — **no change**.
6. [ ] `src/App.tsx`: remove `import { RigRuntimeView }` (`:113`) if fully unused after steps 2–3.
7. [ ] `src/hooks/useWindowManager.ts`: delete the `rig` window entry (`:131-143`) and the `rigConfig` line (`:49`).
8. [ ] `src/components/StartMenu.tsx`: delete the RIG.EXE row (`:104-110`); drop the `Cpu` import if now unused (grep first).
9. [ ] `src/views/MarketingWindow.tsx`: delete the RIG card object (`:75-84`). Keep the SLOPSHOP card's "the old 'RIG' runtime is part of this now" sentence (`:51`). Decide on `onOpenRig` prop (recommend: keep prop, remove only the card). Drop the `Cpu` import if now unused.
10. [ ] `src/views/RigRuntimeView.tsx`: **delete the file.**
11. [ ] `tests/rig-view.test.tsx`: **delete the file.**
12. [ ] `tests/e2e-api-route-qa.test.ts:223`: update the `rig.nates-software.com` expectation to the new resolution.
13. [ ] `tests/explainer-view.test.tsx`: adjust only if you removed the `onOpenRig` prop; otherwise no change. Confirm the `:64` RIG-in-SLOPSHOP-copy assertion still passes.
14. [ ] Do **NOT** touch: `functions/api/rig.ts`, `functions/api/rig-verification.ts`, `src/lib/rig/*`, `rigDomain.ts`, `rigDockerProvider.ts`, `rigClient.ts`, `SlopshopView.tsx`, `whitepapersData.ts`, `workers/router/*`, `wrangler.toml`.
15. [ ] `npm run build` (typecheck) — must be green. The main risk is a dangling `windows.rig` reference; steps 2 + 7 must land together.
16. [ ] `npm test` — must be green. Expect only the deleted/updated tests from steps 11–13 to move.
17. [ ] Manual smoke: open the desktop — no RIG icon, no RIG in Start menu, no RIG card in the "What is this?" window. Visit `/rig` and `rig.nates-software.com` — redirects home (or shows the infra notice), does not 404, does not open a HUD. SLOPSHOP still shows its RIG-backed "Run" step and `/api/rig` readiness. Deploy a fork end-to-end (or run a deploy test) — build still routes through `executeRigDeployBuild`.

---

## Risk callouts (must NOT break)

1. **`src/lib/rig/deployExecutor.ts` is the live deploy engine.** `functions/api/deploy.ts:2347` imports `executeRigDeployBuild`; `serve.ts` and `serve/[app]/[[path]].ts` import `getMediaType`. Deleting or renaming anything under `src/lib/rig/` breaks real deploys. **Do not touch.**
2. **`functions/api/rig-verification.ts` gates merges.** It claims `build.verification_requested` outbox events, writes the R2 evidence bundle, and inserts the INBOX proposal. Breaking it stalls the entire GITSMITH merge → INBOX approval pipeline. **Do not touch.**
3. **`functions/api/rig.ts` (`/api/rig`) is SLOPSHOP's live-run backend.** `SlopshopView.tsx` calls `createRigInstance` and probes `/api/rig?action=readiness`. Removing the endpoint (or `rigClient.ts`) breaks the SLOPSHOP "Run" step. **Do not touch.**
4. **`rig-provider.nates-software.com` is the gateway tunnel host.** It must remain in the router exclusion (`workers/router/src/index.ts:83`) and reserved subdomains (`:97`). Unrelated to the HUD; **leave it.**
5. **`product-readiness` deploy preflight** (`functions/api/product-readiness?...&deploy=1`) is a real gate the HUD *called* but does **not own**. It also backs the real deploy flow and has its own test (`tests/product-readiness-deploy-preflight.test.ts`). Removing the HUD's call is fine; **do not remove the endpoint.**
6. **`RESERVED_VIEW_HOSTS` / `RESERVED_ROUTER_SUBDOMAINS` must keep `'rig'`.** Dropping it would let a user register an app whose id is `rig`, hijacking `rig.nates-software.com`. Security-relevant — **keep.**
7. **`isValidImageDigest` from `rigDomain.ts`** is imported by `functions/api/pipeline.ts:7`. Do not delete `rigDomain.ts` as "HUD cleanup."
8. **Window-key coupling:** `App.tsx` references `windows.rig`. Delete the App.tsx window block (step 2) and the `useWindowManager` entry (step 7) in the **same** change, or the build breaks on a missing key / dead render.
