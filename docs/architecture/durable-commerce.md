# Durable Commerce and Lineage Settlement

## Status

Migration `0009_durable_commerce.sql` defines the canonical replacement for the legacy payment tables. Payment endpoints remain fail-closed unless `PAYMENTS_ENABLED=true`; that flag must not be enabled until checkout, webhook processing, fulfillment, and transfer-worker proofs all pass against Stripe test mode and isolated preview D1.

## Authority boundaries

- The authenticated session supplies the buyer. Client-provided buyer, maker, ancestor, price, currency, or split data is ignored.
- `commerce_products` supplies the active server price, currency, seller, and price version.
- `repositories` plus immutable `repository_forks` supply purchase-time ancestry.
- Stripe supplies payment state. A webhook is a delivery signal, not unquestioned state authority.
- D1 is authoritative for order, license, allocation, event-inbox, and outbox workflow state.

## Economic policy

- Fork sale: immediate maker 70%, all upstream ancestors collectively 20%, protocol pool 10%.
- Root sale: maker 90%, protocol pool 10%. A nonexistent ancestor cannot receive money, and the protocol does not absorb the unused lineage share.
- Ancestor shares are equal. Integer-cent remainder is assigned deterministically in ancestry order.
- Every order must satisfy both `sum(basis_points) = 10000` and `sum(amount_cents) = gross_cents` before persistence.
- The complete recipient and repository snapshot becomes immutable with the order.

## State and side-effect ordering

1. Require authentication and a caller-generated `Idempotency-Key`.
2. Load the active product and canonical ancestry entirely on the server.
3. Validate and atomically persist the creating order, immutable allocations, and audit event.
4. Create the Stripe PaymentIntent using the order ID as its idempotency key. Persist its ID and move the order to `requires_payment`; never fabricate a secret or success response.
5. Verify webhook signature and timestamp, persist the raw event inbox record idempotently, then acknowledge receipt.
6. A processor re-fetches the authoritative Stripe object, rejects out-of-order or regressive transitions, and atomically marks the order paid while issuing exactly one hashed license and creating one outbox row per payable allocation.
7. A worker executes Stripe Connect transfers with the outbox ID as Stripe's idempotency key. Failures remain retryable and observable; webhook code never transfers funds.
8. Fulfillment completes only after the license exists. Payout delays do not revoke a legitimately paid license.

## Non-negotiable constraints

- Event delivery is at-least-once and unordered. Event-ID uniqueness alone is not sufficient.
- PaymentIntent IDs, caller idempotency keys, licenses per order, allocation sequence, and outbox allocation references are unique.
- Raw license keys are returned once and never stored; only a SHA-256 hash and last four characters are durable.
- External calls cannot be rolled back with D1. Each call therefore needs a stable idempotency key and a durable reconciliation state.
- No caught database or Stripe error may be converted into `{ success: true }`.
- Refund and dispute transitions must be monotonic, audited, and handled before live payments are enabled.

## Legacy tables

`orders`, `transfers_ledger`, `licenses`, `royalty_settlements`, and `processed_webhook_events` remain for compatibility with existing migrations and reads. New payment code must use the `commerce_*` tables and `stripe_event_inbox`; no dual writes are allowed without a separately reviewed migration plan.
