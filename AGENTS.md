# Nate's Software Suite & Autonomous Cloud Dev OS (AGENTS.md)

> **Complete system debrief, architectural specifications, CLI reference, and agent guidelines for Nate's Software Suite.**

---

## 1. Executive Summary & Philosophy

**Nate's Software Suite** is an autonomous Local-First developer operating system, distribution forge, and shareware marketplace designed to dismantle SaaS rental traps and restore software ownership.

### Core Architectural Axioms
1. **Runtime and Storage Freedom:**
   - Applications choose their own runtime, database, persistence layout, hosting model, or no persistence at all.
   - SQLite, WAL, Postgres, browser storage, object storage, and external services are application choices—not platform requirements.
   - Ownership is provided through portable source, artifacts, licenses, documented data export, and fork rights rather than a forced shared database convention.

2. **Perpetual Ownership & License Titles:**
   - Software is bought once and owned forever. Every purchase issues an authentic cryptographic license key (e.g. `NSW-WA-9821-4A8F`) registered on the maker's Local-First shelf.

3. **Autonomous Modding & AST Feature Splicing:**
   - Applications are modular feature packages (canonical refs `refs/features/<name>/<version>`).
   - Users can fork any application into an isolated local worktree using `slop fork`, weld new capabilities via AST transformers in `SLOPSHOP`, test in `RIG.EXE`, and merge upstream.

4. **Lineage Ledger Economics (70 / 20 / 10 Split):**
   - When a downstream fork sells a copy, revenue is settled atomically via the Lineage Ledger:
     - **70%** directly to the immediate Maker.
     - **20%** distributed evenly across the upstream Ancestor chain.
     - **10%** deposited into the Protocol Liquidity Pool.
   - A root app has no ancestor claim. Its unused 20% lineage allocation returns to its maker, producing an explicit **90% maker / 10% protocol** root split.
   - Purchase-time allocation rows are immutable. Stripe webhooks never transfer money directly; they create durable, retryable outbox work.

---

## 2. Application Suite Breakdown

### 1. `HOTWIRE` — 12:01 AM Daily Drops & Shareware Board
* **Purpose:** Curated daily batch drop board where makers submit Shareware apps for daily voting.
* **Key Mechanisms:**
  * Strict 12:01 AM UTC rollover clock with live countdown timer.
  * Atomic, idempotent upvoting with voter deduplication.
  * Live drop submission modal with sound client-side & server-side schema validation.
  * Lineage fork tree visualizer showing parent-child relationships.
* **Backend:** `functions/api/drops.ts`, `functions/api/upvote.ts`, D1 tables `app_listings`, `users`.

### 2. `SLOPSHOP` — AI Speed Shop & AST Feature Splicer
* **Purpose:** Visual welding bay and AST transformation engine for modifying apps with AI.
* **Key Mechanisms:**
  * AST component tree splicing and feature welding without syntax errors.
  * Collision detection for duplicate schema tables, conflicting routes, and duplicate exports.
  * Isolated worktree directory sandboxing (`/tmp/slop-<id>`).
  * Reversible patch generation (forward AST splice & inverse rollback).
* **Backend:** `src/lib/slopshopBackend.ts`, `src/lib/slopshopDomain.ts`.

### 3. `RIG.EXE` — Micro-Dyno Container Fleet Runtime
* **Purpose:** Multi-container fleet supervisor running local micro-dynos in sandboxed ports.
* **Key Mechanisms:**
  * Dynamic port allocation across `3001..3010` with zero port collision.
  * Strict **256MB memory cap** per container with auto-governor throttling.
  * Runtime-agnostic build, health, artifact, and optional volume adapters.
  * Container state machine (`RUNNING`, `REBUILDING`, `STOPPED`, `ERROR`).
* **Backend:** `src/lib/rigBackend.ts`, `src/lib/rigDomain.ts`.

### 4. `GITSMITH` — Bare Git Forge & Atomic CAS Engine
* **Purpose:** Bare Git forge over SSH implementing atomic push verification and lineage royalties.
* **Key Mechanisms:**
  * Atomic Compare-And-Swap (CAS) merge engine: validates `expectedOldSha` against `currentRemoteHeadSha` before moving `refs/heads/*`.
  * Multi-generational lineage ledger settlement engine.
  * SSH / Ed25519 commit signature verification.
* **Backend:** `functions/api/git.ts`, `src/lib/gitsmithBackend.ts`, `src/lib/gitsmithDomain.ts`.

### 5. `INBOX` — 3-Pane Async Mailbox & Merge Proposals
* **Purpose:** Asynchronous developer mailbox for human-to-agent proposals, royalty notices, and discussion.
* **Key Mechanisms:**
  * 3-Pane interface: Mailbox Categories, Thread Stream, Message / Diff Reading Pane.
  * 1-Click **`[ 🚀 APPROVE & MERGE CAS REF ]`** execution.
  * Threaded discussion bridge to dispatch instructions to AI agents.
* **Backend:** `functions/api/inbox.ts`, `functions/api/comments.ts`, D1 table `inbox_messages`.

### 6. `DYNO` — Real-World AI Agent Benchmark
* **Purpose:** Standalone benchmark product measuring how models and agent harnesses complete common real-world tasks—not how marketplace apps perform.
* **Key Mechanisms:**
  * Versioned common-command task suites with controlled fixtures and hidden graders.
  * Model + configuration + agent harness + tools + execution environment identity.
  * Completion, correctness, time, tool calls, tokens, cost, intervention, recovery, and safety measurements.
  * Reproducible and verified run levels backed by trace and grader evidence.
  * Dynamic SVG badge generation endpoint (`/badge/:username`) for GitHub READMEs.
* **Backend:** `src/lib/dynoDomain.ts`, `functions/api/dyno.ts`, `functions/badge/[user].ts`, migration `0007_dyno_real_world_benchmarks.sql`.

### 7. `PROFILE.CFG` & `MY SHELF` — Maker Identity & Title Registry
* **Purpose:** Public maker profiles, SSH key registry, and owned software library.
* **Key Mechanisms:**
  * Maker handle validation (`@nate`) and SSH public key management.
  * "My Shelf" license viewer with downloads and application-defined data export links.
  * Offline binary installer download links (`.dmg`, `.exe`, `.tar.gz`).
* **Backend:** `functions/api/profile.ts`, `functions/api/shelf.ts`, D1 tables `users`, `shelf_items`.

### 8. `WALLART CANVAS PRO` — Flagship 3D Canvas Customizer
* **Purpose:** Professional interactive 3D living room wall art previewer and print production queue.
* **Key Mechanisms:**
  * Custom photo upload with real-time rendering.
  * Solid Walnut, Natural Oak, Matte Black, and Gallery Wrap finishes.
  * Single Frame, 3-Piece Triptych Split, and 4-Grid Layouts.
  * Interactive wall paint color picker.
  * 300 DPI high-resolution TIFF render queue stored in `/data/wallart.sqlite`.
* **Backend:** `src/lib/wallartDomain.ts`, WASM SQLite Engine.

### 9. `TERMINAL.EXE` — Local-First Interactive DOS Shell
* **Purpose:** In-browser DOS/UNIX shell with command history and system utilities.
* **Key Commands:**
  * `status`, `ls /data`, `sqlite3 <path> "<query>"`, `dyno`, `hotwire`, `whoami`, `motd`, `clear`.
  * Desktop wallpaper theme switcher (Teal 95, Matrix Green, Austin Sunset, DOS Navy).

---

## 3. `slop` CLI Reference Manual

The standalone CLI binary is located at `bin/slop` (Node.js executable):

```bash
# General Syntax
$ slop <command> [options]

# 1. Clone an app into an isolated worktree with local SQLite volume
$ slop fork nate/wallart

# 2. Weld an AST feature package into the local project
$ slop mod refs/features/receipt-ocr/v1.2.0

# 3. Run verification proofs and push a CAS ref
$ slop push

# 4. Run the standalone real-world model/agent command benchmark
$ slop dyno --bench

# 5. Execute all automated test assertions
$ slop test

# 6. Check active micro-containers, port bindings, and memory usage
$ slop status

# 7. List daily 12:01 AM drops leaderboard
$ slop list

# 8. Display owned software titles and license keys
$ slop shelf

# 9. Authenticate maker handle and configure SSH keys
$ slop login
```

---

## 4. Cloudflare Edge & Database Infrastructure

* **Primary Domain:** `https://nates-software.pages.dev`
* **Wireframes Domain:** `https://wires.nates-software.pages.dev`
* **Production D1:** `nates-software-prod-v2` (ID: `32dc20dc-b97b-4ea8-a108-45694cdd6e6c`)
* **Preview D1:** `nates-software-preview-db` (ID: `a265f092-cee4-42da-ac84-e87dbbd53315`)
* **Production R2:** `nates-software-storage`
* **Preview R2:** `nates-software-preview-storage`
* **Canonical migrations:** `0001`, `0002`, `0006`, `0007`, `0008`, `0009`, `0010`, `0011` under `migrations/`.
* The retired legacy D1 `nates-software-db` is not an application binding and must not be selected for new work.

### Release invariant

`npm run release` is the only production deployment path. It requires a clean commit, runs all tests and the production build, migrates isolated preview D1, deploys a unique preview candidate, smokes the candidate, applies production migrations, promotes the unchanged `dist/` artifact, smokes the immutable production deployment and alias, and destroys the candidate. Never deploy an untested build directly to `main`.

---

## 5. Development & Verification Commands

```bash
# Install dependencies
npm install

# Run local development server
npm run dev

# Run full Vitest test suite
npm test

# Build production bundle & type-check
npm run build

# Deploy to Cloudflare Pages production
npm run deploy
```

---

## 6. Directory Layout

```
/Volumes/MacMiniExtra/Projects/nates_software/
├── bin/
│   ├── slop                # Official executable SLOP CLI binary
│   └── slop.ts             # TypeScript CLI implementation
├── functions/              # Cloudflare Pages Functions Edge API
│   ├── api/
│   │   ├── comments.ts     # Maker feedback stream
│   │   ├── drops.ts        # HOTWIRE 12:01 AM batch drops
│   │   ├── dyno.ts         # DYNO benchmark sink
│   │   ├── git.ts          # CAS merge & 70/20/10 royalty settlement
│   │   ├── inbox.ts        # 3-Pane inbox & proposals API
│   │   ├── profile.ts      # Maker identity API
│   │   ├── shelf.ts        # License claiming API
│   │   └── upvote.ts       # Idempotent upvoting
│   └── badge/
│       └── [user].ts       # Dynamic SVG shield server
├── migrations/             # D1 SQL Schema Migrations
│   ├── 0001_initial_schema.sql
│   └── 0002_complete_backend.sql
├── src/
│   ├── components/         # Win95 Desktop & Sandbox Components
│   │   ├── ArtifactSandbox.tsx  # Live preview + WASM SQLite Inspector
│   │   ├── DesktopIcon.tsx
│   │   ├── DesktopTaskbar.tsx   # Taskbar with Web Audio sound toggle
│   │   ├── EphemeralLiveApp.tsx # Live app runner with custom upload
│   │   ├── RetroWindow.tsx
│   │   └── StartMenu.tsx
│   ├── hooks/
│   │   └── useWindowManager.ts  # Multi-window state manager
│   ├── lib/                # Domain & Backend Logic
│   │   ├── dynoDomain.ts
│   │   ├── gitsmithBackend.ts
│   │   ├── gitsmithDomain.ts
│   │   ├── hotwireBackend.ts
│   │   ├── hotwireDomain.ts
│   │   ├── inboxDomain.ts
│   │   ├── profileDomain.ts
│   │   ├── rigBackend.ts
│   │   ├── rigDomain.ts
│   │   ├── slopshopBackend.ts
│   │   ├── slopshopDomain.ts
│   │   ├── soundEngine.ts       # Web Audio API sound synthesizer
│   │   ├── wallartDomain.ts
│   │   └── wasmSqlite.ts        # In-browser WASM SQLite engine
│   └── views/              # Full Application Views
│       ├── DynoView.tsx
│       ├── HotwireView.tsx
│       ├── InboxView.tsx
│       ├── MarketingWindow.tsx
│       ├── ProfileView.tsx
│       ├── RigRuntimeView.tsx
│       ├── SlopshopView.tsx
│       ├── TerminalView.tsx
│       └── WhitePapersView.tsx
├── tests/                  # Vitest Test Suites
│   ├── ast-splicer.test.ts
│   ├── dyno-bench.test.ts
│   ├── gitsmith-cas.test.ts
│   ├── hotwire.test.ts
│   ├── inbox.test.ts
│   ├── profile.test.ts
│   ├── royalty-lineage.test.ts
│   ├── sqlite-wal.test.ts
│   └── wallart.test.ts
├── package.json
├── tsconfig.json
└── wrangler.toml
```
