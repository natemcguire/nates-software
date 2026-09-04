import { getSessionUser, requireAuth } from './_auth';
import { validateMakerProfile, calculateMakerEconomics, safePublishedArtifacts } from '../../src/lib/profileDomain';
import {
  parseAndValidateSshKeyInput,
  parseAndValidateSshKeyString,
  ParsedSshKey
} from '../../src/lib/sshDomain';

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

    if (isSelf) {
      let royalties: ReturnType<typeof calculateMakerEconomics> = {
        makerBalanceCents: 0,
        makerSalesCents: 0,
        lineageEarnedCents: 0,
        lineageBreakdown: [],
        grossSalesCents: 0,
        platformFeesCents: 0,
        upstreamRoyaltiesPaidCents: 0,
        netEarningsCents: 0,
        availableForPayoutCents: 0,
        pendingPayoutCents: 0,
        paidOutCents: 0
      };

      const { results: allocations } = await env.DB.prepare(`
          SELECT a.role, a.amount_cents, a.source_repository_id, o.app_id, al.name
          FROM commerce_order_allocations a
          JOIN commerce_orders o ON a.order_id = o.id
          LEFT JOIN app_listings al ON o.app_id = al.id
          WHERE a.recipient_user_id = ? AND o.status = 'fulfilled'
        `).bind(user.id).all();

      const makerEconomics = calculateMakerEconomics((allocations || []) as any[]);
      const directSalesRow = await env.DB.prepare(`
        SELECT
          COALESCE(SUM(grossCents), 0) AS grossSalesCents,
          COALESCE(SUM(platformFeesCents), 0) AS platformFeesCents,
          COALESCE(SUM(upstreamRoyaltiesPaidCents), 0) AS upstreamRoyaltiesPaidCents
        FROM (
          SELECT
            o.id,
            o.gross_cents AS grossCents,
            COALESCE(SUM(CASE WHEN a.role IN ('platform', 'protocol_pool') THEN a.amount_cents ELSE 0 END), 0) AS platformFeesCents,
            COALESCE(SUM(CASE WHEN a.role = 'ancestor' THEN a.amount_cents ELSE 0 END), 0) AS upstreamRoyaltiesPaidCents
          FROM commerce_orders o
          LEFT JOIN commerce_order_allocations a ON a.order_id = o.id
          WHERE o.seller_user_id = ? AND o.status = 'fulfilled'
          GROUP BY o.id, o.gross_cents
        )
      `).bind(user.id).first();
      const payoutRow = await env.DB.prepare(`
        SELECT
          COALESCE(SUM(CASE
            WHEN t.status IN ('pending', 'retryable_failure')
              AND datetime(COALESCE(t.next_attempt_at, t.available_at)) <= CURRENT_TIMESTAMP
            THEN a.amount_cents ELSE 0 END), 0) AS availableForPayoutCents,
          COALESCE(SUM(CASE
            WHEN t.id IS NULL OR t.status = 'processing'
              OR (t.status IN ('pending', 'retryable_failure')
                AND datetime(COALESCE(t.next_attempt_at, t.available_at)) > CURRENT_TIMESTAMP)
            THEN a.amount_cents ELSE 0 END), 0) AS pendingPayoutCents,
          COALESCE(SUM(CASE WHEN t.status = 'succeeded' THEN a.amount_cents ELSE 0 END), 0) AS paidOutCents
        FROM commerce_order_allocations a
        JOIN commerce_orders o ON o.id = a.order_id
        LEFT JOIN commerce_transfer_outbox t ON t.allocation_id = a.id
        WHERE a.recipient_user_id = ?
          AND a.role IN ('maker', 'seller', 'ancestor')
          AND o.status = 'fulfilled'
      `).bind(user.id).first();
      royalties = {
        ...makerEconomics,
        grossSalesCents: Number((directSalesRow as any)?.grossSalesCents || 0),
        platformFeesCents: Number((directSalesRow as any)?.platformFeesCents || 0),
        upstreamRoyaltiesPaidCents: Number((directSalesRow as any)?.upstreamRoyaltiesPaidCents || 0),
        netEarningsCents: makerEconomics.makerBalanceCents,
        availableForPayoutCents: Number((payoutRow as any)?.availableForPayoutCents || 0),
        pendingPayoutCents: Number((payoutRow as any)?.pendingPayoutCents || 0),
        paidOutCents: Number((payoutRow as any)?.paidOutCents || 0)
      };

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

async function removeUserSshKey(db: any, userId: string, keyId: string): Promise<{ removed: boolean }> {
  const keyRow = await db.prepare(`
    SELECT id, key_prefix FROM user_ssh_keys
    WHERE id = ? AND user_id = ?
  `).bind(keyId, userId).first();

  if (!keyRow) {
    return { removed: false };
  }

  const keyPrefix = (keyRow as any).key_prefix;
  await db.batch([
    db.prepare(`
      DELETE FROM user_ssh_keys
      WHERE id = ? AND user_id = ?
    `).bind(keyId, userId),
    db.prepare(`
      UPDATE users
      SET ssh_public_key = NULL
      WHERE id = ? AND (ssh_public_key = ? OR substr(ssh_public_key, 1, length(?) + 1) = ? || ' ')
    `).bind(userId, keyPrefix, keyPrefix, keyPrefix)
  ]);

  return { removed: true };
}

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

    if (action === 'add-ssh-key') {
      const parsed = parseAndValidateSshKeyInput(body);
      if (!parsed.valid) {
        return Response.json({ success: false, error: parsed.error }, { status: parsed.status });
      }

      const keyId = `key_${crypto.randomUUID().replace(/-/g, '')}`;

      try {
        await env.DB.prepare(`
          INSERT INTO user_ssh_keys (id, user_id, key_type, key_base64, key_prefix, label, created_at)
          VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `).bind(keyId, sessionUser.id, parsed.key.keyType, parsed.key.keyBase64, parsed.key.keyPrefix, parsed.key.label || null).run();
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

    if (action === 'remove-ssh-key') {
      const id = String(body?.id || url.searchParams.get('id') || '').trim();
      if (!id) {
        return Response.json({ success: false, error: 'Key id is required.' }, { status: 400 });
      }

      const { removed } = await removeUserSshKey(env.DB, sessionUser.id, id);
      return Response.json({
        success: true,
        message: 'SSH key removed successfully',
        removed
      });
    }

    const { displayName, avatar, bio, sshKey } = body;

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

    let parsedNewKey: ParsedSshKey | null = null;
    if (hasSshKey && sshKey && typeof sshKey === 'string' && sshKey.trim()) {
      const parsed = parseAndValidateSshKeyString(sshKey);
      if (!parsed.valid) {
        return Response.json({ success: false, error: parsed.error }, { status: 400 });
      }
      parsedNewKey = parsed.key;

      const existingOther = await env.DB.prepare(`
        SELECT user_id FROM user_ssh_keys WHERE key_prefix = ? AND user_id != ? LIMIT 1
      `).bind(parsedNewKey.keyPrefix, sessionUser.id).first();
      if (existingOther) {
        return Response.json({ success: false, error: 'This SSH key is already registered.' }, { status: 409 });
      }
    }

    const statements: any[] = [];

    if (hasSshKey) {
      if (parsedNewKey) {
        const keyId = `key_${crypto.randomUUID().replace(/-/g, '')}`;
        statements.push(
          env.DB.prepare(`
            DELETE FROM user_ssh_keys WHERE user_id = ?
          `).bind(sessionUser.id)
        );
        statements.push(
          env.DB.prepare(`
            INSERT INTO user_ssh_keys (id, user_id, key_type, key_base64, key_prefix, label, created_at)
            VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          `).bind(keyId, sessionUser.id, parsedNewKey.keyType, parsedNewKey.keyBase64, parsedNewKey.keyPrefix, parsedNewKey.label || null)
        );
      } else {
        statements.push(
          env.DB.prepare(`
            DELETE FROM user_ssh_keys WHERE user_id = ?
          `).bind(sessionUser.id)
        );
      }
    }

    statements.push(
      env.DB.prepare(`
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
      )
    );

    try {
      await env.DB.batch(statements);
    } catch (batchErr: any) {
      const msg = String(batchErr?.message || '');
      if (msg.includes('UNIQUE constraint failed') || msg.includes('idx_user_ssh_keys_prefix') || msg.includes('user_ssh_keys.key_prefix')) {
        return Response.json({ success: false, error: 'This SSH key is already registered.' }, { status: 409 });
      }
      throw batchErr;
    }

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
  } catch (error: any) {
    console.error('profile update failed', error);
    const msg = String(error?.message || '');
    if (msg.includes('UNIQUE constraint failed') || msg.includes('idx_user_ssh_keys_prefix') || msg.includes('user_ssh_keys.key_prefix')) {
      return Response.json({ success: false, error: 'This SSH key is already registered.' }, { status: 409 });
    }
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

    const { removed } = await removeUserSshKey(env.DB, sessionUser.id, id);
    return Response.json({
      success: true,
      message: 'SSH key removed successfully',
      removed
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
