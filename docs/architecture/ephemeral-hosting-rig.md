# RIG.EXE — Ephemeral Hosting Architecture & Runtime Specification

## 1. Overview & Core Philosophy
The hosted runtime for Nate's Software is built on one inviolable rule: **Scale to zero when idle, wake up in <500ms, and keep the user's data as a single, sovereign SQLite file on disk.**

Unlike bloated multi-tenant SaaS architectures that trap data in opaque cloud databases, **RIG.EXE** runs isolated micro-containers where the application and its database live together on high-speed NVMe block storage.

```
Incoming HTTP Request (https://nate-calc.natesoftware.com)
                          │
                          ▼
            ┌───────────────────────────┐
            │   RIG Edge Proxy (Envoy)  │
            └─────────────┬─────────────┘
                          │
             [Is Dyno Running in Memory?]
                 ├── YES ──► Route HTTP directly (Latency: <2ms)
                 │
                 └── NO ───► [Wake-on-Request Protocol]
                               │
                               ├── 1. Hold TCP connection open
                               ├── 2. Firecracker/MicroVM Resume (~350ms)
                               ├── 3. Mount NVMe SQLite Volume
                               ├── 4. Bind App to localhost:3001
                               └── 5. Forward HTTP request
```

---

## 2. The 4-Tier Ephemeral Architecture

### Tier 1: MicroVM Isolation & Scale-to-Zero Engine
* **Runtime Core:** Firecracker MicroVMs / Linux KVM-based sandboxes.
* **Isolation Boundary:** Dedicated kernel per user dyno. Even if untrusted user code executes `rm -rf /` or runs rogue dependencies, the host system and other users are cryptographically isolated.
* **Auto-Suspend (10-Minute Idle Timeout):**
  * When no HTTP requests are received for 10 minutes, the dyno receives a `SIGUSR1` memory freeze signal, writes its memory page state to NVMe swap, and releases CPU/RAM cores.
  * Idle cost to the platform: **$0.00 / hour** (only NVMe storage fee).

### Tier 2: SQLite Single-File Persistence & Zero-Lag WAL Mode
* **Local Volume Mount:** Each fork mounts an isolated block volume at `/data`.
* **Database File:** `/data/app.sqlite`.
* **WAL Mode (Write-Ahead Logging):** Configured with `PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;`.
* **Continuous Streaming Replication (Litestream to Cloudflare R2 / S3):**
  * A background sidecar process replicates SQLite WAL frame chunks every 1 second to encrypted object storage.
  * If a physical worker node crashes, the entire dyno and database restore on a new node in <2.5 seconds with zero data loss.
* **1-Click Data Portability:**
  * Endpoint `GET /api/system/export-db` streams the live, un-locked `.sqlite` file directly to the user's local disk.

### Tier 3: Ephemeral Preview Sandboxes (Clone-on-Write)
Whenever a merge proposal is submitted in `INBOX.EXE` or a feature is welded in `SLOPSHOP`:
1. `RIG.EXE` takes an instantaneous **Copy-on-Write (CoW)** snapshot of the parent repository and `/data/app.sqlite`.
2. A temporary ephemeral preview dyno is provisioned at `https://preview-[job-id].natesoftware.dev`.
3. The reviewer or AI agent can click through the live web app, verify SQLite migrations, and test UI changes without touching the production database.
4. Preview dynos auto-terminate after 60 minutes or upon CAS merge execution.

### Tier 4: Crash Recovery & OOM State Machine (Exit 137)
* **Memory Capping:** Default 256MB RAM per micro-dyno (configurable up to 2GB).
* **Automated Triage:** If a fork hits an Out-Of-Memory error (Linux Exit 137):
  1. The proxy catches the failure and serves a friendly Win95 crash recovery modal.
  2. The SQLite database is safely checkpointed to prevent file corruption.
  3. A diagnostic notification with stack trace is dispatched to the user's `INBOX.EXE`.
  4. A 1-click **"Fix with AI Agent"** deep-link passes the crash log directly to Claude / Codex.

---

## 3. The Nate's Software Standard App Contract

Every app published on the marketplace adheres to a dead-simple, 3-variable environment contract:

| Environment Variable | Default Value | Description |
|---|---|---|
| `PORT` | `3001` | HTTP port the application web server must listen on. |
| `DATABASE_PATH` | `/data/app.sqlite` | Absolute path to the persistent SQLite database file. |
| `NODE_ENV` / `ENV` | `production` | Environment flag for asset minification & logging. |

---

## 4. Why This Architecture Beats Traditional Cloud

| Feature | Legacy PaaS (Heroku / Render) | Serverless (Vercel / AWS Lambda) | **Nate's Software (RIG.EXE)** |
|---|---|---|---|
| **Data Ownership** | Trapped in Postgres add-on ($25/mo) | Ephemeral / Multi-tenant DB required | **Single `.sqlite` file you own & download** |
| **Idle Cost** | $7–$25/mo per idle app | High cold-start DB connection latency | **$0.00 idle (Scale-to-zero MicroVM)** |
| **Cold Boot** | 10–30 seconds | 1–3 seconds | **~350ms (Snapshotted MicroVM)** |
| **Moddability** | Locked vendor configuration | Locked edge runtime limits | **Full Git clone + Local Docker + Native .dmg** |
| **Merge Previews** | Expensive branch rebuilds | Stateless edge previews | **Clone-on-Write with isolated SQLite copy** |
