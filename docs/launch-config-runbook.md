# Launch-Day Config Runbook

The code for the launch loop is shipped and audited. What remains before/at public
launch is **configuration on Cloudflare and Stripe** — not code. This runbook lists
each item, why it exists, and the exact command to apply it. Nothing here is applied
automatically; run these yourself when you decide to go live.

**Concrete IDs** (nates-software.com):
- Cloudflare **zone id**: `3a1a7fed796a2d4b09b3c4e9ac1cfeea`
- Cloudflare **account id**: `4219a576830c72b0e6e4ca358e61473a`
- Pages **project**: `nates-software`, production **branch**: `main`

Set an API token with the needed scopes once:

```bash
export CF_API_TOKEN='<token with Zone:WAF:Edit + Account Rulesets:Edit>'
export ZONE=3a1a7fed796a2d4b09b3c4e9ac1cfeea
```

---

## 1. NSW-143 — per-IP auth rate limiting at the edge (WAF)

**Status:** the *application* layer is done and live — `functions/api/_throttle.ts`
throttles login (per account), credential-claim (per account, guards the bootstrap
token), and register (per IP, before PBKDF2). This WAF rule is **defense-in-depth**:
it stops abusive volume at Cloudflare's edge before it ever reaches a Worker
invocation, and covers per-IP login spraying that the per-account throttle doesn't.

Cloudflare rate-limiting rules live in the zone's `http_ratelimit` ruleset phase.
Create one rule: **any POST to `/api/auth` — more than 20 requests / 60s from one IP
→ block for 600s.** (20/min is generous for a human; a sprayer trips it fast.)

```bash
# Get (or lazily create) the zone's rate-limit ruleset id:
RULESET=$(curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/$ZONE/rulesets/phases/http_ratelimit/entrypoint" \
  -H "Authorization: Bearer $CF_API_TOKEN" | python3 -c 'import sys,json; print(json.load(sys.stdin)["result"]["id"])' 2>/dev/null)

# Add the auth rate-limit rule (idempotent-ish: re-running appends; delete the old first if re-applying):
curl -s -X POST \
  "https://api.cloudflare.com/client/v4/zones/$ZONE/rulesets/$RULESET/rules" \
  -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" \
  --data '{
    "description": "NSW-143 auth endpoint per-IP rate limit",
    "expression": "(http.request.method eq \"POST\" and starts_with(http.request.uri.path, \"/api/auth\"))",
    "action": "block",
    "ratelimit": {
      "characteristics": ["ip.src", "cf.colo.id"],
      "period": 60,
      "requests_per_period": 20,
      "mitigation_timeout": 600
    }
  }'
```

**Verify:** from one IP, `for i in $(seq 1 25); do curl -s -o /dev/null -w "%{http_code} " -X POST https://nates-software.com/api/auth?action=login -d '{}'; done` — the tail should turn to `429`.

**Rollback:** `DELETE .../rulesets/$RULESET/rules/<rule-id>` (list rules to get the id).

---

## 2. NSW-137 — flip Stripe to live mode + enable payouts

**This already has a full doc: [`payments-commissioning.md`](./payments-commissioning.md).**
Summary of the launch-day flip (see that doc for the why + the acceptance test):

Production currently runs `PAYMENTS_ENABLED='true'` with **test** Stripe keys and
`STRIPE_LIVEMODE='false'`, `PAYOUTS_ENABLED='false'`. Buy→own is live in test mode;
the whole payout lifecycle is built and tested behind the flag. To go live:

```bash
# Set live Stripe secrets on the Pages production deployment (never commit these):
npx wrangler pages secret put STRIPE_SECRET_KEY --project-name nates-software        # sk_live_...
npx wrangler pages secret put STRIPE_PUBLISHABLE_KEY --project-name nates-software    # pk_live_...
npx wrangler pages secret put STRIPE_WEBHOOK_SECRET --project-name nates-software     # whsec_... (live endpoint)
# Flip the mode + payouts flags:
npx wrangler pages secret put STRIPE_LIVEMODE --project-name nates-software           # true
npx wrangler pages secret put PAYOUTS_ENABLED --project-name nates-software           # true (once a seller has completed Connect onboarding)
```

The scheduled drain worker + transfer outbox activate the moment `PAYOUTS_ENABLED='true'`.
**Hard rail:** live Stripe keys are entered by you, never by an agent, never committed.

---

## 3. NSW-133 residual — separate registrable domain for tenant apps

**Status:** the acute vector (untrusted maker HTML/JS/SVG executing as the marketplace
origin) is **closed in code and Grok-verified** — repo-file downgrades executable
types to text/plain, deployed apps carry a locked CSP, and preview iframes are
sandboxed without `allow-same-origin`. The host-only session cookie already keeps the
marketplace token off tenant subdomains. This step is **defense-in-depth**: give
untrusted tenant deployments their own registrable domain so they can never share a
registrable parent with `nates-software.com` cookies at all.

Plan (a decision + DNS, not code):
1. Register a distinct domain, e.g. `nsw-user-content.com` (a *different registrable
   domain*, not a subdomain of nates-software.com — that's the whole point).
2. Add it to Cloudflare, point the wildcard `*.nsw-user-content.com` at the same
   router Worker, and change the router's tenant-serving branch (`origin_kind` =
   `r2_static` / `cf_container`) to emit tenant URLs on the new domain.
3. Keep first-party app-shell hosts (apex, gitsmith, hotwire, slopshop, chat) on
   `nates-software.com`; only untrusted *deployed tenant apps* move.
4. The first-party SSO ticket flow (migration 0037) already structurally excludes
   tenant hosts, so no session ever brokers to the new domain.

Cost: one domain registration (~$10/yr) + it rides the existing Workers plan. No new
per-app DNS/cert ops (one wildcard). This is the only launch item with a real dollar
cost, which is why it's your call.

---

## Order of operations at launch

1. Apply the WAF rule (#1) — safe anytime, no downtime.
2. Register + wire the tenant domain (#3) if/when you want full origin isolation.
3. Flip Stripe live + payouts (#2) — **last**, once a seller has onboarded, so the
   first real sale settles cleanly.

Everything else — the buy→own→fork→publish loop, the money math, auth throttling,
the XSS hardening, mobile — is already live and audited.
