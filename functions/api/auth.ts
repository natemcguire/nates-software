// POST /api/auth?action=register
// POST /api/auth?action=login
// POST /api/auth?action=logout
// POST /api/auth?action=claim-credentials
// POST /api/auth?action=create-cli-token
// GET  /api/auth?action=me

import { extractSessionToken, hashSessionToken, sessionCookie } from './_session';
import { requireAuth } from './_auth';

// Constant-time string comparison using SHA-256 digest XOR to prevent timing leaks
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) {
    return false;
  }
  const enc = new TextEncoder();
  const aHash = await crypto.subtle.digest('SHA-256', enc.encode(a));
  const bHash = await crypto.subtle.digest('SHA-256', enc.encode(b));
  const aBytes = new Uint8Array(aHash);
  const bBytes = new Uint8Array(bHash);
  let diff = 0;
  for (let i = 0; i < 32; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

// Web Crypto PBKDF2 Password Hashing (100,000 rounds)
export async function hashPassword(password: string, saltHex: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );
  
  const salt = new Uint8Array(
    saltHex.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []
  );

  const derivedKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    true,
    ['sign']
  );

  const rawKey = await crypto.subtle.exportKey('raw', derivedKey);
  return Array.from(new Uint8Array(rawKey))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export function generateSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export function generateSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
  try {
    const { token } = extractSessionToken(request);

    if (!token) {
      return Response.json({ success: true, user: null, authenticated: false });
    }

    if (env && env.DB) {
      const session = await env.DB.prepare(`
        SELECT s.user_id, s.expires_at, u.id, u.username, u.display_name AS displayName,
               u.avatar_url AS avatar, u.bio, u.role, u.is_verified_maker AS isVerified
        FROM user_sessions s
        JOIN users u ON s.user_id = u.id
        WHERE s.token_hash = ? AND s.expires_at > ? AND s.revoked_at IS NULL
      `).bind(await hashSessionToken(token), Date.now()).first();

      if (session) {
        return Response.json({
          success: true,
          authenticated: true,
          expiresAt: session.expires_at,
          user: {
            id: session.id,
            username: session.username,
            displayName: session.displayName,
            avatar: session.avatar,
            bio: session.bio,
            role: session.role,
            isSuperAdmin: session.role === 'super_admin',
            isBot: session.role === 'bot'
          }
        });
      }
    }

    // Default guest
    return Response.json({ success: true, user: null, authenticated: false });
  } catch (err: any) {
    // A session *read* failing (e.g. a transient cold-D1 hiccup) is not a fault
    // the visitor should see as a red 500 in the console during first-run — and
    // it can never grant access. Degrade to an honest "not authenticated" 200;
    // the client's AuthContext treats that as a plain guest. (Mutations below
    // still fail-closed with 500 — this soft path is GET/session-check only.)
    console.error('[AUTH] session lookup error (degrading to guest):', err?.message || err);
    return Response.json({ success: true, user: null, authenticated: false });
  }
};

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  try {
    const url = new URL(request.url);
    const action = url.searchParams.get('action') || 'login';
    let body: any = {};
    try {
      body = await request.json();
    } catch {}

    if (action === 'claim-credentials' || action === 'set-initial-password') {
      const { username, newPassword, password, token, bootstrapToken } = body;
      const cleanUser = (username || '').toLowerCase().trim();
      const passToSet = newPassword || password;
      const providedToken = (
        token ||
        bootstrapToken ||
        request.headers.get('x-bootstrap-token') ||
        (request.headers.get('authorization')?.startsWith('Bearer ')
          ? request.headers.get('authorization')?.slice(7).trim()
          : '') ||
        ''
      ).trim();

      if (!cleanUser || !passToSet) {
        return Response.json({ success: false, error: 'Username and new password are required' }, { status: 400 });
      }

      if (typeof passToSet !== 'string' || passToSet.length < 8) {
        return Response.json({ success: false, error: 'Password must be at least 8 characters' }, { status: 400 });
      }

      const expectedToken = (
        (env && env.OWNER_BOOTSTRAP_TOKEN) ||
        (typeof process !== 'undefined' && process.env ? process.env.OWNER_BOOTSTRAP_TOKEN : '') ||
        ''
      ).trim();

      if (!expectedToken) {
        return Response.json({ success: false, error: 'Owner bootstrap token is not configured on server' }, { status: 403 });
      }

      if (!providedToken) {
        return Response.json({ success: false, error: 'Bootstrap token is required' }, { status: 403 });
      }

      const isTokenValid = await timingSafeEqual(providedToken, expectedToken);
      if (!isTokenValid) {
        return Response.json({ success: false, error: 'Invalid bootstrap token' }, { status: 403 });
      }

      if (!env || !env.DB) {
        return Response.json({ success: false, error: 'Authentication database unavailable' }, { status: 503 });
      }

      const user = await env.DB.prepare(`
        SELECT * FROM users WHERE username = ?
      `).bind(cleanUser).first();

      if (!user) {
        return Response.json({ success: false, error: 'User not found' }, { status: 404 });
      }

      if (user.password_hash !== 'seeded_super_admin' && user.password_hash !== 'seeded_bot') {
        return Response.json({
          success: false,
          error: 'Account credentials have already been claimed or are not eligible for bootstrap claim'
        }, { status: 400 });
      }

      const salt = generateSalt();
      const hash = await hashPassword(passToSet, salt);

      const updateResult = await env.DB.prepare(`
        UPDATE users
        SET password_hash = ?, salt = ?, ssh_public_key = NULL
        WHERE username = ? AND password_hash IN ('seeded_super_admin', 'seeded_bot')
      `).bind(hash, salt, cleanUser).run();

      if (updateResult && updateResult.meta && updateResult.meta.changes === 0) {
        return Response.json({
          success: false,
          error: 'Account credentials could not be updated or were already claimed'
        }, { status: 409 });
      }

      const sessionToken = generateSessionToken();
      const expiresAt = Date.now() + 30 * 24 * 3600 * 1000;

      await env.DB.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, ?, ?)
      `).bind(await hashSessionToken(sessionToken), user.id, expiresAt).run();

      await env.DB.prepare(`
        UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?
      `).bind(user.id).run();

      return Response.json({
        success: true,
        authenticated: true,
        token: sessionToken,
        user: {
          id: user.id,
          username: user.username,
          displayName: user.display_name,
          avatar: user.avatar_url,
          bio: user.bio,
          role: user.role,
          isSuperAdmin: user.role === 'super_admin',
          isBot: user.role === 'bot'
        },
        message: 'Credentials claimed successfully'
      }, {
        headers: {
          'Set-Cookie': sessionCookie(request, sessionToken)
        }
      });
    }

    if (action === 'register') {
      const { username, password, displayName, avatar = '👤', bio = '' } = body;

      if (!username || !password) {
        return Response.json({ success: false, error: 'Username and password are required' }, { status: 400 });
      }

      const cleanUser = username.toLowerCase().trim();
      if (!/^[a-z0-9_-]{3,20}$/.test(cleanUser)) {
        return Response.json({ success: false, error: 'Username must be 3-20 characters alphanumeric (a-z, 0-9, -, _)' }, { status: 400 });
      }

      if (password.length < 8) {
        return Response.json({ success: false, error: 'Password must be at least 8 characters' }, { status: 400 });
      }

      if (['admin', 'root', 'superadmin', 'sam'].includes(cleanUser)) {
        return Response.json({ success: false, error: 'Username is reserved by system' }, { status: 400 });
      }

      const salt = generateSalt();
      const hash = await hashPassword(password, salt);
      const userId = `usr_${cleanUser}_${Date.now().toString(36)}`;
      const role = 'user';

      if (env && env.DB) {
        const existing = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(cleanUser).first();
        if (existing) {
          return Response.json({ success: false, error: 'Username already registered. Please log in.' }, { status: 409 });
        }

        await env.DB.prepare(`
          INSERT INTO users (id, username, display_name, avatar_url, bio, password_hash, salt, role, is_verified_maker)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
        `).bind(userId, cleanUser, displayName || cleanUser, avatar, bio, hash, salt, role).run();

        const token = generateSessionToken();
        const expiresAt = Date.now() + 30 * 24 * 3600 * 1000;

        await env.DB.prepare(`
          INSERT INTO user_sessions (token_hash, user_id, expires_at)
          VALUES (?, ?, ?)
        `).bind(await hashSessionToken(token), userId, expiresAt).run();

        return Response.json({
          success: true,
          authenticated: true,
          token,
          user: {
            id: userId,
            username: cleanUser,
            displayName: displayName || cleanUser,
            avatar,
            bio,
            role,
            isSuperAdmin: false
          }
        }, {
          headers: {
            'Set-Cookie': sessionCookie(request, token)
          }
        });
      }

      return Response.json({ success: false, error: 'Authentication database unavailable' }, { status: 503 });
    }

    if (action === 'login') {
      const { username, password } = body;
      const cleanUser = (username || '').toLowerCase().trim();

      if (!cleanUser || !password) {
        return Response.json({ success: false, error: 'Username and password required' }, { status: 400 });
      }

      if (env && env.DB) {
        const user = await env.DB.prepare(`
          SELECT * FROM users WHERE username = ?
        `).bind(cleanUser).first();

        if (!user) {
          return Response.json({ success: false, error: 'Invalid username or password' }, { status: 401 });
        }

        // Placeholder accounts cannot log in directly until claimed via credential bootstrap
        if (user.password_hash === 'seeded_super_admin' || user.password_hash === 'seeded_bot') {
          return Response.json({
            success: false,
            error: 'Account not yet activated — set your initial password via credential claim'
          }, { status: 403 });
        }

        if (!user.salt || !user.password_hash) {
          return Response.json({ success: false, error: 'Invalid username or password' }, { status: 401 });
        }

        // Strictly verify password using PBKDF2 Web Crypto
        const testHash = await hashPassword(password, user.salt);
        if (testHash !== user.password_hash) {
          return Response.json({ success: false, error: 'Invalid username or password' }, { status: 401 });
        }

        const token = generateSessionToken();
        const expiresAt = Date.now() + 30 * 24 * 3600 * 1000;

        await env.DB.prepare(`
          INSERT INTO user_sessions (token_hash, user_id, expires_at)
          VALUES (?, ?, ?)
        `).bind(await hashSessionToken(token), user.id, expiresAt).run();

        await env.DB.prepare(`
          UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?
        `).bind(user.id).run();

        return Response.json({
          success: true,
          authenticated: true,
          token,
          user: {
            id: user.id,
            username: user.username,
            displayName: user.display_name,
            avatar: user.avatar_url,
            bio: user.bio,
            role: user.role,
            isSuperAdmin: user.role === 'super_admin'
          }
        }, {
          headers: {
            'Set-Cookie': sessionCookie(request, token)
          }
        });
      }

      return Response.json({ success: false, error: 'Authentication database unavailable' }, { status: 503 });
    }

    if (action === 'logout') {
      const { token } = extractSessionToken(request);

      if (token && env && env.DB) {
        await env.DB.prepare('DELETE FROM user_sessions WHERE token_hash = ?').bind(await hashSessionToken(token)).run();
      }

      return Response.json({ success: true, message: 'Logged out' }, {
        headers: {
          'Set-Cookie': sessionCookie(request, '', 0)
        }
      });
    }

    if (action === 'create-cli-token') {
      const { user, errorResponse } = await requireAuth(request, env);
      if (errorResponse) {
        return errorResponse;
      }
      if (!user) {
        return Response.json({ success: false, error: 'Unauthorized: Valid authenticated session required' }, { status: 401 });
      }

      if (!env || !env.DB) {
        return Response.json({ success: false, error: 'Authentication database unavailable' }, { status: 503 });
      }

      const token = generateSessionToken();
      const expiresAt = Date.now() + 90 * 24 * 3600 * 1000;

      await env.DB.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, ?, ?)
      `).bind(await hashSessionToken(token), user.id, expiresAt).run();

      return Response.json({
        success: true,
        token,
        expiresAt,
        user: {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          avatar: user.avatar,
          role: user.role
        }
      });
    }

    return Response.json({ success: false, error: 'Invalid auth action' }, { status: 400 });
  } catch (err: any) {
    console.error('[AUTH] error:', err?.message || err);
    return Response.json({ success: false, error: 'Authentication service error' }, { status: 500 });
  }
};
