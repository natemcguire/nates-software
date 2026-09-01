# Nate's Software

A marketplace for software you buy once and own — not rent. Every purchase issues a real license
key tied to your account. The source comes with it: you can fork any app, change it (with an AI
agent in the loop if you want), and sell your version. When a fork sells, the revenue splits back
down the lineage automatically.

The whole thing is presented as a Windows-95-style desktop in the browser. That's a deliberate
choice, not a gimmick — it makes a pile of separate tools (a forge, a runtime, a mailbox, a
benchmark) feel like one machine you own.

Live at [nates-software.com](https://nates-software.com).

## The idea worth explaining

Most software is rented. You pay monthly, the vendor owns the data and the runtime, and the day you
stop paying you have nothing. This flips that:

- **Buy once, own forever.** A purchase mints a cryptographic license (`NSW-…`) on your shelf. The
  key is hashed at rest; the secret is encrypted with AES-256-GCM. You also get the source.
- **Fork and resell.** Any app with published source can be forked into your own namespace, modified,
  and relisted. Forking is free.
- **Lineage royalties.** When a downstream fork sells, the money splits **70% to the seller, 20%
  across the ancestor chain, 10% to a protocol pool**. A root app has no ancestors, so its 20%
  returns to the maker — a **90/10** split. Allocations are computed server-side from the
  authoritative price and lineage graph, written as immutable rows at purchase time, and settled
  from a durable outbox. The client never proposes a price or a split.

## How a purchase actually works

The buy → own path runs end-to-end against Stripe:

1. `POST /api/payments/create-intent` (authenticated, idempotency-keyed) reads the authoritative
   product and lineage from D1, computes the allocation split, writes the order and its immutable
   allocation rows, then creates a Stripe PaymentIntent. Client-supplied prices and splits are
   ignored by construction.
2. The buyer confirms payment with the Stripe Payment Element (cards and wallets; no redirect
   methods, so the in-page modal always completes).
3. Stripe's webhook is verified by HMAC signature, recorded to an idempotent event inbox, and
   processed out of band. The processor **re-fetches the PaymentIntent from Stripe** as the source
   of truth — a forged webhook can't fulfill an order.
4. On a genuine `succeeded`, the order transitions to `fulfilled` exactly once (monotonic, versioned),
   a license and its encrypted secret are minted, and payout work is queued to the transfer outbox.

Payouts to sellers (Stripe Connect transfers) are gated behind a separate flag and drained
separately. Everything up to and including license issuance is live.

## The apps

Each is a window on the desktop and, in most cases, a standalone subdomain.

- **HOTWIRE** — a daily 12:01 AM UTC drop board. Makers submit apps; people vote. Idempotent,
  deduplicated upvoting.
- **GITSMITH** — a bare Git forge over SSH. Atomic compare-and-swap ref updates, Ed25519 key auth,
  fast-forward-only merges (a divergent merge fails closed rather than silently repointing a branch).
- **SLOPSHOP** — the fork-and-modify workspace: clone an app, change it with an AI agent in a
  terminal, push back through GITSMITH. (Being unified with the runtime; see status.)
- **INBOX** — a three-pane mailbox for merge proposals. Approval is gated: you can't approve until
  the diff and evidence have loaded, the exact commit OIDs are shown, and you acknowledge them. The
  server re-checks the OIDs at approval time to close the window between review and merge.
- **DYNO** — a benchmark for how models and agent harnesses do on real tasks. Runs are self-reported
  until an independent verifier reproduces them; the UI says which state a run is in and never claims
  a verification that didn't happen.
- **PROFILE / MY SHELF** — your identity, SSH keys, owned licenses, earnings, and payout ledger.
- **TERMINAL** — an in-browser shell. Local mode is a labeled command emulator; a real ephemeral
  sandbox runs through an authenticated gateway.
- **CHAT** — a live room with real presence and identity.

## Architecture

The front door is a single wildcard router.

- **Ingress.** One wildcard DNS record (`*.nates-software.com`) and one Cloudflare Worker on the
  wildcard route. It reads the subdomain, resolves the origin from D1 (cached in KV), and dispatches:
  static bytes from R2, a per-app Worker, a scale-to-zero container, or a warm origin. Adding an app
  is a database row — no per-app DNS or certificates.
- **Control plane.** Cloudflare Pages Functions over D1 (SQLite at the edge) and R2. Money, licenses,
  the forge control plane, and the deploy orchestrator live here.
- **Build and run.** A pushed repo builds with Cloud Native Buildpacks in AWS CodeBuild (no
  Dockerfile for the common case) to an image in ECR. Static sites serve from R2; containers run on
  Cloudflare Containers (scale-to-zero, ~0 idle cost); the paid tier runs warm on AWS Fargate.
  Postgres, when an app needs it, is Aurora Serverless v2 fronted by Hyperdrive.
- **Credentials.** Workers have no OIDC issuer, so AWS access is scoped long-lived keys stored as
  Cloudflare secrets with least-privilege IAM — stated plainly rather than dressed up as something
  it isn't.

There is no shared application database convention imposed on apps. Runtime and storage are the
app's choice; ownership is delivered through portable source, artifacts, licenses, and documented
export.

## Development

```bash
npm install
npm run dev       # local dev server
npm test          # Vitest suite
npm run build     # production build + type-check
npm run release   # the only path to production (see below)
```

`npm run release` is the sole production deploy path. It refuses a dirty tree, runs the tests and
build, migrates an isolated preview database, deploys a candidate, smoke-tests it, applies
production migrations, promotes the *same* artifact, smoke-tests production and its alias, then
destroys the candidate. An untested build never reaches production.

## The `slop` CLI

```bash
slop fork nate/wallart     # fork an app into a local worktree
slop mod refs/features/…   # weld an AST feature package in
slop push                  # verify and push a compare-and-swap ref
slop shelf                 # your owned titles and license keys
slop dyno --bench          # run the benchmark
```

## Status

This is under active development and the codebase is honest about it. The buy → own → fork loop
works end-to-end; seller payouts are implemented but gated off pending Connect onboarding; the
SLOPSHOP/runtime unification and several first-run polish items are in progress. Where a feature
depends on infrastructure that isn't provisioned, the app fails closed and says so rather than
faking success.

## License

Proprietary. © Nate McGuire.
