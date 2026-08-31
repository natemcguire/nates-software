import { describe, it, expect, beforeEach } from 'vitest';
import { createTestD1Database, TestD1Context, CANONICAL_MIGRATIONS, getMigrationsDir } from './fixtures/d1Harness';
import { onRequestPost as gitPost } from '../functions/api/git';
import * as profileApi from '../functions/api/profile';
import { hashSessionToken } from '../functions/api/_session';
import * as fs from 'fs';
import * as path from 'path';

const GATEWAY_SECRET = 'test-gateway-secret-12345';

function gwRequest(body: any) {
  return new Request('https://nates-software.com/api/git', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GATEWAY_SECRET}`,
    },
    body: JSON.stringify(body),
  });
}

describe('Multi-SSH-Key Support & Single Authoritative Auth Store Suite', () => {
  let ctx: TestD1Context;
  let env: any;

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
    env = { DB: ctx.d1, GITSMITH_GATEWAY_TOKEN: GATEWAY_SECRET };
  });

  // =========================================================================
  // 1. MIGRATION 0028, BACKFILL HARDENING & FAIL-CLOSED GUARD
  // =========================================================================
  describe('1. Migration 0028, Backfill Hardening & Self-Consistency CHECK', () => {
    it('backfills seed users with legacy ssh_public_key into user_ssh_keys', async () => {
      const rows = await ctx.d1.prepare(`
        SELECT id, user_id, key_type, key_base64, key_prefix, label
        FROM user_ssh_keys
        WHERE user_id = 'usr_nate'
      `).all();

      expect(rows.results?.length).toBe(1);
      const row = rows.results?.[0] as any;
      expect(row.user_id).toBe('usr_nate');
      expect(row.key_type).toBe('ssh-ed25519');
      expect(row.key_base64).toBe('AAAAC3NzaC1lZDI1NTE5AAAAIGxY84pQ4eM19287KlmQ4892187');
      expect(row.key_prefix).toBe('ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGxY84pQ4eM19287KlmQ4892187');
      expect(row.label).toBe('migrated');
    });

    it('executes migration 0028 on a database with custom legacy keys (comment-bearing, tab-separated, multi-space)', async () => {
      const legacyMigrations = CANONICAL_MIGRATIONS.slice(
        0,
        CANONICAL_MIGRATIONS.indexOf('0028_user_ssh_keys.sql')
      );
      const legacyCtx = await createTestD1Database({
        foreignKeys: true,
        migrations: legacyMigrations
      });

      // Insert custom users with various whitespace and comment formats
      await legacyCtx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role, ssh_public_key)
        VALUES
          ('usr_alice', 'alice', 'Alice User', 'maker', 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQCalice alice@workstation'),
          ('usr_bob', 'bob', 'Bob User', 'maker', 'ecdsa-sha2-nistp256\tAAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbob\t\tbob@machine'),
          ('usr_carol', 'carol', 'Carol User', 'maker', '   ssh-ed25519   AAAAC3NzaC1lZDI1NTE5AAAAIcarol   carol@laptop   '),
          ('usr_empty', 'empty', 'Empty User', 'maker', '')
      `).run();

      const migrationSql = fs.readFileSync(
        path.join(getMigrationsDir(), '0028_user_ssh_keys.sql'),
        'utf8'
      );
      await legacyCtx.d1.exec(migrationSql);

      const keys = await legacyCtx.d1.prepare(`
        SELECT user_id, key_type, key_base64, key_prefix, label
        FROM user_ssh_keys
        ORDER BY user_id
      `).all();

      const keyMap = new Map((keys.results || []).map((k: any) => [k.user_id, k]));

      // Alice (with comment)
      expect(keyMap.get('usr_alice')).toMatchObject({
        user_id: 'usr_alice',
        key_type: 'ssh-rsa',
        key_base64: 'AAAAB3NzaC1yc2EAAAADAQABAAABAQCalice',
        key_prefix: 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQCalice',
        label: 'migrated'
      });

      // Bob (tab-separated with comment)
      expect(keyMap.get('usr_bob')).toMatchObject({
        user_id: 'usr_bob',
        key_type: 'ecdsa-sha2-nistp256',
        key_base64: 'AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbob',
        key_prefix: 'ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbob',
        label: 'migrated'
      });

      // Carol (multi-space with leading/trailing whitespace and comment)
      expect(keyMap.get('usr_carol')).toMatchObject({
        user_id: 'usr_carol',
        key_type: 'ssh-ed25519',
        key_base64: 'AAAAC3NzaC1lZDI1NTE5AAAAIcarol',
        key_prefix: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIcarol',
        label: 'migrated'
      });

      // Empty user should not have a key
      expect(keyMap.has('usr_empty')).toBe(false);

      expect(legacyCtx.runForeignKeyCheck()).toEqual([]);
    });

    it('rerun of migration 0028 is idempotent (INSERT OR IGNORE)', async () => {
      const migrationSql = fs.readFileSync(
        path.join(getMigrationsDir(), '0028_user_ssh_keys.sql'),
        'utf8'
      );
      // Rerun on already-migrated database
      await expect(ctx.d1.exec(migrationSql)).resolves.not.toThrow();

      const nateKeys = await ctx.d1.prepare(`
        SELECT id, key_prefix FROM user_ssh_keys WHERE user_id = 'usr_nate'
      `).all();
      expect(nateKeys.results?.length).toBe(1);
    });

    it('fail-closed guard passes for valid data and guard table is dropped', async () => {
      const tables = ctx.getTableNames();
      expect(tables).not.toContain('_ssh_backfill_guard');
    });

    it('fail-closed guard aborts migration if an unparseable legacy key is left unmigrated', async () => {
      const legacyMigrations = CANONICAL_MIGRATIONS.slice(
        0,
        CANONICAL_MIGRATIONS.indexOf('0028_user_ssh_keys.sql')
      );
      const legacyCtx = await createTestD1Database({
        foreignKeys: true,
        migrations: legacyMigrations
      });

      // Insert an invalid legacy key type that will not match the parse filter
      await legacyCtx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role, ssh_public_key)
        VALUES ('usr_corrupt', 'corrupt', 'Corrupt User', 'maker', 'unsupported-key-type AAAAC3NzaC1lZDI1NTE5AAAAI')
      `).run();

      const migrationSql = fs.readFileSync(
        path.join(getMigrationsDir(), '0028_user_ssh_keys.sql'),
        'utf8'
      );
      // Guard CHECK(x = 0) must trigger and fail the migration
      await expect(legacyCtx.d1.exec(migrationSql)).rejects.toThrow(/CHECK constraint failed/);
    });

    it('enforces self-consistency CHECK on user_ssh_keys (key_prefix = key_type || " " || key_base64)', async () => {
      await expect(
        ctx.d1.prepare(`
          INSERT INTO user_ssh_keys (id, user_id, key_type, key_base64, key_prefix, label)
          VALUES ('key_chk_fail', 'usr_nate', 'ssh-ed25519', 'AAAAC3NzaC1lZDI1NTE5AAAAIBlob', 'ssh-rsa AAAAC3NzaC1lZDI1NTE5AAAAIBlob', 'bad')
        `).run()
      ).rejects.toThrow(/CHECK constraint failed/);
    });
  });

  // =========================================================================
  // 2. SINGLE AUTHORITATIVE STORE GIT AUTH (git.ts)
  // =========================================================================
  describe('2. Single Authoritative Auth Store in git.ts (#1 & #2 Security Fix)', () => {
    const KEY_TYPE = 'ssh-ed25519';
    const NATE_MIGRATED_B64 = 'AAAAC3NzaC1lZDI1NTE5AAAAIGxY84pQ4eM19287KlmQ4892187';
    const MULTI_KEY_B64 = 'AAAAC3NzaC1lZDI1NTE5AAAAIMultiKeyBlobForAgent123456789012345678';
    const SECOND_KEY_B64 = 'AAAAC3NzaC1lZDI1NTE5AAAAISecondKeyBlobForSam123456789012345678';

    it('a backfilled legacy user authenticates via user_ssh_keys on both gateway actions', async () => {
      // 1. Identify action
      const identifyRes = await gitPost({
        request: gwRequest({
          action: 'gateway-identify-ssh-key',
          keyType: KEY_TYPE,
          keyBase64: NATE_MIGRATED_B64
        }),
        env
      } as any);
      const identifyData = await identifyRes.json();
      expect(identifyRes.status).toBe(200);
      expect(identifyData.success).toBe(true);
      expect(identifyData.actorUserId).toBe('usr_nate');

      // 2. Authorize action
      await ctx.d1.prepare(`
        INSERT INTO repositories (id, owner_user_id, slug, visibility, storage_key, status)
        VALUES ('repo_nate_auth', 'usr_nate', 'dronehunter', 'public', 'repositories/repo_nate_auth', 'active')
      `).run();

      const authRes = await gitPost({
        request: gwRequest({
          action: 'gateway-authorize-ssh',
          keyType: KEY_TYPE,
          keyBase64: NATE_MIGRATED_B64,
          owner: 'nate',
          slug: 'dronehunter',
          operation: 'write'
        }),
        env
      } as any);
      const authData = await authRes.json();
      expect(authRes.status).toBe(200);
      expect(authData.success).toBe(true);
      expect(authData.actorUserId).toBe('usr_nate');
      expect(authData.memberRole).toBe('owner');
    });

    it('resolves actor via gateway-identify-ssh-key when key is registered in user_ssh_keys', async () => {
      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role, ssh_public_key)
        VALUES ('usr_multikey_only', 'multikey_user', 'Multikey User', 'maker', NULL)
      `).run();

      await ctx.d1.prepare(`
        INSERT INTO user_ssh_keys (id, user_id, key_type, key_base64, key_prefix, label)
        VALUES ('key_agent_1', 'usr_multikey_only', ?, ?, ?, 'agent-runner')
      `).bind(KEY_TYPE, MULTI_KEY_B64, `${KEY_TYPE} ${MULTI_KEY_B64}`).run();

      const res = await gitPost({
        request: gwRequest({
          action: 'gateway-identify-ssh-key',
          keyType: KEY_TYPE,
          keyBase64: MULTI_KEY_B64
        }),
        env
      } as any);

      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.actorUserId).toBe('usr_multikey_only');
    });

    it('REMOVED migrated key returns 401 from BOTH gateway actions (Proves #1 False Revocation Fixed)', async () => {
      // Usr_nate has migrated key in user_ssh_keys and users.ssh_public_key
      const sessionToken = 'tok_nate_removal_test';
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_nate', ?)
      `).bind(await hashSessionToken(sessionToken), Date.now() + 100000).run();

      // Nate removes his migrated key via profile API
      const removeReq = new Request('http://localhost/api/profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`
        },
        body: JSON.stringify({
          action: 'remove-ssh-key',
          id: 'key_migrated_usr_nate'
        })
      });
      const removeRes = await profileApi.onRequestPost({ request: removeReq, env: { DB: ctx.d1 } });
      const removeData = await removeRes.json();
      expect(removeRes.status).toBe(200);
      expect(removeData.removed).toBe(true);

      // Verify users.ssh_public_key was ALSO cleared
      const userRow = await ctx.d1.prepare('SELECT ssh_public_key FROM users WHERE id = ?').bind('usr_nate').first();
      expect((userRow as any).ssh_public_key).toBeNull();

      // 1. Identify action MUST return 401
      const identifyRes = await gitPost({
        request: gwRequest({
          action: 'gateway-identify-ssh-key',
          keyType: KEY_TYPE,
          keyBase64: NATE_MIGRATED_B64
        }),
        env
      } as any);
      expect(identifyRes.status).toBe(401);
      const identifyData = await identifyRes.json();
      expect(identifyData.error).toContain('SSH public key is not registered.');

      // 2. Authorize action MUST return 401
      await ctx.d1.prepare(`
        INSERT INTO repositories (id, owner_user_id, slug, visibility, storage_key, status)
        VALUES ('repo_nate_auth_revoked', 'usr_nate', 'dronehunter', 'public', 'repositories/repo_nate_auth_revoked', 'active')
      `).run();

      const authRes = await gitPost({
        request: gwRequest({
          action: 'gateway-authorize-ssh',
          keyType: KEY_TYPE,
          keyBase64: NATE_MIGRATED_B64,
          owner: 'nate',
          slug: 'dronehunter',
          operation: 'write'
        }),
        env
      } as any);
      expect(authRes.status).toBe(401);
      const authData = await authRes.json();
      expect(authData.error).toContain('SSH public key is not registered.');
    });

    it('rejects a key present ONLY in legacy users.ssh_public_key (Single Store Enforced, No Fallback)', async () => {
      // Legacy user inserted after migration, present only in users.ssh_public_key
      const UNMIGRATED_B64 = 'AAAAC3NzaC1lZDI1NTE5AAAAIUnmigratedLegacyKeyNotInNewTable123456';
      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role, ssh_public_key)
        VALUES ('usr_unmigrated', 'unmigrated', 'Unmigrated User', 'maker', ?)
      `).bind(`${KEY_TYPE} ${UNMIGRATED_B64} unmigrated@host`).run();

      const identifyRes = await gitPost({
        request: gwRequest({
          action: 'gateway-identify-ssh-key',
          keyType: KEY_TYPE,
          keyBase64: UNMIGRATED_B64
        }),
        env
      } as any);
      expect(identifyRes.status).toBe(401);

      const authRes = await gitPost({
        request: gwRequest({
          action: 'gateway-authorize-ssh',
          keyType: KEY_TYPE,
          keyBase64: UNMIGRATED_B64,
          owner: 'unmigrated',
          slug: 'test-repo',
          operation: 'read'
        }),
        env
      } as any);
      expect(authRes.status).toBe(401);
    });

    it('resolves exact owner unambiguously with NO cross-store wrong-user resolution possible', async () => {
      // Sam owns SECOND_KEY_B64 in user_ssh_keys
      await ctx.d1.prepare(`
        INSERT INTO user_ssh_keys (id, user_id, key_type, key_base64, key_prefix, label)
        VALUES ('key_sam_exact', 'usr_sam', ?, ?, ?, 'sam-laptop')
      `).bind(KEY_TYPE, SECOND_KEY_B64, `${KEY_TYPE} ${SECOND_KEY_B64}`).run();

      const res = await gitPost({
        request: gwRequest({
          action: 'gateway-identify-ssh-key',
          keyType: KEY_TYPE,
          keyBase64: SECOND_KEY_B64
        }),
        env
      } as any);

      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.actorUserId).toBe('usr_sam');
    });

    it('rejects malformed / oversized / unsupported-type identify requests with 400', async () => {
      // 1. Unsupported key type
      const unsupportedRes = await gitPost({
        request: gwRequest({
          action: 'gateway-identify-ssh-key',
          keyType: 'ssh-dss',
          keyBase64: MULTI_KEY_B64
        }),
        env
      } as any);
      expect(unsupportedRes.status).toBe(400);
      const unsupportedData = await unsupportedRes.json();
      expect(unsupportedData.error).toContain('Unsupported SSH public key type.');

      // 2. Malformed non-base64
      const malformedRes = await gitPost({
        request: gwRequest({
          action: 'gateway-identify-ssh-key',
          keyType: 'ssh-ed25519',
          keyBase64: 'INVALID!!BASE64^^'
        }),
        env
      } as any);
      expect(malformedRes.status).toBe(400);
      const malformedData = await malformedRes.json();
      expect(malformedData.error).toContain('Malformed SSH public key');

      // 3. Oversized (> 16384 chars)
      const oversizedRes = await gitPost({
        request: gwRequest({
          action: 'gateway-identify-ssh-key',
          keyType: 'ssh-ed25519',
          keyBase64: 'A'.repeat(16385)
        }),
        env
      } as any);
      expect(oversizedRes.status).toBe(400);
      const oversizedData = await oversizedRes.json();
      expect(oversizedData.error).toContain('Malformed SSH public key');
    });

    it('rejects malformed / unsupported authorize requests with 400', async () => {
      const res = await gitPost({
        request: gwRequest({
          action: 'gateway-authorize-ssh',
          keyType: 'invalid-type',
          keyBase64: MULTI_KEY_B64,
          owner: 'nate',
          slug: 'dronehunter',
          operation: 'read'
        }),
        env
      } as any);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('Unsupported SSH public key type.');
    });

    it('rejects unregistered key with 401 on both gateway actions', async () => {
      const UNKNOWN_KEY = 'AAAAC3NzaC1lZDI1NTE5AAAAIUnknownKeyNotRegisteredInAnyTable123456';

      const identifyRes = await gitPost({
        request: gwRequest({
          action: 'gateway-identify-ssh-key',
          keyType: KEY_TYPE,
          keyBase64: UNKNOWN_KEY
        }),
        env
      } as any);
      expect(identifyRes.status).toBe(401);
      const identifyData = await identifyRes.json();
      expect(identifyData.error).toContain('SSH public key is not registered.');

      const authRes = await gitPost({
        request: gwRequest({
          action: 'gateway-authorize-ssh',
          keyType: KEY_TYPE,
          keyBase64: UNKNOWN_KEY,
          owner: 'nate',
          slug: 'dronehunter',
          operation: 'read'
        }),
        env
      } as any);
      expect(authRes.status).toBe(401);
      const authData = await authRes.json();
      expect(authData.error).toContain('SSH public key is not registered.');
    });
  });

  // =========================================================================
  // 3. AUTHENTICATED PROFILE KEY MANAGEMENT (/api/profile)
  // =========================================================================
  describe('3. Authenticated Profile Key Management (/api/profile)', () => {
    const sessionToken = 'tok_nate_multikey_test';
    const secondUserToken = 'tok_sam_multikey_test';

    beforeEach(async () => {
      // Create session for usr_nate
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_nate', ?)
      `).bind(await hashSessionToken(sessionToken), Date.now() + 100000).run();

      // Create session for usr_sam
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_sam', ?)
      `).bind(await hashSessionToken(secondUserToken), Date.now() + 100000).run();
    });

    it('lists authenticated user keys via GET /api/profile?action=list-ssh-keys', async () => {
      const req = new Request('http://localhost/api/profile?action=list-ssh-keys', {
        method: 'GET',
        headers: { Authorization: `Bearer ${sessionToken}` }
      });
      const res = await profileApi.onRequestGet({ request: req, env: { DB: ctx.d1 } });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(Array.isArray(data.keys)).toBe(true);
      expect(data.keys.length).toBeGreaterThanOrEqual(1);

      const firstKey = data.keys[0];
      expect(firstKey.keyType).toBe('ssh-ed25519');
      expect(firstKey.fingerprint).toBeDefined();
      expect(firstKey.label).toBe('migrated');
    });

    it('rejects unauthenticated GET /api/profile?action=list-ssh-keys with 401', async () => {
      const req = new Request('http://localhost/api/profile?action=list-ssh-keys', {
        method: 'GET'
      });
      const res = await profileApi.onRequestGet({ request: req, env: { DB: ctx.d1 } });
      expect(res.status).toBe(401);
    });

    it('adds a new SSH key via POST add-ssh-key with keyType and keyBase64', async () => {
      const req = new Request('http://localhost/api/profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`
        },
        body: JSON.stringify({
          action: 'add-ssh-key',
          keyType: 'ssh-ed25519',
          keyBase64: 'AAAAC3NzaC1lZDI1NTE5AAAAINateAgentSecondKey123456789012345',
          label: 'Agent Key'
        })
      });
      const res = await profileApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      const data = await res.json();

      expect(res.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.key).toMatchObject({
        userId: 'usr_nate',
        keyType: 'ssh-ed25519',
        keyBase64: 'AAAAC3NzaC1lZDI1NTE5AAAAINateAgentSecondKey123456789012345',
        label: 'Agent Key'
      });
      expect(data.key.id).toMatch(/^key_/);

      // Verify user now has 2 keys
      const listReq = new Request('http://localhost/api/profile?action=list-ssh-keys', {
        headers: { Authorization: `Bearer ${sessionToken}` }
      });
      const listRes = await profileApi.onRequestGet({ request: listReq, env: { DB: ctx.d1 } });
      const listData = await listRes.json();
      expect(listData.keys.length).toBe(2);
    });

    it('adds a new SSH key via POST add-ssh-key with full publicKey string', async () => {
      const req = new Request('http://localhost/api/profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`
        },
        body: JSON.stringify({
          action: 'add-ssh-key',
          publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIWorkMacKey123456789012345 nate@work-mac'
        })
      });
      const res = await profileApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      const data = await res.json();

      expect(res.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.key.keyType).toBe('ssh-ed25519');
      expect(data.key.keyBase64).toBe('AAAAC3NzaC1lZDI1NTE5AAAAIWorkMacKey123456789012345');
      expect(data.key.label).toBe('nate@work-mac');
    });

    it('rejects malformed keyType with 400', async () => {
      const req = new Request('http://localhost/api/profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`
        },
        body: JSON.stringify({
          action: 'add-ssh-key',
          keyType: 'ssh-dss',
          keyBase64: 'AAAAC3NzaC1lZDI1NTE5AAAAIInvalidKey12345'
        })
      });
      const res = await profileApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('Unsupported SSH public key type.');
    });

    it('rejects malformed keyBase64 with 400', async () => {
      const req = new Request('http://localhost/api/profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`
        },
        body: JSON.stringify({
          action: 'add-ssh-key',
          keyType: 'ssh-ed25519',
          keyBase64: 'NOT_VALID_BASE64!@#$%^&*()'
        })
      });
      const res = await profileApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('Malformed SSH public key');
    });

    it('rejects duplicate key_prefix with 409 conflict without leaking owner', async () => {
      const keyBlob = 'AAAAC3NzaC1lZDI1NTE5AAAAIDuplicateTestKeyBlob12345678901';
      await ctx.d1.prepare(`
        INSERT INTO user_ssh_keys (id, user_id, key_type, key_base64, key_prefix, label)
        VALUES ('key_orig_dup', 'usr_nate', 'ssh-ed25519', ?, ?, 'original')
      `).bind(keyBlob, `ssh-ed25519 ${keyBlob}`).run();

      // Sam tries to register the exact same key
      const req = new Request('http://localhost/api/profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${secondUserToken}`
        },
        body: JSON.stringify({
          action: 'add-ssh-key',
          keyType: 'ssh-ed25519',
          keyBase64: keyBlob
        })
      });
      const res = await profileApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toBe('This SSH key is already registered.');
      expect(JSON.stringify(data)).not.toContain('usr_nate');
      expect(JSON.stringify(data)).not.toContain('nate');
    });

    it('allows a user to remove their own key via remove-ssh-key and clears users.ssh_public_key', async () => {
      const keyId = 'key_to_delete_nate';
      const keyPrefix = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDeleteMe';
      await ctx.d1.prepare(`
        INSERT INTO user_ssh_keys (id, user_id, key_type, key_base64, key_prefix, label)
        VALUES (?, 'usr_nate', 'ssh-ed25519', 'AAAAC3NzaC1lZDI1NTE5AAAAIDeleteMe', ?, 'temp')
      `).bind(keyId, keyPrefix).run();

      // Also set on users.ssh_public_key with a comment
      await ctx.d1.prepare(`
        UPDATE users SET ssh_public_key = ? WHERE id = 'usr_nate'
      `).bind(`${keyPrefix} nate@temp`).run();

      const req = new Request('http://localhost/api/profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`
        },
        body: JSON.stringify({
          action: 'remove-ssh-key',
          id: keyId
        })
      });
      const res = await profileApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.removed).toBe(true);

      const exists = await ctx.d1.prepare('SELECT id FROM user_ssh_keys WHERE id = ?').bind(keyId).first();
      expect(exists).toBeNull();

      const userRow = await ctx.d1.prepare('SELECT ssh_public_key FROM users WHERE id = ?').bind('usr_nate').first();
      expect((userRow as any).ssh_public_key).toBeNull();
    });

    it('prevents a user from deleting another user key (scoped deletion)', async () => {
      const nateKeyId = 'key_owned_by_nate';
      await ctx.d1.prepare(`
        INSERT INTO user_ssh_keys (id, user_id, key_type, key_base64, key_prefix, label)
        VALUES (?, 'usr_nate', 'ssh-ed25519', 'AAAAC3NzaC1lZDI1NTE5AAAAINateScopedKey', 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINateScopedKey', 'nate-key')
      `).bind(nateKeyId).run();

      // Sam attempts to delete Nate's key
      const req = new Request('http://localhost/api/profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${secondUserToken}`
        },
        body: JSON.stringify({
          action: 'remove-ssh-key',
          id: nateKeyId
        })
      });
      const res = await profileApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.removed).toBe(false);

      const stillExists = await ctx.d1.prepare('SELECT id FROM user_ssh_keys WHERE id = ?').bind(nateKeyId).first();
      expect(stillExists).not.toBeNull();
    });

    it('supports key removal via DELETE /api/profile and clears users.ssh_public_key', async () => {
      const keyId = 'key_delete_via_http_verb';
      const keyPrefix = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHttpVerbDelete';
      await ctx.d1.prepare(`
        INSERT INTO user_ssh_keys (id, user_id, key_type, key_base64, key_prefix, label)
        VALUES (?, 'usr_nate', 'ssh-ed25519', 'AAAAC3NzaC1lZDI1NTE5AAAAIHttpVerbDelete', ?, 'http-del')
      `).bind(keyId, keyPrefix).run();

      await ctx.d1.prepare(`
        UPDATE users SET ssh_public_key = ? WHERE id = 'usr_nate'
      `).bind(keyPrefix).run();

      const req = new Request(`http://localhost/api/profile?id=${keyId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${sessionToken}` }
      });
      const res = await profileApi.onRequestDelete({ request: req, env: { DB: ctx.d1 } });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.removed).toBe(true);

      const exists = await ctx.d1.prepare('SELECT id FROM user_ssh_keys WHERE id = ?').bind(keyId).first();
      expect(exists).toBeNull();

      const userRow = await ctx.d1.prepare('SELECT ssh_public_key FROM users WHERE id = ?').bind('usr_nate').first();
      expect((userRow as any).ssh_public_key).toBeNull();
    });

    it('legacy profile sshKey update writes through to user_ssh_keys', async () => {
      const req = new Request('http://localhost/api/profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`
        },
        body: JSON.stringify({
          displayName: 'Nate McGuire (Updated)',
          sshKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILegacyProfileUpdateKey12345 nate@laptop'
        })
      });
      const res = await profileApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.user.displayName).toBe('Nate McGuire (Updated)');
      expect(data.user.sshKey).toContain('AAAAC3NzaC1lZDI1NTE5AAAAILegacyProfileUpdateKey12345');

      // Verify written to users.ssh_public_key
      const userRow = await ctx.d1.prepare('SELECT ssh_public_key FROM users WHERE id = ?').bind('usr_nate').first();
      expect((userRow as any).ssh_public_key).toContain('AAAAC3NzaC1lZDI1NTE5AAAAILegacyProfileUpdateKey12345');

      // Verify written through to user_ssh_keys
      const keyRow = await ctx.d1.prepare('SELECT * FROM user_ssh_keys WHERE user_id = ?').bind('usr_nate').first();
      expect(keyRow).not.toBeNull();
      expect((keyRow as any).key_prefix).toBe('ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILegacyProfileUpdateKey12345');
    });

    it('legacy profile sshKey update collides (409) on another user registered key', async () => {
      // Nate already has a key in user_ssh_keys
      const nateKeyBlob = 'AAAAC3NzaC1lZDI1NTE5AAAAINateRegisteredKeyForCollision12345';
      await ctx.d1.prepare(`
        INSERT INTO user_ssh_keys (id, user_id, key_type, key_base64, key_prefix, label)
        VALUES ('key_nate_coll', 'usr_nate', 'ssh-ed25519', ?, ?, 'primary')
      `).bind(nateKeyBlob, `ssh-ed25519 ${nateKeyBlob}`).run();

      // Sam tries to update profile sshKey with Nate's key
      const req = new Request('http://localhost/api/profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${secondUserToken}`
        },
        body: JSON.stringify({
          displayName: 'Sam Altman',
          sshKey: `ssh-ed25519 ${nateKeyBlob} sam@stolen`
        })
      });
      const res = await profileApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toBe('This SSH key is already registered.');
      expect(JSON.stringify(data)).not.toContain('usr_nate');
      expect(JSON.stringify(data)).not.toContain('nate');
    });

    it('legacy profile sshKey update with empty string clears user_ssh_keys and users.ssh_public_key', async () => {
      const req = new Request('http://localhost/api/profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`
        },
        body: JSON.stringify({
          displayName: 'Nate McGuire (No Key)',
          sshKey: ''
        })
      });
      const res = await profileApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);

      const userRow = await ctx.d1.prepare('SELECT ssh_public_key FROM users WHERE id = ?').bind('usr_nate').first();
      expect((userRow as any).ssh_public_key).toBeNull();

      const keys = await ctx.d1.prepare('SELECT * FROM user_ssh_keys WHERE user_id = ?').bind('usr_nate').all();
      expect(keys.results?.length).toBe(0);
    });
  });
});
