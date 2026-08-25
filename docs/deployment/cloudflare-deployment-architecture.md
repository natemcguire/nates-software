# Nate's Software — Cloudflare Deployment Architecture

## 1. Executive Summary: Can It Be Done Mostly on Cloudflare?
**YES. Virtually the entire platform can run on Cloudflare with zero server management, sub-50ms global latency, and near-zero idle infrastructure cost.**

Because Nate's Software is fundamentally built on **unbundled micro-tools, real Git repositories, and single-file SQLite databases**, Cloudflare's edge primitives (Workers, Pages, D1, R2, KV, and Durable Objects) are an ideal architectural fit.

---

## 2. Cloudflare Service Mapping

```
                                  USER BROWSER / DESKTOP
                                            │
                                            ▼
                    ┌───────────────────────────────────────────────┐
                    │      Cloudflare Edge DNS & SSL Anycast        │
                    └───────────────────────┬───────────────────────┘
                                            │
               ┌────────────────────────────┼────────────────────────────┐
               │                            │                            │
               ▼                            ▼                            ▼
   ┌───────────────────────┐    ┌───────────────────────┐    ┌───────────────────────┐
   │   Cloudflare Pages    │    │  Cloudflare Workers   │    │     Cloudflare R2     │
   │  (React 19 + Win95)   │    │  (Hono REST API / WS) │    │  (Zero Egress Storage)│
   │   Global Edge CDN     │    │   Auth & Orchestrator │    │  .dmg, .exe, .sqlite  │
   └───────────────────────┘    └───────────┬───────────┘    └───────────────────────┘
                                            │
                  ┌─────────────────────────┼─────────────────────────┐
                  ▼                         ▼                         ▼
      ┌───────────────────────┐ ┌───────────────────────┐ ┌───────────────────────┐
      │     Cloudflare D1     │ │     Cloudflare KV     │ │   Durable Objects     │
      │  (Serverless SQLite)  │ │   (Daily Drops Cache) │ │  (Live Merge Queue &  │
      │  Marketplace & Lineage│ │  12:01 AM Leaderboard │ │   INBOX WebSockets)   │
      └───────────────────────┘ └───────────────────────┘ └───────────────────────┘
```

| Platform Layer | Cloudflare Technology | Why It Fits Nate's Software |
|---|---|---|
| **Front-End SPA** | **Cloudflare Pages** | Zero cold-start, instant global edge deployment for our React 19 / Vite application. |
| **Marketplace API** | **Cloudflare Workers** (Hono) | Sub-5ms execution time, edge routing, Turnstile bot protection, Stripe webhook handlers. |
| **Marketplace Database** | **Cloudflare D1** (Edge SQLite) | Serverless SQLite at the edge. Native SQL queries for apps, tags, lineage trees, and rev-share splits. |
| **Binary & Backup Storage** | **Cloudflare R2** | Zero egress bandwidth fees for serving 20MB macOS `.dmg`, Windows `.exe`, and user `.sqlite` backups. |
| **Daily Drops Caching** | **Cloudflare KV** | Sub-millisecond reads for the 12:01 AM HOTWIRE leaderboard and top maker rankings. |
| **Realtime Merge Queue** | **Cloudflare Durable Objects** | Strong consistency and persistent WebSocket connections for live 41s merge queue telemetry and INBOX updates. |
| **Ephemeral Container Dynos** | **Cloudflare Workers / WebContainers** | Client-side WASM SQLite for instant sandbox testing; Workers API dispatching to Fly.io Machines / Hetzner for heavy Linux microVMs. |

---

## 3. Step-by-Step Deployment Guide

### Step 1: Initialize Cloudflare Resources (D1, R2, KV)
Run via Wrangler CLI:
```bash
# Create D1 Serverless SQLite Database
npx wrangler d1 create nates-software-d1

# Create R2 Bucket for Native Binaries (.dmg, .exe, .AppImage)
npx wrangler r2 bucket create nates-software-binaries

# Create KV Namespace for Daily Drops Leaderboard
npx wrangler kv namespace create DROPS_KV
```

### Step 2: Configure `wrangler.toml`
The configuration file is located at `apps/web/wrangler.toml`:
```toml
name = "nates-software"
compatibility_date = "2026-08-25"
pages_build_output_dir = "dist"

[[d1_databases]]
binding = "DB"
database_name = "nates-software-d1"
database_id = "<YOUR_D1_DATABASE_ID>"

[[r2_buckets]]
binding = "BINARIES"
bucket_name = "nates-software-binaries"

[[kv_namespaces]]
binding = "DROPS_KV"
id = "<YOUR_KV_NAMESPACE_ID>"
```

### Step 3: Build & Deploy Front-End to Cloudflare Pages
```bash
cd apps/web
npm run build
npx wrangler pages deploy dist --project-name=nates-software
```

---

## 4. Operational Cost Breakdown on Cloudflare

* **Cloudflare Pages:** Free (Unlimited requests & bandwidth).
* **Cloudflare Workers (Standard):** Free tier includes 100,000 requests/day ($5/mo for 10M requests).
* **Cloudflare D1:** Free tier includes 5M reads / 100k writes per day.
* **Cloudflare R2:** $0.015 / GB storage, **$0.00 egress bandwidth fees** (saving hundreds compared to AWS S3).
* **Total Estimated Hosting Cost for MVP:** **~$5.00 / month**.
