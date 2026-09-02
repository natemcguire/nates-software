// Router -> tenant-origin request authentication.
//
// SECURITY (Codex #4): the router used to forward env.ORIGIN_SHARED_SECRET
// verbatim as X-NSW-Origin-Auth on every proxied request. That secret is
// PLATFORM-GLOBAL — every tenant origin receives the exact same value, and
// attacker-controlled tenant app code that captures it can replay it to
// forge an authenticated "router->origin" request against ANY OTHER app's
// origin (cross-tenant impersonation). The raw global secret must never be
// disclosed to a tenant origin.
//
// Fix: sign a short-lived, request-scoped proof with a PER-APP derived key.
// The platform-global secret (ORIGIN_SHARED_SECRET) never leaves the
// platform — only the resulting per-app HMAC signature is sent, and that
// signature is cryptographically bound to:
//   - appId  (listing.id)     - a token minted for app A cannot be replayed
//                                against app B's origin (different derived key
//                                AND different bound appId)
//   - host                    - cannot be replayed against a different hostname
//   - method + path           - cannot be replayed against a different route
//   - a short expiry (60s)    - a captured token stops working almost immediately
//   - a nonce                 - defeats trivial exact-request replay within the window
//
// Header shape sent to the origin:
//   X-NSW-Origin-Auth: v1~<appId>~<host>~<expiresAtEpochSeconds>~<nonce>~<sigB64Url>
//
// Fields are separated by "~" (NOT "."), deliberately — host values like
// "my-app.workers.dev" legitimately contain dots, so a dot-delimited format
// would be ambiguous to parse. None of appId/host/method/expiresAt/nonce/sig
// can ever contain "~" (appId is constrained to [a-zA-Z0-9_-], hostnames are
// [a-zA-Z0-9.-], the nonce is a UUID, and sig is base64url), so splitting on
// "~" is always unambiguous.
//
// ORIGIN-SIDE VERIFICATION (what each tenant origin must implement to trust
// this header instead of trusting-by-default):
//   1. Split on "~" into exactly 6 fields; reject if the version isn't "v1"
//      or a field is missing.
//   2. Reject if expiresAtEpochSeconds is in the past (allow ~5s clock skew).
//   3. Recompute perAppKey = HMAC-SHA256(ORIGIN_SHARED_SECRET, appId) using
//      the origin's own copy of the SAME platform secret the router holds
//      (provisioned to the origin out-of-band, e.g. as its own scoped env
//      var — never the token itself).
//   4. Recompute sig = HMAC-SHA256(perAppKey, `${appId}\n${host}\n${method}\n${path}\n${expiresAt}\n${nonce}`)
//      using the ACTUAL inbound method/path/host of the request being served,
//      and constant-time-compare it to sigB64Url from the header.
//   5. Reject if appId in the token doesn't match the origin's own configured
//      appId (this is what makes a token minted for app A useless at app B's
//      origin even though both origins might derive keys from a compromised
//      copy of the same global secret).
// Because verification step 3 derives a PER-APP key, an origin that only
// knows its own appId's derived key can verify traffic addressed to it but
// gains nothing that lets it forge traffic for another app — this is the
// "at minimum, a per-origin derived secret" fallback baked directly into the
// primary (preferred) signed-proof scheme, not a separate weaker mode.

const ORIGIN_AUTH_VERSION = 'v1';
const ORIGIN_AUTH_TTL_SECONDS = 60;

function base64UrlEncode(bytes: Uint8Array): string {
  let raw = '';
  bytes.forEach(byte => { raw += String.fromCharCode(byte); });
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function hmacSha256(keyBytes: Uint8Array, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return new Uint8Array(sig);
}

/**
 * Derives a per-app key from the platform-global origin secret. The global
 * secret itself is never transmitted to any origin; only signatures produced
 * with this derived key (further bound to host/method/path/expiry/nonce) are.
 */
export async function deriveOriginAppKey(globalSecret: string, appId: string): Promise<Uint8Array> {
  return hmacSha256(new TextEncoder().encode(globalSecret), appId);
}

export interface OriginAuthParams {
  globalSecret: string;
  appId: string;
  host: string;
  method: string;
  path: string;
  /** Injectable for deterministic tests; defaults to Date.now(). */
  now?: number;
  /** Injectable for deterministic tests; defaults to a random UUID. */
  nonce?: string;
}

/**
 * Builds the request-scoped, app-scoped, short-expiry signed proof sent as
 * X-NSW-Origin-Auth. See module header for the full scheme and the
 * origin-side verification contract.
 */
export async function buildOriginAuthToken(params: OriginAuthParams): Promise<string> {
  const { globalSecret, appId, host, method, path } = params;
  const nowSeconds = Math.floor((params.now ?? Date.now()) / 1000);
  const expiresAt = nowSeconds + ORIGIN_AUTH_TTL_SECONDS;
  const nonce = params.nonce ?? crypto.randomUUID();

  const perAppKey = await deriveOriginAppKey(globalSecret, appId);
  const signingInput = `${appId}\n${host}\n${method.toUpperCase()}\n${path}\n${expiresAt}\n${nonce}`;
  const signature = await hmacSha256(perAppKey, signingInput);
  const sigB64 = base64UrlEncode(signature);

  return [ORIGIN_AUTH_VERSION, appId, host, String(expiresAt), nonce, sigB64].join('~');
}
