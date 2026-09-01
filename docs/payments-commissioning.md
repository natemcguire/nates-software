# Payments commissioning

Payments are **commissioned and live in production** (Stripe test mode). This document is the
acceptance record the durable-commerce work required.

## Posture

- The repository ships with `PAYMENTS_ENABLED` **unset** and `PAYOUTS_ENABLED='false'`. That is
  deliberate: the flags are Cloudflare Pages/Worker **secrets**, set on the deployment, never
  committed. A checked-out copy of this repo therefore fails closed (503) on every money endpoint —
  the correct default for a public repo.
- Production has `PAYMENTS_ENABLED='true'` plus the Stripe secret/publishable/webhook keys,
  `STRIPE_LIVEMODE='false'` (test mode), and `LICENSE_ENCRYPTION_KEYS_JSON`. So the buy → own flow is
  actually live; the gate is on, not off.
- `PAYOUTS_ENABLED` remains off until Stripe Connect onboarding is completed for a real seller. The
  entire payout lifecycle (account.updated capability ingestion, transfer outbox, refund/dispute
  recovery, the scheduled drain worker) is built and tested; flipping the flag activates it.

## Acceptance purchase (live, against production)

A full buy → own purchase was executed against the live production build using a Stripe **test** card
(no real money — `livemode: false`):

1. `POST /api/payments/create-intent` (authenticated, idempotency-keyed) → 200 with a server-computed
   authoritative quote and a real Stripe PaymentIntent.
2. The PaymentIntent was confirmed with `pm_card_visa` → Stripe reported `status: succeeded`,
   `livemode: false`, `amount: 1500`.
3. A correctly-signed `payment_intent.succeeded` webhook was delivered → HTTP 202; the event
   processor re-fetched the PaymentIntent from Stripe (a forged webhook cannot fulfill an order).
4. The order transitioned to `fulfilled`, a license was minted (hashed key + last4), its AES-256-GCM
   secret was recorded, and the maker payout was queued to the transfer outbox (pending; payouts off).

The offline, deterministic version of this chain — including the fork → contributor-payout leg — is a
committed regression test at `tests/acceptance-buy-own-fork-payout.test.ts` and runs as part of
`npm test`.

## Enabling live-mode

To take real payments, swap the test keys for live keys on the production deployment
(`STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, a live webhook secret), set `STRIPE_LIVEMODE='true'`,
and — once a seller has completed Connect onboarding — `PAYOUTS_ENABLED='true'` on both the Pages
project and the drain worker. No code change is required.
