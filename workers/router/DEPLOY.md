# Cloudflare Router Worker — Production Deployment & Cutover Runbook

This document defines the **authoritative, staged cutover procedure** for deploying the `nates-software-router` Worker as the wildcard front-door for `*.nates-software.com`.

> [!CRITICAL]
> **Safety Invariant:** A wildcard Workers route intercepts every proxied hostname in the zone. To prevent taking down production, you MUST create the **13 exclusion routes (mapped to No Worker)** BEFORE creating the wildcard route.
>
> **Do NOT run `wrangler deploy` against production directly until ready for Stage 2 canary testing.**

---

## 0. Production Environment Reference

| Property | Production Target |
|---|---|
| **Zone Name** | `nates-software.com` |
| **Zone ID** | `3a1a7fed796a2d4b09b3c4e9ac1cfeea` |
| **D1 Database** | `nates-software-prod-v2` (`32dc20dc-b97b-4ea8-a108-45694cdd6e6c`) |
| **R2 Storage** | `nates-software-storage` |
| **KV Namespace** | `HOST_CACHE` (`a99be7ce7e6d42639088dd57bc5ec0b7`) |
| **Worker Name** | `nates-software-router` |

---

## 1. Pre-Flight: Database Migration & Initial Worker Upload

### 1.1 Apply Migration 0025 to Production D1
Run the migration to add `origin_kind`, `origin_ref`, and `hostname` columns to `app_listings`:

```bash
npx wrangler d1 execute nates-software-prod-v2 --remote --file=./migrations/0025_app_origin_kind.sql
```

Verify the schema update:
```bash
npx wrangler d1 execute nates-software-prod-v2 --remote --command="SELECT id, hostname, origin_kind FROM app_listings LIMIT 5;"
```

### 1.2 Ensure KV Namespace Exists
If not already created, provision the KV namespace for host lookup caching:
```bash
npx wrangler kv namespace create HOST_CACHE
```
Ensure the resulting namespace ID is set under `[[kv_namespaces]]` in `workers/router/wrangler.toml`.

### 1.3 Deploy Router Worker Script (No Routes Attached Yet)
Upload the Worker code to Cloudflare without attaching any zone routes:
```bash
cd workers/router
npx wrangler deploy
cd ../..
```

---

## 2. Stage 1: Create Route Exclusions for All 13 Proxied Hostnames

Cloudflare uses the **most-specific route match**. Creating explicit routes mapped to **(None / No Worker / disabled)** ensures the router Worker is never invoked for these hostnames.

### The 13 Authoritative Proxied Hostnames
1. `nates-software.com/*` (apex — Pages app)
2. `www.nates-software.com/*` (Pages app)
3. `chat.nates-software.com/*` (Pages app view)
4. `git.nates-software.com/*` (Pages app view)
5. `gitsmith.nates-software.com/*` (Pages app view)
6. `hotwire.nates-software.com/*` (Pages app view)
7. `rig.nates-software.com/*` (Pages app view)
8. `slopshop.nates-software.com/*` (Pages app view)
9. `dronehunter.nates-software.com/*` (standalone Pages project)
10. `certified-mailer.nates-software.com/*` (standalone Pages project)
11. `picfitai.nates-software.com/*` (standalone Pages project)
12. `american-gardener.nates-software.com/*` (standalone Pages project)
13. `rig-provider.nates-software.com/*` (cloudflared TUNNEL — load-bearing for builds)

### 2.1 Create Exclusion Routes via Cloudflare Dashboard or API
In **Cloudflare Dashboard** -> **nates-software.com** -> **Workers Routes**:
For each of the 13 host patterns listed above:
- Click **Add Route**
- **Route:** `<hostname>/*`
- **Worker / Service:** `None` (or leave unassigned / bypass)

Via Cloudflare API (Zone ID `3a1a7fed796a2d4b09b3c4e9ac1cfeea`):
```bash
# Example API call for each host pattern (script = null)
curl -X POST "https://api.cloudflare.com/client/v4/zones/3a1a7fed796a2d4b09b3c4e9ac1cfeea/workers/routes" \
     -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"pattern":"nates-software.com/*","script":null}'
```

*(Repeat for all 13 patterns. Verify that all 13 exclusion routes are visible in the zone settings before continuing.)*

---

## 3. Stage 2: Deploy on Canary Route & Prove D1 + R2 Resolution

Before enabling wildcard routing, verify the router end-to-end using a dedicated canary hostname.

### 3.1 Create Canary DNS Record
In Cloudflare DNS for `nates-software.com`:
- **Type:** `CNAME`
- **Name:** `router-canary`
- **Target:** `nates-software.com`
- **Proxy status:** Proxied (Orange Cloud)

### 3.2 Add Canary Worker Route
In Cloudflare Workers Routes:
- **Route:** `router-canary.nates-software.com/*`
- **Worker / Service:** `nates-software-router`

### 3.3 Validate Canary Probes
Run the following curl commands to verify D1 and R2 functionality:

```bash
# 1. Health & Canary Status Probe
curl -i https://router-canary.nates-software.com/
# Expected: 200 OK with {"success": true, "service": "nates-software-router", "canary": true}

# 2. D1 Lookup Probe (Draft / Unbuilt App)
curl -i "https://router-canary.nates-software.com/?app=american-gardener"
# Expected: 503 Service Unavailable with {"success": false, "error": "App 'american-gardener' does not have an active verified deployment..."}

# 3. D1 Lookup Probe (Non-existent App)
curl -i "https://router-canary.nates-software.com/?app=nonexistent-app-xyz"
# Expected: 404 Not Found with {"success": false, "error": "App 'nonexistent-app-xyz' not found"}

# 4. In-Worker Defense-in-Depth Allowlist Check
curl -i -H "Host: nates-software.com" https://router-canary.nates-software.com/
# Expected: Passthrough to apex Pages app
```

---

## 4. Stage 3: Wildcard DNS & Wildcard Worker Route (Production Cutover)

Only proceed after **Stage 1 (13 exclusions)** and **Stage 2 (canary verification)** have passed completely.

### 4.1 Add Wildcard DNS Record
In Cloudflare DNS for `nates-software.com`:
- **Type:** `CNAME`
- **Name:** `*`
- **Target:** `nates-software.com`
- **Proxy status:** Proxied (Orange Cloud)

### 4.2 Add Wildcard Worker Route
In Cloudflare Workers Routes for `nates-software.com`:
- **Route:** `*.nates-software.com/*`
- **Worker / Service:** `nates-software-router`

### 4.3 Post-Cutover Verification Checklist
Verify that all existing production services continue running without interruption:

```bash
# Check Apex & Core Pages App Views
curl -I https://nates-software.com/
curl -I https://www.nates-software.com/
curl -I https://chat.nates-software.com/
curl -I https://gitsmith.nates-software.com/
curl -I https://hotwire.nates-software.com/
curl -I https://slopshop.nates-software.com/
curl -I https://rig.nates-software.com/

# Check Standalone Pages Projects
curl -I https://dronehunter.nates-software.com/
curl -I https://certified-mailer.nates-software.com/
curl -I https://picfitai.nates-software.com/
curl -I https://american-gardener.nates-software.com/

# Check Rig Tunnel
curl -I https://rig-provider.nates-software.com/

# Check Dynamic Wildcard Resolution
curl -i https://random-unknown-subdomain-123.nates-software.com/
# Expected: 404 JSON {"success": false, "error": "App 'random-unknown-subdomain-123' not found"}
```

---

## 5. Rollback Procedure

If any unexpected behavior occurs after wildcard route cutover:

1. **Delete Wildcard Worker Route:**
   In Cloudflare Dashboard -> **nates-software.com** -> **Workers Routes**, delete or disable the route `*.nates-software.com/*`.
2. **Delete Wildcard DNS Record (Optional):**
   In Cloudflare DNS, remove the `*` CNAME record.
3. **Confirm Recovery:**
   All 13 excluded hostnames remain on their native Pages / tunnel configurations and will continue operating normally.
