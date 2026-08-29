# Durable Commerce and Lineage Settlement

## Status

Migrations `0009_durable_commerce.sql` and `0010_commerce_processing.sql` define the canonical replacement for the legacy payment tables. Payment endpoints remain fail-closed unless `PAYMENTS_ENABLED=true`; that flag must not be enabled until checkout, webhook processing, fulfillment, refund/dispute handling, and transfer/reversal-worker proofs all pass against Stripe test mode and isolated preview D1.

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
