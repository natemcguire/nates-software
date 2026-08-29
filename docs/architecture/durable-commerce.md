# Durable Commerce and Lineage Settlement

## Status

Migrations `0009` through `0013` define the canonical replacement for the legacy payment tables. Payment endpoints remain fail-closed unless `PAYMENTS_ENABLED=true`; that flag must not be enabled until checkout, webhook processing, fulfillment, refund/dispute handling, and transfer/reversal-worker proofs all pass against Stripe test mode and isolated preview D1.

## Authority boundaries

- The authenticated session supplies the buyer. Client-provided buyer, maker, ancestor, price, currency, or split data is ignored.
- `commerce_products` supplies the active server price, currency, seller, and price version.
- `repositories` plus immutable `repository_forks` supply purchase-time ancestry.
- Stripe supplies payment state. A webhook is a delivery signal, not unquestioned state authority.
- `STRIPE_LIVEMODE` must explicitly match both the signed event and the re-fetched Stripe object; test/live events can never cross environments.
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
6. A processor claims the inbox event with a finite lease, re-fetches the authoritative Stripe object, rejects out-of-order or regressive transitions, and atomically marks the order paid while issuing exactly one encrypted-at-rest license and creating one outbox row per payable allocation.
7. A worker executes Stripe Connect transfers with the outbox ID as Stripe's idempotency key. Failures remain retryable and observable; webhook code never transfers funds.
8. Fulfillment completes only after the license exists. Payout delays do not revoke a legitimately paid license.

## Refund, dispute, and recovery invariants

- Stripe refund and dispute webhooks are delivery signals. Processing re-fetches the referenced Stripe object and records an append-only observation of the authoritative state.
- Successful partial refunds accumulate against `commerce_orders.refunded_cents`; the order remains fulfilled until the cumulative amount equals the immutable gross amount. A full refund moves the order to `refunded` and the license to `refunded`.
- Refund processing re-fetches both the Refund and its PaymentIntent. The pair must agree on payment, charge, currency, amount bounds, and live/test environment before D1 changes.
- Cumulative allocation uses a house-monotone highest-averages method with deterministic sequence tie-breaking. A later partial refund can never reduce a recipient's already-recorded recovery amount.
- A dispute revokes access while liability is open. A won dispute may restore the fulfilled order and active license; a lost dispute remains revoked and creates recovery obligations. State decisions use the authoritative dispute status, not webhook arrival order.
- Refund allocation rows split each succeeded refund across the original frozen allocations with exact integer-cent conservation. They never alter the sale allocation rows.
- Maker and ancestor debits become immutable recovery obligations. Protocol allocation is accounted for but never sent to Stripe Connect, so it creates no transfer reversal.
- Transfer amounts are immutable. An exact, wholly unsent transfer may be cancelled; partial or in-flight obligations wait for a terminal transfer outcome. A succeeded transfer is recovered with a compensating reversal outbox row.
- Cumulative non-cancelled reversals may never exceed the original transfer. Refund/dispute overlap must reconcile already-recorded recovery before creating another obligation.
- Reversal execution has its own commissioning flag and service credential. Payment and payout enablement do not implicitly authorize clawbacks.

## Non-negotiable constraints

- Event delivery is at-least-once and unordered. Event-ID uniqueness alone is not sufficient.
- PaymentIntent IDs, caller idempotency keys, licenses per order, allocation sequence, and outbox allocation references are unique.
- License keys are stored only as AES-256-GCM ciphertext plus a SHA-256 verification hash and last four characters. Encryption keys are versioned outside D1 so ciphertext can be rotated without changing the license.
- The canonical commerce license is not dual-written into legacy `shelf_items`, whose required plaintext `license_key` column violates this storage boundary. Shelf reads must migrate to the canonical commerce tables before checkout is enabled.
- External calls cannot be rolled back with D1. Each call therefore needs a stable idempotency key and a durable reconciliation state.
- A payout destination account is snapshotted before the first Stripe call and then immutable. Retrying the same idempotency key with changed parameters is forbidden.
- Ambiguous transfer outcomes are retried only inside the provider's safe idempotency window. Afterward they require explicit reconciliation; blindly repeating an expired key can duplicate money movement.
- No caught database or Stripe error may be converted into `{ success: true }`.
- Refund and dispute transitions must be monotonic, audited, and handled before live payments are enabled.

## Legacy tables

`orders`, `transfers_ledger`, `licenses`, `royalty_settlements`, and `processed_webhook_events` remain for compatibility with existing migrations and reads. New payment code must use the `commerce_*` tables and `stripe_event_inbox`; no dual writes are allowed without a separately reviewed migration plan.
