import { describe, it, expect, beforeEach } from 'vitest';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';
import * as dynoApi from '../functions/api/dyno';
import { onRequestGet as badgeGet } from '../functions/badge/[user]';
import {
  NEUTRAL_DEV_FIXTURES,
  CANONICAL_DYNO_SUITE_ID,
  CANONICAL_DYNO_SUITE_SLUG,
  CANONICAL_DYNO_SUITE_VERSION,
  CANONICAL_DYNO_TASK_MANIFEST_DIGEST,
  CANONICAL_DYNO_GRADER_VERSION,
  calculateDynoScore,
  sha256Json
} from '../src/lib/dyno';

describe('DYNO Canonical API & Ingestion Pipeline (/api/dyno)', () => {
  let ctx: TestD1Context;

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
  });

  function generateValidRunPayload(overrideScore?: number) {
    const runId = `run_test_${Date.now()}`;
    const timestamp = new Date().toISOString();

    const attempts = NEUTRAL_DEV_FIXTURES.map((f) => {
      const isPassed = true;
      const attemptId = `att_${runId}_${f.key}_1`;
      const durationMs = 15000;

      return {
        attempt: {
          id: attemptId,
          run_id: runId,
          task_id: f.key,
          attempt_number: 1,
          status: isPassed ? 'passed' : 'failed',
          first_attempt_success: isPassed ? 1 : 0,
          hidden_tests_passed: f.hiddenTests.length,
          hidden_tests_total: f.hiddenTests.length,
          duration_ms: durationMs,
          input_tokens: 1500,
          output_tokens: 250,
          cached_input_tokens: 800,
          cost_micros: 4500,
          tool_calls: 4,
          human_interventions: 0,
          unnecessary_files_changed: 0,
          safety_violations: 0,
          instruction_score: isPassed ? 100 : 0,
          result_digest: sha256Json({ task: f.key, status: isPassed, runId }),
          started_at: timestamp,
          completed_at: timestamp
        },
        graderResults: f.graders.map(grader => ({
            id: `grader_${attemptId}_${grader.key}`,
            grader_key: grader.key,
            grader_version: grader.version,
            passed: isPassed ? 1 : 0,
            score: isPassed ? 1 : 0,
            max_score: 1,
            evidence_digest: sha256Json({ task: f.key, passed: isPassed }),
            detail: isPassed ? '[PASS] Invariant verified' : '[FAIL] Verification failed'
          })),
        toolEvents: [
          {
            id: `te_${attemptId}_0`,
            sequence_number: 0,
            tool_name: 'read_file',
            command_class: 'fs_read',
            started_offset_ms: 100,
            input_digest: sha256Json({ path: 'src/file.js' }),
            safety_classification: 'allowed'
          }
        ]
      };
    });

    const passedCount = attempts.filter(a => a.attempt.status === 'passed').length;
    const scoreCalc = calculateDynoScore({
      tasksCompleted: passedCount,
      totalTasks: attempts.length,
      firstAttemptSuccessRate: passedCount / attempts.length,
      hiddenTestsPassedRate: passedCount / attempts.length,
      medianCompletionSeconds: 15,
      humanInterventions: 0,
      safetyViolations: 0,
      unnecessaryFilesChanged: 0
    });

    const rawTraceSha256 = sha256Json(attempts.map(a => ({
      attemptId: a.attempt.id,
      toolEvents: a.toolEvents,
      graderResults: a.graderResults,
      digest: a.attempt.result_digest
    })));
    const attestationDigest = sha256Json({
      runId,
      score: scoreCalc.score,
      rawTraceSha256,
      timestamp
    });

    return {
      run: {
        id: runId,
        suite_id: CANONICAL_DYNO_SUITE_ID,
        subject_id: 'subj_claude37_test',
        environment_id: 'env_macos_test',
        submitted_by_user_id: 'usr_nate',
        repetition: 1,
        randomization_seed: 'seed_test_123',
        status: 'completed',
        verification_status: 'unverified',
        overall_score: overrideScore !== undefined ? overrideScore : scoreCalc.score,
        total_cost_micros: attempts.length * 4500,
        total_tokens: attempts.length * 1750,
        runner_attestation_digest: attestationDigest,
        raw_trace_sha256: rawTraceSha256,
        started_at: timestamp,
        completed_at: timestamp
      },
      subject: {
        id: 'subj_claude37_test',
        model_provider: 'anthropic',
        model_id: 'claude-3-7-sonnet',
        model_version: '20260228',
        model_config: JSON.stringify({ temperature: 0.2 }),
        agent_harness: 'antigravity-cli',
        harness_version: '2.4.0',
        tool_manifest: JSON.stringify(['read_file', 'write_file', 'exec'])
      },
      environment: {
        id: 'env_macos_test',
        os_name: 'macOS',
        os_version: '15.3.1',
        architecture: 'arm64',
        cpu_model: 'Apple M4 Max',
        memory_bytes: 68719476736,
        container_image_digest: sha256Json({ base: 'darwin-local-runner' }),
        runtime_manifest: JSON.stringify({ nodeVersion: 'v25.9.0' }),
        network_policy: 'none'
      },
      suite: {
        id: CANONICAL_DYNO_SUITE_ID,
        slug: CANONICAL_DYNO_SUITE_SLUG,
        version: CANONICAL_DYNO_SUITE_VERSION,
        name: 'DYNO Real-World Developer Tasks Benchmark',
        task_manifest_digest: CANONICAL_DYNO_TASK_MANIFEST_DIGEST,
        grader_version: CANONICAL_DYNO_GRADER_VERSION
      },
      attempts,
      expectedScore: scoreCalc.score
    };
  }

  describe('GET /api/dyno Contracts', () => {
    it('should return truthful empty leaderboard when no runs exist in D1', async () => {
      const req = new Request('http://localhost/api/dyno', { method: 'GET' });
      const res = await dynoApi.onRequestGet({ request: req, env: { DB: ctx.d1 } });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.leaderboard).toEqual([]);
      expect(data.count).toBe(0);
      expect(data.suite).toMatchObject({
        id: CANONICAL_DYNO_SUITE_ID,
        slug: CANONICAL_DYNO_SUITE_SLUG,
        version: CANONICAL_DYNO_SUITE_VERSION,
        status: 'active',
        task_manifest_digest: CANONICAL_DYNO_TASK_MANIFEST_DIGEST,
        grader_version: CANONICAL_DYNO_GRADER_VERSION
      });
    });

    it('should reject deprecated /api/dyno?bench=true with 400 and honest error', async () => {
      const req = new Request('http://localhost/api/dyno?bench=true', { method: 'GET' });
      const res = await dynoApi.onRequestGet({ request: req, env: { DB: ctx.d1 } });
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('Hardware throughput bench is deprecated');
    });

    it('should return 404 for non-existent run ID', async () => {
      const req = new Request('http://localhost/api/dyno?runId=non_existent_run', { method: 'GET' });
      const res = await dynoApi.onRequestGet({ request: req, env: { DB: ctx.d1 } });
      const data = await res.json();

      expect(res.status).toBe(404);
      expect(data.success).toBe(false);
      expect(data.error).toContain('not found');
    });

    it('ranks only within one explicit suite version and keeps historical suites queryable', async () => {
      const payload = generateValidRunPayload();
      const post = await dynoApi.onRequestPost({
        request: new Request('http://localhost/api/dyno', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test_token_nate' },
          body: JSON.stringify(payload)
        }),
        env: { DB: ctx.d1 }
      });
      expect(post.status).toBe(200);
      await ctx.d1.prepare("UPDATE dyno_runs SET verification_status = 'reproducible' WHERE id = ?")
        .bind(payload.run.id).run();
      await ctx.d1.batch([
        ctx.d1.prepare(`INSERT INTO dyno_suites
          (id, slug, version, name, methodology_markdown, task_manifest_digest, grader_version, status, published_at)
          VALUES ('suite_dyno_older', 'dyno-standard-dev', '2025.9', 'Older DYNO Course', 'old', ?, ?, 'retired', '2025-09-01')`)
          .bind('a'.repeat(64), CANONICAL_DYNO_GRADER_VERSION),
        ctx.d1.prepare(`INSERT INTO dyno_runs
          (id, suite_id, subject_id, environment_id, submitted_by_user_id, repetition, randomization_seed,
           status, verification_status, evaluation_class, overall_score, runner_attestation_digest, raw_trace_sha256)
          SELECT 'run_older_course', 'suite_dyno_older', subject_id, environment_id, submitted_by_user_id,
            1, 'old-seed', 'completed', 'reproducible', 'reproduced', 1000, runner_attestation_digest, raw_trace_sha256
          FROM dyno_runs WHERE id = ?`).bind(payload.run.id)
      ]);

      const current: any = await (await dynoApi.onRequestGet({
        request: new Request('http://localhost/api/dyno'), env: { DB: ctx.d1 }
      })).json();
      expect(current.suite.id).toBe(payload.suite.id);
      expect(current.leaderboard.map((run: any) => run.id)).toEqual([payload.run.id]);

      const historical: any = await (await dynoApi.onRequestGet({
        request: new Request('http://localhost/api/dyno?suiteId=suite_dyno_older'), env: { DB: ctx.d1 }
      })).json();
      expect(historical.suite.version).toBe('2025.9');
      expect(historical.leaderboard.map((run: any) => run.id)).toEqual(['run_older_course']);
    });
  });

  describe('POST /api/dyno Ingestion & Deterministic Validation Contracts', () => {
    it('should reject unauthenticated submissions with 401 when no session exists', async () => {
      const origEnv = process.env.NODE_ENV;
      const origVitest = (process.env as any).VITEST;
      delete (process.env as any).NODE_ENV;
      delete (process.env as any).VITEST;

      try {
        const payload = generateValidRunPayload();
        const req = new Request('http://localhost/api/dyno', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const res = await dynoApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
        expect(res.status).toBe(401);
        const data = await res.json();
        expect(data.success).toBe(false);
        expect(data.error).toContain('Unauthorized');
      } finally {
        process.env.NODE_ENV = origEnv;
        (process.env as any).VITEST = origVitest;
      }
    });

    it('should reject malformed or missing payloads with 400', async () => {
      const req = new Request('http://localhost/api/dyno', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test_token_nate'
        },
        body: JSON.stringify({ invalid: 'payload' })
      });

      const res = await dynoApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Invalid payload structure');
    });

    it('should reject uncompleted run status with 400', async () => {
      const payload = generateValidRunPayload();
      (payload.run as any).status = 'running';

      const req = new Request('http://localhost/api/dyno', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test_token_nate'
        },
        body: JSON.stringify(payload)
      });

      const res = await dynoApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Only completed runs can be submitted');
    });

    it('should reject invalid or missing cryptographic attestation digests with 400', async () => {
      const payload = generateValidRunPayload();
      payload.run.runner_attestation_digest = 'not_a_valid_64_char_hex_hash';

      const req = new Request('http://localhost/api/dyno', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test_token_nate'
        },
        body: JSON.stringify(payload)
      });

      const res = await dynoApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('runner_attestation_digest must be a valid 64-character SHA-256');
    });

    it('should reject caller-defined suites and incomplete canonical provenance', async () => {
      const payload = generateValidRunPayload();
      payload.suite.slug = 'caller-controlled-suite';

      const req = new Request('http://localhost/api/dyno', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test_token_nate'
        },
        body: JSON.stringify(payload)
      });
      const res = await dynoApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain('only accepts canonical suite');
    });

    it('should reject fabricated/tampered scores where overall_score does not match attempt evidence', async () => {
      const payload = generateValidRunPayload(995);

      const req = new Request('http://localhost/api/dyno', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test_token_nate'
        },
        body: JSON.stringify(payload)
      });

      const res = await dynoApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Deterministic score validation failed');
    });

    it('should persist valid completed run into canonical D1 tables and query it via leaderboard & run detail', async () => {
      const payload = generateValidRunPayload();

      const postReq = new Request('http://localhost/api/dyno', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test_token_nate'
        },
        body: JSON.stringify(payload)
      });

      const postRes = await dynoApi.onRequestPost({ request: postReq, env: { DB: ctx.d1 } });
      expect(postRes.status).toBe(200);
      const postData = await postRes.json();

      expect(postData.success).toBe(true);
      expect(postData.runId).toBe(payload.run.id);
      expect(postData.score).toBe(payload.expectedScore);

      const runInDb = await ctx.d1.prepare('SELECT * FROM dyno_runs WHERE id = ?').bind(payload.run.id).first();
      expect(runInDb).not.toBeNull();
      expect((runInDb as any).overall_score).toBe(payload.expectedScore);
      expect((runInDb as any).status).toBe('completed');

      const attemptsInDb = await ctx.d1.prepare('SELECT * FROM dyno_task_attempts WHERE run_id = ?').bind(payload.run.id).all();
      expect(attemptsInDb.results?.length).toBe(NEUTRAL_DEV_FIXTURES.length);

      const gradersInDb = await ctx.d1.prepare('SELECT * FROM dyno_grader_results WHERE task_attempt_id = ?').bind(payload.attempts[0].attempt.id).all();
      expect(gradersInDb.results?.length).toBeGreaterThan(0);

      const lbReq = new Request('http://localhost/api/dyno', { method: 'GET' });
      const lbRes = await dynoApi.onRequestGet({ request: lbReq, env: { DB: ctx.d1 } });
      const lbData = await lbRes.json();

      expect(lbData.success).toBe(true);
      expect(lbData.count).toBe(0);
      expect(lbData.leaderboard).toEqual([]);

      const publicDetailReq = new Request(`http://localhost/api/dyno?runId=${payload.run.id}`);
      const publicDetailRes = await dynoApi.onRequestGet({ request: publicDetailReq, env: { DB: ctx.d1 } });
      expect(publicDetailRes.status).toBe(404);

      const detailReq = new Request(`http://localhost/api/dyno?runId=${payload.run.id}`, {
        headers: { Authorization: 'Bearer test_token_nate' }
      });
      const detailRes = await dynoApi.onRequestGet({ request: detailReq, env: { DB: ctx.d1 } });
      const detailData = await detailRes.json();

      expect(detailData.success).toBe(true);
      expect(detailData.run.id).toBe(payload.run.id);
      expect(detailData.run.attempts.length).toBe(NEUTRAL_DEV_FIXTURES.length);
      expect(detailData.run.attempts[0].grader_results.length).toBeGreaterThan(0);
    });

    it('rejects a trace commitment that does not match canonical evidence', async () => {
      const payload = generateValidRunPayload();
      payload.run.raw_trace_sha256 = '0'.repeat(64);
      const req = new Request('http://localhost/api/dyno', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test_token_nate' },
        body: JSON.stringify(payload)
      });
      const response = await dynoApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      expect(response.status).toBe(400);
      expect((await response.json() as any).error).toContain('does not match');
      expect(await ctx.d1.prepare('SELECT id FROM dyno_runs WHERE id = ?').bind(payload.run.id).first()).toBeNull();
    });

    it('stores validated trace evidence under a server-owned object key', async () => {
      const payload = generateValidRunPayload();
      (payload.run as any).raw_trace_r2_key = 'attacker/chosen-key.json';
      const writes: Array<{ key: string; body: string }> = [];
      const storage = {
        put: async (key: string, body: string) => { writes.push({ key, body }); },
        delete: async () => undefined
      };
      const req = new Request('http://localhost/api/dyno', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test_token_nate' },
        body: JSON.stringify(payload)
      });
      const response = await dynoApi.onRequestPost({ request: req, env: { DB: ctx.d1, STORAGE: storage } });
      expect(response.status).toBe(200);
      expect(writes).toHaveLength(1);
      expect(writes[0].key).toContain(`dyno/traces/usr_nate/${payload.run.id}/`);
      expect(writes[0].key).not.toContain('attacker');
      expect(JSON.parse(writes[0].body)).toHaveLength(NEUTRAL_DEV_FIXTURES.length);
      const row: any = await ctx.d1.prepare('SELECT raw_trace_r2_key FROM dyno_runs WHERE id = ?').bind(payload.run.id).first();
      expect(row.raw_trace_r2_key).toBe(writes[0].key);
    });
  });

  describe('GET /badge/:user Dynamic SVG Badge Contracts', () => {
    it('should return UNSCORED badge when user has no completed DYNO runs', async () => {
      const res = await badgeGet({ params: { user: 'nate' }, env: { DB: ctx.d1 } });
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('image/svg+xml');

      const svgText = await res.text();
      expect(svgText).toContain('DYNO DEV SCORE');
      expect(svgText).toContain('UNSCORED');
    });

    it('should keep badge unscored for self-reported runs', async () => {
      const payload = generateValidRunPayload();

      const postReq = new Request('http://localhost/api/dyno', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test_token_nate'
        },
        body: JSON.stringify(payload)
      });

      const postRes = await dynoApi.onRequestPost({ request: postReq, env: { DB: ctx.d1 } });
      expect(postRes.status).toBe(200);

      const res1 = await badgeGet({ params: { user: 'nate.svg' }, env: { DB: ctx.d1 } });
      expect(res1.status).toBe(200);
      const svgText1 = await res1.text();

      expect(svgText1).toContain('DYNO DEV SCORE');
      expect(svgText1).toContain('UNSCORED');

      const res2 = await badgeGet({ params: { user: '@nate' }, env: { DB: ctx.d1 } });
      expect(res2.status).toBe(200);
      const svgText2 = await res2.text();
      expect(svgText2).toContain('UNSCORED');
    });
  });
});
