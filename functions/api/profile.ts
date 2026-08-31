// GET /api/profile?username=<handle> (Public maker lookup or private owner view)
// POST /api/profile (Authenticated profile update)

import { getSessionUser, requireAuth } from './_auth';
import { validateMakerProfile, calculateMakerEconomics, safePublishedArtifacts } from '../../src/lib/profileDomain';

const unavailable = (message = 'Profile service is temporarily unavailable') => Response.json(
  { success: false, error: message },
  { status: 503, headers: { 'Cache-Control': 'no-store' } }
);

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
  try {
    const url = new URL(request.url);
    const action = url.searchParams.get('action');

    if (action === 'list-ssh-keys' || action === 'keys' || action === 'ssh-keys') {
      const auth = await requireAuth(request, env);
      if (auth.errorResponse) return auth.errorResponse;
      const sessionUser = auth.user!;

      if (!env || !env.DB) {
        return unavailable('Database service is unavailable');
      }

      const { results: keys } = await env.DB.prepare(`
        SELECT id, user_id AS userId, key_type AS keyType, key_base64 AS keyBase64,
               key_prefix AS keyPrefix, label, created_at AS createdAt
        FROM user_ssh_keys
        WHERE user_id = ?
        ORDER BY created_at DESC
      `).bind(sessionUser.id).all();

      return Response.json({
        success: true,
        keys: (keys || []).map((k: any) => ({
          id: k.id,
          keyType: k.keyType,
          keyBase64: k.keyBase64,
          keyPrefix: k.keyPrefix,
          label: k.label,
          createdAt: k.createdAt,
          fingerprint: k.keyBase64 ? k.keyBase64.slice(-8) : ''
        }))
      });
    }

    const requestedUsername = url.searchParams.get('username')?.trim();
    const sessionUser = await getSessionUser(request, env);

    if (!env || !env.DB) {
      return unavailable('Database service is unavailable');
    }

    // Determine target username or session user
    let targetUsername = requestedUsername;
    let isSelf = false;

    if (!targetUsername) {
      if (sessionUser) {
        targetUsername = sessionUser.username;
        isSelf = true;
      } else {
        return Response.json({
          success: false,
          error: 'Username parameter is required for public profile lookup'
        }, { status: 400 });
      }
    } else if (sessionUser && (targetUsername.toLowerCase() === sessionUser.username.toLowerCase() || targetUsername === sessionUser.id)) {
      isSelf = true;
    }

    const user = await env.DB.prepare(`
      SELECT id, username, display_name AS displayName, avatar_url AS avatar, bio,
             ssh_public_key AS sshKey, stripe_account_id AS stripeAccountId,
             is_verified_maker AS isVerified, role, created_at AS createdAt
      FROM users
      WHERE lower(username) = lower(?) OR id = ?
    `).bind(targetUsername, targetUsername).first();

    if (!user) {
      return Response.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    // Fetch published apps by this maker
    const { results: publishedApps } = await env.DB.prepare(`
        SELECT id, name, tagline, version, upvotes, forks, price, storage,
               screenshots, binaries, tags, created_at AS createdAt
        FROM app_listings
        WHERE creator_id = ?
        ORDER BY created_at DESC
      `).bind(user.id).all();

    const formattedApps = (publishedApps || []).map((app: any) => ({
      ...app,
      screenshots: parseJsonColumn(app.screenshots, []),
      binaries: safePublishedArtifacts(parseJsonColumn(app.binaries, {})),
      tags: parseJsonColumn(app.tags, [])
    }));

    // Authenticated Owner: Return private fields, SSH keys, Stripe status & real royalties
    if (isSelf) {
      let royalties = {
        makerBalanceCents: 0,
        makerSalesCents: 0,
        lineageEarnedCents: 0,
        lineageBreakdown: []
      };

      const { results: allocations } = await env.DB.prepare(`
          SELECT a.role, a.amount_cents, a.source_repository_id, o.app_id, al.name
          FROM commerce_order_allocations a
          JOIN commerce_orders o ON a.order_id = o.id
          LEFT JOIN app_listings al ON o.app_id = al.id
          WHERE a.recipient_user_id = ? AND o.status = 'fulfilled'
        `).bind(user.id).all();

      if (allocations && allocations.length > 0) {
        royalties = calculateMakerEconomics(allocations as any[]) as any;
      }

      // Check Stripe Account Status
      let stripeStatus: 'not_connected' | 'pending' | 'active' | 'connected' = 'not_connected';
      let payoutsEnabled = false;
      const stripeRow = await env.DB.prepare(`
          SELECT stripe_account_id, payouts_enabled, onboarding_status
          FROM stripe_accounts
          WHERE user_id = ?
        `).bind(user.id).first();
      if (stripeRow) {
        stripeStatus = ((stripeRow as any).onboarding_status || 'connected') as any;
        payoutsEnabled = Boolean((stripeRow as any).payouts_enabled);
      }

      return Response.json({
        success: true,
        isOwner: true,
        user: {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          avatar: user.avatar,
          bio: user.bio || '',
          sshKey: user.sshKey || '',
          stripeAccountId: user.stripeAccountId || null,
          stripeStatus,
          payoutsEnabled,
          isVerified: Boolean(user.isVerified),
          role: user.role,
          createdAt: user.createdAt
        },
        publishedApps: formattedApps,
        royalties
      });
    }

    // Public Maker Profile: Strictly sanitize to public fields only (Zero secret/license/financial leakage)
    return Response.json({
      success: true,
      isOwner: false,
      user: {
        username: user.username,
        displayName: user.displayName,
        avatar: user.avatar,
        bio: user.bio || '',
        isVerified: Boolean(user.isVerified),
        createdAt: user.createdAt
      },
      publishedApps: formattedApps
    });
  } catch (error) {
    console.error('profile lookup failed', error);
    return unavailable();
  }
};

const ALLOWED_SSH_KEY_TYPES = ['ssh-ed25519', 'ssh-rsa', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521'];

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  try {
    const auth = await requireAuth(request, env);
    if (auth.errorResponse) return auth.errorResponse;
    const sessionUser = auth.user!;

    if (!env || !env.DB) {
      return unavailable('Database service is unavailable');
    }

    let body: any;
    try {
      body = await request.json();
    } catch {
      return Response.json({ success: false, error: 'Request body must be valid JSON' }, { status: 400 });
    }

    const url = new URL(request.url);
    const action = String(body?.action || url.searchParams.get('action') || '');

    // Action: Add SSH Key
    if (action === 'add-ssh-key') {
      let keyType = String(body.keyType || '').trim();
      let keyBase64 = String(body.keyBase64 || '').trim();
      let label = typeof body.label === 'string' ? body.label.trim() : null;

      const rawPublicKey = String(body.publicKey || body.sshKey || body.key || '').trim();
      if (rawPublicKey && (!keyType || !keyBase64)) {
        const parts = rawPublicKey.split(/\s+/);
        if (parts.length >= 2) {
          keyType = parts[0];
          keyBase64 = parts[1];
          if (!label && parts.length >= 3) {
            label = parts.slice(2).join(' ');
          }
        } else {
          return Response.json({ success: false, error: 'Malformed SSH public key string.' }, { status: 400 });
        }
      }

      if (!keyType || !keyBase64) {
        return Response.json({ success: false, error: 'keyType and keyBase64 or publicKey are required.' }, { status: 400 });
      }

      if (!ALLOWED_SSH_KEY_TYPES.includes(keyType)) {
        return Response.json({ success: false, error: 'Unsupported SSH public key type.' }, { status: 400 });
      }

      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(keyBase64) || keyBase64.length > 16384) {
        return Response.json({ success: false, error: 'Malformed SSH public key base64 blob.' }, { status: 400 });
      }

      const keyPrefix = `${keyType} ${keyBase64}`;
      const keyId = `key_${crypto.randomUUID().replace(/-/g, '')}`;

      try {
        await env.DB.prepare(`
          INSERT INTO user_ssh_keys (id, user_id, key_type, key_base64, key_prefix, label, created_at)
          VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `).bind(keyId, sessionUser.id, keyType, keyBase64, keyPrefix, label || null).run();
      } catch (error: any) {
        const msg = String(error?.message || '');
        if (msg.includes('UNIQUE constraint failed') || msg.includes('idx_user_ssh_keys_prefix') || msg.includes('user_ssh_keys.key_prefix')) {
          return Response.json({ success: false, error: 'This SSH key is already registered.' }, { status: 409 });
        }
        console.error('Failed to insert user ssh key', error);
        return Response.json({ success: false, error: 'Failed to register SSH key.' }, { status: 500 });
      }

      const created = await env.DB.prepare(`
        SELECT id, user_id AS userId, key_type AS keyType, key_base64 AS keyBase64,
               key_prefix AS keyPrefix, label, created_at AS createdAt
        FROM user_ssh_keys
        WHERE id = ?
      `).bind(keyId).first();

      return Response.json({
        success: true,
        message: 'SSH key added successfully',
        key: created
      }, { status: 201 });
    }

    // Action: Remove SSH Key
    if (action === 'remove-ssh-key') {
      const id = String(body?.id || url.searchParams.get('id') || '').trim();
      if (!id) {
        return Response.json({ success: false, error: 'Key id is required.' }, { status: 400 });
      }

      const result = await env.DB.prepare(`
        DELETE FROM user_ssh_keys
        WHERE id = ? AND user_id = ?
      `).bind(id, sessionUser.id).run();

      const changes = result?.meta?.changes ?? 0;
      return Response.json({
        success: true,
        message: 'SSH key removed successfully',
        removed: changes > 0
      });
    }

    // Default: Legacy Profile Update
    const { displayName, avatar, bio, sshKey } = body;

    // Validate using domain rules
    const validation = validateMakerProfile({
      username: sessionUser.username,
      displayName: displayName !== undefined ? displayName : sessionUser.displayName,
      avatar: avatar !== undefined ? avatar : sessionUser.avatar,
      bio: bio !== undefined ? bio : '',
      sshKey: sshKey !== undefined ? sshKey : null
    });

    if (!validation.valid) {
      return Response.json({ success: false, error: validation.errors.join('. ') }, { status: 400 });
    }

    const hasDisplayName = Object.prototype.hasOwnProperty.call(body, 'displayName');
    const hasAvatar = Object.prototype.hasOwnProperty.call(body, 'avatar');
    const hasBio = Object.prototype.hasOwnProperty.call(body, 'bio');
    const hasSshKey = Object.prototype.hasOwnProperty.call(body, 'sshKey');

    const result = await env.DB.prepare(`
      UPDATE users SET
        display_name = CASE WHEN ? = 1 THEN ? ELSE display_name END,
        avatar_url = CASE WHEN ? = 1 THEN ? ELSE avatar_url END,
        bio = CASE WHEN ? = 1 THEN ? ELSE bio END,
        ssh_public_key = CASE WHEN ? = 1 THEN ? ELSE ssh_public_key END
      WHERE id = ?
    `).bind(
      hasDisplayName ? 1 : 0, hasDisplayName ? displayName.trim() : null,
      hasAvatar ? 1 : 0, hasAvatar ? (avatar.trim() || null) : null,
      hasBio ? 1 : 0, hasBio ? bio.trim() : null,
      hasSshKey ? 1 : 0, hasSshKey && sshKey ? sshKey.trim() : null,
      sessionUser.id
    ).run();

    if (result?.success === false) throw new Error('Profile update was rejected by storage');
    const updated = await env.DB.prepare(`
      SELECT username, display_name AS displayName, avatar_url AS avatar, bio,
             ssh_public_key AS sshKey
      FROM users WHERE id = ?
    `).bind(sessionUser.id).first();
    if (!updated) throw new Error('Updated profile could not be confirmed');

    return Response.json({
      success: true,
      message: 'Profile updated securely from authenticated session',
      user: updated
    });
  } catch (error) {
    console.error('profile update failed', error);
    return Response.json({ success: false, error: 'Profile update could not be completed' }, { status: 500 });
  }
};

export const onRequestDelete = async ({ request, env }: { request: Request; env: any }) => {
  try {
    const auth = await requireAuth(request, env);
    if (auth.errorResponse) return auth.errorResponse;
    const sessionUser = auth.user!;

    if (!env || !env.DB) {
      return unavailable('Database service is unavailable');
    }

    const url = new URL(request.url);
    let body: any = {};
    try {
      body = await request.json();
    } catch {}

    const id = String(body?.id || url.searchParams.get('id') || '').trim();
    if (!id) {
      return Response.json({ success: false, error: 'Key id is required.' }, { status: 400 });
    }

    const result = await env.DB.prepare(`
      DELETE FROM user_ssh_keys
      WHERE id = ? AND user_id = ?
    `).bind(id, sessionUser.id).run();

    const changes = result?.meta?.changes ?? 0;
    return Response.json({
      success: true,
      message: 'SSH key removed successfully',
      removed: changes > 0
    });
  } catch (error) {
    console.error('remove ssh key failed', error);
    return Response.json({ success: false, error: 'Failed to remove SSH key.' }, { status: 500 });
  }
};

function parseJsonColumn(value: unknown, fallback: unknown) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}
