// Application-level auth throttle backed by the auth_rate_limits D1 table (migration 0008).
// Cloudflare WAF is the front-line rate limiter; this is defense-in-depth that works even
// without WAF config and bounds password-guessing per account. Never throws — on any DB
// error it fails OPEN (returns allowed) so a throttle-store hiccup can't lock users out.

const WINDOW_SECONDS = 15 * 60;   // rolling window
const MAX_ATTEMPTS = 8;           // failures allowed per window before a block
const BLOCK_SECONDS = 15 * 60;    // how long a tripped subject stays blocked

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

// Call BEFORE verifying credentials. Returns allowed=false when the subject is currently
// blocked. Does not mutate on the check — mutation happens in recordAuthFailure/Success.
export async function checkAuthRateLimit(
  db: any,
  scope: string,
  subject: string
): Promise<RateLimitDecision> {
  if (!db || !subject) return { allowed: true, retryAfterSeconds: 0 };
  try {
    const subjectHash = await sha256Hex(`${scope}:${subject.toLowerCase().trim()}`);
    const now = Math.floor(Date.now() / 1000);
    const row = await db.prepare(
      `SELECT blocked_until FROM auth_rate_limits WHERE scope = ? AND subject_hash = ?`
    ).bind(scope, subjectHash).first();
    const blockedUntil = row ? Number((row as any).blocked_until || 0) : 0;
    if (blockedUntil && blockedUntil > now) {
      return { allowed: false, retryAfterSeconds: blockedUntil - now };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  } catch {
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

// Call AFTER a failed credential check. Increments the windowed counter and sets a block
// once MAX_ATTEMPTS is exceeded. Returns the decision so the caller can 429 immediately.
export async function recordAuthFailure(
  db: any,
  scope: string,
  subject: string
): Promise<RateLimitDecision> {
  if (!db || !subject) return { allowed: true, retryAfterSeconds: 0 };
  try {
    const subjectHash = await sha256Hex(`${scope}:${subject.toLowerCase().trim()}`);
    const now = Math.floor(Date.now() / 1000);

    // Increment atomically INSIDE the UPSERT so concurrent failures can't lost-update the
    // counter (D1 executes each statement atomically). The window resets in-SQL when the
    // prior window has expired, otherwise the counter accumulates; the block trips the
    // moment the accumulated count exceeds MAX_ATTEMPTS. RETURNING gives us the new state.
    const updated = await db.prepare(
      `INSERT INTO auth_rate_limits (scope, subject_hash, window_started_at, attempts, blocked_until)
       VALUES (?1, ?2, ?3, 1, NULL)
       ON CONFLICT(scope, subject_hash) DO UPDATE SET
         window_started_at = CASE WHEN ?3 - window_started_at >= ?4 THEN ?3 ELSE window_started_at END,
         attempts = CASE WHEN ?3 - window_started_at >= ?4 THEN 1 ELSE attempts + 1 END,
         blocked_until = CASE
           WHEN (CASE WHEN ?3 - window_started_at >= ?4 THEN 1 ELSE attempts + 1 END) > ?5
             THEN ?3 + ?6
           ELSE blocked_until END
       RETURNING attempts, blocked_until`
    ).bind(scope, subjectHash, now, WINDOW_SECONDS, MAX_ATTEMPTS, BLOCK_SECONDS).first();

    const blockedUntil = updated ? Number((updated as any).blocked_until || 0) : 0;
    if (blockedUntil && blockedUntil > now) {
      return { allowed: false, retryAfterSeconds: blockedUntil - now };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  } catch {
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

// Call AFTER a successful auth. Clears the subject's counter so a legitimate user who
// mistyped a few times isn't held back after they get in.
export async function clearAuthRateLimit(
  db: any,
  scope: string,
  subject: string
): Promise<void> {
  if (!db || !subject) return;
  try {
    const subjectHash = await sha256Hex(`${scope}:${subject.toLowerCase().trim()}`);
    await db.prepare(
      `DELETE FROM auth_rate_limits WHERE scope = ? AND subject_hash = ?`
    ).bind(scope, subjectHash).run();
  } catch {
    // best-effort cleanup
  }
}

export function rateLimitedResponse(retryAfterSeconds: number): Response {
  return Response.json(
    { success: false, error: 'Too many attempts. Please wait a few minutes and try again.' },
    { status: 429, headers: { 'Retry-After': String(Math.max(1, retryAfterSeconds)) } }
  );
}
