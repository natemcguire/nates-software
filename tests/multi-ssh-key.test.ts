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

describe('Multi-SSH-Key Support Suite', () => {
  let ctx: TestD1Context;
  let env: any;

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
    env = { DB: ctx.d1, GITSMITH_GATEWAY_TOKEN: GATEWAY_SECRET };
  });

  // =========================================================================
  // 1. MIGRATION 0028 & BACKFILL
  // =========================================================================
  describe('1. Migration 0028 & Legacy Backfill', () => {
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

    it('executes migration 0028 on a database with custom legacy keys and properly splits them', async () => {
      // Create a database with migrations up to 0027
      const legacyMigrations = CANONICAL_MIGRATIONS.slice(
        0,
        CANONICAL_MIGRATIONS.indexOf('0028_user_ssh_keys.sql')
      );
      const legacyCtx = await createTestD1Database({
        foreignKeys: true,
        migrations: legacyMigrations
      });

      // Insert custom users with various key formats
      await legacyCtx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role, ssh_public_key)
        VALUES
          ('usr_alice', 'alice', 'Alice User', 'maker', 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQCalice alice@workstation'),
          ('usr_bob', 'bob', 'Bob User', 'maker', 'ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbob'),
          ('usr_carol', 'carol', 'Carol User', 'maker', '   ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIcarol carol@laptop   '),
          ('usr_empty', 'empty', 'Empty User', 'maker', '')
      `).run();

      // Execute migration 0028
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

      // Bob (without comment)
      expect(keyMap.get('usr_bob')).toMatchObject({
        user_id: 'usr_bob',
        key_type: 'ecdsa-sha2-nistp256',
        key_base64: 'AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbob',
        key_prefix: 'ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbob',
        label: 'migrated'
      });

      // Carol (with leading/trailing whitespace and comment)
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
  });

  // =========================================================================
  // 2. GIT ACTOR KEY RESOLUTION (gateway-identify-ssh-key & gateway-authorize-ssh)
  // =========================================================================
  describe('2. Git Actor Key Resolution (git.ts)', () => {
    const KEY_TYPE = 'ssh-ed25519';
    const MULTI_KEY_B64 = 'AAAAC3NzaC1lZDI1NTE5AAAAIMultiKeyBlobForAgent123456789012345678';
    const LEGACY_KEY_B64 = 'AAAAC3NzaC1lZDI1NTE5AAAAILegacyKeyBlobForMaker123456789012345678';

    it('resolves actor via gateway-identify-ssh-key when key is ONLY in user_ssh_keys', async () => {
      // User with NO legacy ssh_public_key
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

    it('resolves actor via gateway-identify-ssh-key when key is ONLY in legacy users.ssh_public_key (fallback intact)', async () => {
      // User with legacy ssh_public_key but NO user_ssh_keys row
      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role, ssh_public_key)
        VALUES ('usr_legacy_only', 'legacy_user', 'Legacy User', 'maker', ?)
      `).bind(`${KEY_TYPE} ${LEGACY_KEY_B64} user@legacy`).run();

      const res = await gitPost({
        request: gwRequest({
          action: 'gateway-identify-ssh-key',
          keyType: KEY_TYPE,
          keyBase64: LEGACY_KEY_B64
        }),
        env
      } as any);

      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.actorUserId).toBe('usr_legacy_only');
    });

    it('authorizes repository operation via gateway-authorize-ssh with a key in user_ssh_keys', async () => {
      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role, ssh_public_key)
        VALUES ('usr_repo_owner', 'repoowner', 'Repo Owner', 'maker', NULL)
      `).run();

      await ctx.d1.prepare(`
        INSERT INTO user_ssh_keys (id, user_id, key_type, key_base64, key_prefix, label)
        VALUES ('key_owner_1', 'usr_repo_owner', ?, ?, ?, 'primary-mac')
      `).bind(KEY_TYPE, MULTI_KEY_B64, `${KEY_TYPE} ${MULTI_KEY_B64}`).run();

      await ctx.d1.prepare(`
        INSERT INTO repositories (id, owner_user_id, slug, visibility, storage_key, status)
        VALUES ('repo_test_auth', 'usr_repo_owner', 'test-repo', 'private', 'repositories/repo_test_auth', 'active')
      `).run();

      const res = await gitPost({
        request: gwRequest({
          action: 'gateway-authorize-ssh',
          keyType: KEY_TYPE,
          keyBase64: MULTI_KEY_B64,
          owner: 'repoowner',
          slug: 'test-repo',
          operation: 'write'
        }),
        env
      } as any);

      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.actorUserId).toBe('usr_repo_owner');
      expect(data.memberRole).toBe('owner');
      expect(data.repositoryId).toBe('repo_test_auth');
    });

    it('authorizes repository operation via gateway-authorize-ssh with a legacy key fallback', async () => {
      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role, ssh_public_key)
        VALUES ('usr_legacy_owner', 'legacyowner', 'Legacy Owner', 'maker', ?)
      `).bind(`${KEY_TYPE} ${LEGACY_KEY_B64} legacy@host`).run();

      await ctx.d1.prepare(`
        INSERT INTO repositories (id, owner_user_id, slug, visibility, storage_key, status)
        VALUES ('repo_legacy_auth', 'usr_legacy_owner', 'legacy-repo', 'private', 'repositories/repo_legacy_auth', 'active')
      `).run();

      const res = await gitPost({
        request: gwRequest({
          action: 'gateway-authorize-ssh',
          keyType: KEY_TYPE,
          keyBase64: LEGACY_KEY_B64,
          owner: 'legacyowner',
          slug: 'legacy-repo',
          operation: 'read'
        }),
        env
      } as any);

      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.actorUserId).toBe('usr_legacy_owner');
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
          keyType: 'ssh-dss', // Disallowed type
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
      expect(data.error).toContain('Malformed SSH public key base64 blob.');
    });

    it('rejects duplicate key_prefix with 409 conflict without leaking owner', async () => {
      // Register a key for usr_nate first
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
      // Ensure error does not reveal usr_nate's identity
      expect(JSON.stringify(data)).not.toContain('usr_nate');
      expect(JSON.stringify(data)).not.toContain('nate');
    });

    it('allows a user to remove their own key via remove-ssh-key', async () => {
      const keyId = 'key_to_delete_nate';
      await ctx.d1.prepare(`
        INSERT INTO user_ssh_keys (id, user_id, key_type, key_base64, key_prefix, label)
        VALUES (?, 'usr_nate', 'ssh-ed25519', 'AAAAC3NzaC1lZDI1NTE5AAAAIDeleteMe', 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDeleteMe', 'temp')
      `).bind(keyId).run();

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
    });

    it('prevents a user from deleting another user key (scoped deletion)', async () => {
      // Nate owns a key
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
      expect(data.removed).toBe(false); // 0 rows affected

      // Verify Nate's key is still present in storage
      const stillExists = await ctx.d1.prepare('SELECT id FROM user_ssh_keys WHERE id = ?').bind(nateKeyId).first();
      expect(stillExists).not.toBeNull();
    });

    it('supports key removal via DELETE /api/profile', async () => {
      const keyId = 'key_delete_via_http_verb';
      await ctx.d1.prepare(`
        INSERT INTO user_ssh_keys (id, user_id, key_type, key_base64, key_prefix, label)
        VALUES (?, 'usr_nate', 'ssh-ed25519', 'AAAAC3NzaC1lZDI1NTE5AAAAIHttpVerbDelete', 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHttpVerbDelete', 'http-del')
      `).bind(keyId).run();

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
    });

    it('preserves legacy single sshKey profile update path', async () => {
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

      const userRow = await ctx.d1.prepare('SELECT ssh_public_key FROM users WHERE id = ?').bind('usr_nate').first();
      expect((userRow as any).ssh_public_key).toContain('AAAAC3NzaC1lZDI1NTE5AAAAILegacyProfileUpdateKey12345');
    });
  });
});
