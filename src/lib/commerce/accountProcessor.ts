import { markInboxTerminalFailure, releaseInboxClaim } from './stripeInbox';
import { ProcessEventResult } from './types';

const ACCOUNT_EVENT_TYPES = new Set(['account.updated']);

export function isAccountEventType(eventType: string): boolean {
  return ACCOUNT_EVENT_TYPES.has(eventType);
}

async function failTerminal(db: any, eventId: string, claimToken: string, message: string): Promise<ProcessEventResult> {
  await markInboxTerminalFailure(db, eventId, claimToken, message);
  return { success: false, terminal: true, error: message };
}

async function fetchAuthoritativeAccount(env: any, accountId: string, fetchImpl: typeof fetch): Promise<Response> {
  return fetchImpl(`https://api.stripe.com/v1/accounts/${encodeURIComponent(accountId)}`, {
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` }
  });
}

export async function processAccountInboxEvent(
  db: any,
  env: any,
  inboxRow: any,
  event: any,
  claimToken: string,
  fetchImpl: typeof fetch = globalThis.fetch
): Promise<ProcessEventResult> {
  const eventId = inboxRow.event_id;
  const accountId = event?.data?.object?.id || event?.account || inboxRow.stripe_object_id;
  if (typeof accountId !== 'string' || !accountId.startsWith('acct_')) {
    return failTerminal(db, eventId, claimToken, 'account.updated event does not reference a Stripe Account ID');
  }

  if (!env?.STRIPE_SECRET_KEY) {
    await releaseInboxClaim(db, eventId, claimToken, 'STRIPE_SECRET_KEY is not configured on the server', 30);
    return { success: false, retryable: true, error: 'STRIPE_SECRET_KEY is not configured on the server' };
  }

  let response: Response;
  try {
    response = await fetchAuthoritativeAccount(env, accountId, fetchImpl);
  } catch (error: any) {
    const message = `Network error re-fetching authoritative Stripe Account: ${error.message}`;
    await releaseInboxClaim(db, eventId, claimToken, message, 30);
    return { success: false, retryable: true, error: message };
  }

  if (!response.ok) {
    const payload: any = await response.json().catch(() => ({}));
    const message = `Authoritative Stripe Account fetch failed (${response.status}): ${payload?.error?.message || 'unknown error'}`;
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      return failTerminal(db, eventId, claimToken, message);
    }
    await releaseInboxClaim(db, eventId, claimToken, message, 60);
    return { success: false, retryable: true, error: message };
  }

  const account: any = await response.json();
  if (account.id !== accountId || account.object !== 'account') {
    return failTerminal(db, eventId, claimToken, 'Authoritative Stripe Account identity or object type is invalid');
  }

  const existing: any = await db.prepare(`
    SELECT user_id, stripe_account_id, charges_enabled, payouts_enabled, onboarding_status
    FROM stripe_accounts WHERE stripe_account_id = ?
  `).bind(accountId).first();

  if (!existing) {
    return failTerminal(db, eventId, claimToken, `No local stripe_accounts row matches authoritative account '${accountId}'`);
  }

  const chargesEnabled = Boolean(account.charges_enabled);
  const payoutsEnabled = Boolean(account.payouts_enabled);
  const detailsSubmitted = Boolean(account.details_submitted);

  const currentlyDue = Array.isArray(account.requirements?.currently_due) ? account.requirements.currently_due : [];
  const pastDue = Array.isArray(account.requirements?.past_due) ? account.requirements.past_due : [];
  const disabledReason = account.requirements?.disabled_reason;

  let onboardingStatus: string;
  if (detailsSubmitted && payoutsEnabled) {
    onboardingStatus = 'complete';
  } else if (disabledReason || pastDue.length > 0 || (detailsSubmitted && currentlyDue.length > 0)) {
    onboardingStatus = 'restricted';
  } else {
    onboardingStatus = 'pending';
  }

  const statements: any[] = [
    db.prepare(`
      UPDATE stripe_accounts
      SET charges_enabled = ?,
          payouts_enabled = ?,
          onboarding_status = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE stripe_account_id = ?
    `).bind(chargesEnabled ? 1 : 0, payoutsEnabled ? 1 : 0, onboardingStatus, accountId)
  ];

  try {
    const recentOrder: any = await db.prepare(`
      SELECT id FROM commerce_orders WHERE seller_user_id = ? ORDER BY created_at DESC LIMIT 1
    `).bind(existing.user_id).first();
    if (recentOrder?.id) {
      statements.push(
        db.prepare(`
          INSERT OR IGNORE INTO commerce_order_events (
            id, order_id, event_type, source, source_event_id, details_json, created_at
          ) VALUES (?, ?, 'stripe_account_updated', 'stripe_webhook', ?, ?, datetime('now'))
        `).bind(
          `coe_${crypto.randomUUID().replace(/-/g, '')}`,
          recentOrder.id,
          eventId,
          JSON.stringify({
            stripeAccountId: accountId,
            chargesEnabled,
            payoutsEnabled,
            onboardingStatus,
            detailsSubmitted
          })
        )
      );
    }
  } catch {
  }

  statements.push(
    db.prepare(`
      UPDATE stripe_event_inbox
      SET status = 'processed', processed_at = datetime('now'), last_error = NULL,
          claim_token = NULL, expires_at = NULL
      WHERE event_id = ? AND claim_token = ?
    `).bind(eventId, claimToken)
  );

  try {
    await db.batch(statements);
  } catch (error: any) {
    const message = `Atomic account update failed: ${error.message}`;
    await releaseInboxClaim(db, eventId, claimToken, message, 30);
    return { success: false, retryable: true, error: message };
  }

  return {
    success: true,
    status: onboardingStatus,
    accountId,
    chargesEnabled,
    payoutsEnabled
  } as ProcessEventResult & { accountId: string; chargesEnabled: boolean; payoutsEnabled: boolean };
}
