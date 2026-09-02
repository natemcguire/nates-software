# First-party cross-subdomain SSO — design (task #38)

**Date:** 2026-09-02 · **Status:** implemented + deployed

## Problem

Login does not persist across Nate's Software subdomains. Logging in on
`nates-software.com` does not carry to `gitsmith.nates-software.com`, because the
session cookie is deliberately **host-only** (no `Domain=`). That host-only choice
is a hard security rail: the platform serves **untrusted tenant apps** at
`<app>.nates-software.com` (dronehunter, certified-mailer, …) whose bytes the
maker controls and the router proxies to attacker-controlled origins. A
`Domain=.nates-software.com` cookie would be sent by the browser to those tenant
origins → **account takeover**.

**Goal:** share login across the TRUSTED first-party view hosts (apex, gitsmith,
git, hotwire, slopshop, rig, chat) **without** ever exposing the session token to
a tenant app host.

## Non-goal / hard rail

Tenant app hosts must NEVER obtain a ticket, a session, or a redirect target. The
session token must never appear in a URL or a cross-origin body.

## Approach — apex-brokered single-use SSO ticket

Rejected: a shared `Domain=` cookie (reintroduces the exfiltration vector) and a
localStorage/postMessage bearer (token lands in JS-readable storage). Chosen: an
OAuth-style broker flow, mirroring the proven in-repo `terminal_session_tickets`
single-use redemption pattern.

1. A first-party VIEW host loads logged-out → the client bounces **once per tab**
   to `https://nates-software.com/api/sso?action=authorize&return_to=<host>`.
2. `authorize` (runs on the apex, holds the canonical session cookie):
   validates an apex session exists; validates `return_to` is a first-party host
   via the server allowlist (rejects tenant hosts → `forbidden_return`); mints a
   single-use, 60 s ticket bound to `(user, return_host)`; 302 → the host's
   `callback`.
3. `callback` (runs on the destination host): re-checks THIS host is first-party;
   atomically redeems the ticket (conditional `UPDATE … WHERE redeemed_at IS NULL
   AND return_host = ? AND expires_at > ?`, guarded on `meta.changes === 1`);
   issues a **new host-only** session cookie for THIS host, same user; 302 → `/`.

## Why the boundary holds

- The real session token never leaves the server-side exchange — only an opaque,
  single-use, 60 s ticket crosses an origin boundary, and it is redeemable only at
  the exact allowlisted host it was minted for.
- The trust set is a **server-side allowlist** (`functions/api/_firstParty.ts`),
  deliberately **narrower** than the router's `EXCLUSION_HOSTNAMES` (which also
  contains tenant app hosts). Tenant hosts are structurally excluded at both
  `authorize` (won't mint) and `callback` (won't redeem/run).
- Host normalization strips trailing dots + lowercases before every comparison
  (blocks the `dronehunter.nates-software.com.` / case bypasses).
- Every issued cookie stays host-only + HttpOnly — the original invariant is
  never weakened.

## Files

- `migrations/0037_first_party_sso_tickets.sql` — `sso_tickets` table.
- `functions/api/_firstParty.ts` — the single-source allowlist + `normalizeHost`.
- `functions/api/sso.ts` — `authorize` + `callback` broker endpoint.
- `src/lib/firstPartySSO.ts` — client trigger (once-per-tab, first-party only).
- `src/context/AuthContext.tsx` — calls the trigger when `me` resolves to guest.
- `tests/first-party-sso.test.ts` — 30 tests locking the trust boundary
  (tenant rejection, bypass attempts, single-use, once-per-tab, list sync).

## Failure posture

SSO is a convenience layer: every failure (ledger down, no apex session, bad
ticket) **fails soft** to `/?sso=<reason>` — never a 500, never a loop — and the
user can still log in normally on the host.
