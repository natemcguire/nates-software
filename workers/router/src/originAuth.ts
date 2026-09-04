
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

export async function deriveOriginAppKey(globalSecret: string, appId: string): Promise<Uint8Array> {
  return hmacSha256(new TextEncoder().encode(globalSecret), appId);
}

export interface OriginAuthParams {
  globalSecret: string;
  appId: string;
  host: string;
  method: string;
  path: string;
  now?: number;
  nonce?: string;
}

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
