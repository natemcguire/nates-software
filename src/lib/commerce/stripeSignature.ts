// Stripe Webhook v1 HMAC-SHA256 Signature Verification
// Enforces mandatory secret, 5-minute replay tolerance, constant-time comparison,
// and malformed header rejection.

import { StripeSignatureResult, StripeVerificationError } from './types';

/**
 * Constant-time string equality check to prevent timing attacks.
 * Compares bytes using bitwise XOR accumulation over equal length.
 */
export function constantTimeCompare(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

/**
 * Computes Stripe v1 HMAC-SHA256 signature for a timestamped payload using Web Crypto.
 */
export async function computeStripeSignature(
  payload: string,
  timestamp: number,
  secret: string
): Promise<string> {
  const signedPayload = `${timestamp}.${payload}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const sigBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload));
  return Array.from(new Uint8Array(sigBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Generates a full `stripe-signature` header value for tests or mock delivery.
 */
export async function generateStripeSignatureHeader(
  payload: string,
  secret: string,
  timestampSec?: number
): Promise<{ header: string; timestamp: number; signature: string }> {
  const timestamp = timestampSec ?? Math.floor(Date.now() / 1000);
  const signature = await computeStripeSignature(payload, timestamp, secret);
  return {
    header: `t=${timestamp},v1=${signature}`,
    timestamp,
    signature
  };
}

/**
 * Verifies a raw-body Stripe webhook request against its `stripe-signature` header.
 *
 * Rules:
 * 1. Webhook secret is mandatory (non-empty).
 * 2. Header must contain valid integer timestamp `t=` and at least one `v1=` signature.
 * 3. Enforces 5-minute (300 seconds) tolerance window from current time.
 * 4. Verifies HMAC-SHA256 signature using constant-time comparison.
 */
export async function verifyStripeSignature(
  rawBody: string,
  sigHeader: string | null | undefined,
  secret: string | null | undefined,
  options?: { toleranceSec?: number; currentTimestampSec?: number }
): Promise<StripeSignatureResult> {
  if (!secret || typeof secret !== 'string' || !secret.trim()) {
    throw new StripeVerificationError('STRIPE_WEBHOOK_SECRET must be configured', 500);
  }

  if (!sigHeader || typeof sigHeader !== 'string' || !sigHeader.trim()) {
    return { valid: false, reason: 'Missing or empty stripe-signature header' };
  }

  const parts = sigHeader.split(',');
  let timestampStr = '';
  const signatures: string[] = [];

  for (const part of parts) {
    const trimmed = part.trim();
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();

    if (key === 't') {
      timestampStr = value;
    } else if (key === 'v1' && value) {
      signatures.push(value);
    }
  }

  if (!timestampStr || signatures.length === 0) {
    return { valid: false, reason: 'Malformed stripe-signature header: missing timestamp or v1 signature' };
  }

  const timestamp = parseInt(timestampStr, 10);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
    return { valid: false, reason: 'Malformed stripe-signature timestamp' };
  }

  // 5-minute replay tolerance
  const toleranceSec = options?.toleranceSec ?? 300;
  const nowSec = options?.currentTimestampSec ?? Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - timestamp) > toleranceSec) {
    return { valid: false, reason: 'Webhook signature timestamp outside tolerance window' };
  }

  const computedSig = await computeStripeSignature(rawBody, timestamp, secret);

  const isMatch = signatures.some(candidate => constantTimeCompare(candidate, computedSig));
  if (!isMatch) {
    return { valid: false, reason: 'Invalid Stripe signature' };
  }

  return { valid: true, timestamp };
}
