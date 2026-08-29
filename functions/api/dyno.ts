// Cloudflare Pages Functions API: /api/dyno
// Canonical DYNO AI Developer Benchmark Endpoint
// Strictly adheres to migrations/0007_dyno_real_world_benchmarks.sql
// Enforces canonical manifests, D1 batch atomicity, and privacy minimization.

import { requireAuth } from './_auth';
import {
  NEUTRAL_DEV_FIXTURES,
  CANONICAL_DYNO_SUITE_ID,
  CANONICAL_DYNO_SUITE_SLUG,
  CANONICAL_DYNO_SUITE_VERSION,
  CANONICAL_DYNO_SUITE_NAME,
  CANONICAL_DYNO_SUITE_METHODOLOGY,
  CANONICAL_DYNO_GRADER_VERSION,
  CANONICAL_DYNO_TASK_MANIFEST_DIGEST,
  CANONICAL_TASK_MAP,
  computePromptDigest,
  computeFixtureDigest,
  computeGraderManifestDigest
} from '../../src/lib/dyno/fixtures';
import { calculateDynoScore, calculateMedian } from '../../src/lib/dyno/scoring';
import { sha256Json } from '../../src/lib/dyno/crypto';

const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/i;
const ID_REGEX = /^[a-zA-Z0-9_-]{4,128}$/;
const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024; // 5 MB

const canonicalSuiteSummary = () => ({
  id: CANONICAL_DYNO_SUITE_ID,
  slug: CANONICAL_DYNO_SUITE_SLUG,
  version: CANONICAL_DYNO_SUITE_VERSION,
  name: CANONICAL_DYNO_SUITE_NAME,
  status: 'active',
  published_at: null,
  task_manifest_digest: CANONICAL_DYNO_TASK_MANIFEST_DIGEST,
  grader_version: CANONICAL_DYNO_GRADER_VERSION
});

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
  try {
    const url = new URL(request.url);
    const isBench = url.searchParams.get('bench') === 'true';

    // Deprecated hardware bench parameter
    if (isBench) {
      return Response.json(
        {
          success: false,
          error: 'Hardware throughput bench is deprecated. DYNO evaluates model + agent harness + tools on real-world developer tasks via local CLI.'
        },
        { status: 400 }
      );
    }

    const runId = url.searchParams.get('runId') || url.searchParams.get('id');

    // Query single run details with attempts & grader results
    if (runId) {
      if (!ID_REGEX.test(runId)) {
        return Response.json({ success: false, error: 'Invalid run ID format' }, { status: 400 });
      }

      if (env && env.DB) {
        const run = await env.DB.prepare(`
          SELECT r.id, r.suite_id, r.subject_id, r.environment_id, r.submitted_by_user_id,
                 r.repetition, r.randomization_seed, r.status, r.verification_status,
                 r.evaluation_class, r.official_evaluator, r.official_published_at,
                 r.overall_score, r.total_cost_micros, r.total_tokens,
                 r.runner_attestation_digest, r.raw_trace_sha256, r.raw_trace_r2_key,
                 r.started_at, r.completed_at, r.created_at,
                 s.model_provider, s.model_id, s.model_version, s.model_config,
                 s.agent_harness, s.harness_version, s.tool_manifest,
                 e.os_name, e.os_version, e.architecture, e.cpu_model, e.accelerator_model,
                 e.memory_bytes, e.container_image_digest, e.runtime_manifest, e.network_policy,
                 su.name AS suite_name, su.version AS suite_version, su.slug AS suite_slug,
                 u.username, u.display_name, u.avatar_url
          FROM dyno_runs r
          JOIN dyno_subjects s ON r.subject_id = s.id
          JOIN dyno_environments e ON r.environment_id = e.id
          JOIN dyno_suites su ON r.suite_id = su.id
          LEFT JOIN users u ON r.submitted_by_user_id = u.id
          WHERE r.id = ?
        `).bind(runId).first();

        if (!run) {
          return Response.json({ success: false, error: 'Benchmark run not found' }, { status: 404 });
        }

        // Check requester authorization for full detailed access vs sanitized public access
        let isAuthorizedOwner = false;
        try {
          const { user } = await requireAuth(request, env);
          if (user && (user.id === run.submitted_by_user_id || user.role === 'admin')) {
            isAuthorizedOwner = true;
          }
        } catch {
          // Unauthenticated or invalid session
        }

        if (!isAuthorizedOwner && !['reproducible', 'verified'].includes(String(run.verification_status))) {
          return Response.json(
            { success: false, error: 'This self-reported run is private until independently reproduced' },
            { status: 404 }
          );
        }

        // Sanitize sensitive configs for unauthenticated / non-owner viewers
        const sanitizedRun = { ...run };
        if (!isAuthorizedOwner) {
          sanitizedRun.raw_trace_r2_key = null;
          // Redact raw model_config internals, preserving only non-sensitive summary
          sanitizedRun.model_config = '{}';
          // Sanitize runtime_manifest to only safe version fields
          try {
            const parsedRuntime = typeof run.runtime_manifest === 'string' ? JSON.parse(run.runtime_manifest) : (run.runtime_manifest || {});
            sanitizedRun.runtime_manifest = JSON.stringify({ nodeVersion: parsedRuntime.nodeVersion || 'unknown' });
          } catch {
            sanitizedRun.runtime_manifest = '{}';
          }
        }

        const attemptsQuery = await env.DB.prepare(`
          SELECT a.id, a.task_id, a.attempt_number, a.status, a.first_attempt_success,
                 a.hidden_tests_passed, a.hidden_tests_total, a.duration_ms,
                 a.input_tokens, a.output_tokens, a.cached_input_tokens, a.cost_micros,
                 a.tool_calls, a.human_interventions, a.unnecessary_files_changed,
                 a.safety_violations, a.instruction_score, a.result_digest,
                 a.started_at, a.completed_at
          FROM dyno_task_attempts a
          WHERE a.run_id = ?
          ORDER BY a.attempt_number ASC, a.started_at ASC
        `).bind(runId).all();

        const attempts = attemptsQuery.results || [];

        // Attach grader results for each attempt
        for (const attempt of attempts as any[]) {
          const gradersQuery = await env.DB.prepare(`
            SELECT id, grader_key, grader_version, passed, score, max_score, evidence_digest, detail, created_at
            FROM dyno_grader_results
            WHERE task_attempt_id = ?
            ORDER BY grader_key ASC
          `).bind(attempt.id).all();
          attempt.grader_results = gradersQuery.results || [];
        }

        return Response.json({
          success: true,
          run: {
            ...sanitizedRun,
            attempts
          }
        });
      }

      return Response.json({ success: false, error: 'Benchmark run not found (Database unavailable)' }, { status: 404 });
    }

    // Default: Query leaderboard with comparison-safe aggregate provenance ONLY
    if (env && env.DB) {
      const requestedSuiteId = url.searchParams.get('suiteId')?.trim() || '';
      if (requestedSuiteId && !ID_REGEX.test(requestedSuiteId)) {
        return Response.json({ success: false, error: 'Invalid suite ID format' }, { status: 400 });
      }
      const storedSuite = requestedSuiteId
        ? await env.DB.prepare(`SELECT id, slug, version, name, status, published_at
            FROM dyno_suites WHERE id = ? AND status IN ('active', 'retired')`).bind(requestedSuiteId).first()
        : await env.DB.prepare(`SELECT id, slug, version, name, status, published_at,
                   task_manifest_digest, grader_version
            FROM dyno_suites WHERE id = ? AND status = 'active'`).bind(CANONICAL_DYNO_SUITE_ID).first();
      if (requestedSuiteId && !storedSuite) {
        return Response.json({ success: false, error: 'Published DYNO suite not found' }, { status: 404 });
      }
      const suite = storedSuite || canonicalSuiteSummary();
      const { results } = await env.DB.prepare(`
        SELECT r.id, r.suite_id, r.repetition, r.status, r.verification_status,
               r.evaluation_class, r.official_evaluator, r.official_published_at,
               r.overall_score, r.started_at, r.completed_at, r.created_at,
               s.model_provider, s.model_id, s.model_version,
               s.agent_harness, s.harness_version,
               e.os_name, e.architecture,
               su.name AS suite_name, su.version AS suite_version, su.slug AS suite_slug,
               u.username, u.display_name, u.avatar_url,
               (SELECT count(*) FROM dyno_task_attempts a WHERE a.run_id = r.id) AS total_attempts,
               (SELECT count(*) FROM dyno_task_attempts a WHERE a.run_id = r.id AND a.status = 'passed') AS passed_attempts
        FROM dyno_runs r
        JOIN dyno_subjects s ON r.subject_id = s.id
        JOIN dyno_environments e ON r.environment_id = e.id
        JOIN dyno_suites su ON r.suite_id = su.id
        LEFT JOIN users u ON r.submitted_by_user_id = u.id
        WHERE r.status = 'completed'
          AND r.suite_id = ?
          AND r.verification_status IN ('reproducible', 'verified')
        ORDER BY r.overall_score DESC, r.created_at DESC
        LIMIT 50
      `).bind(suite.id).all();

      return Response.json({
        success: true,
        leaderboard: results || [],
        count: (results || []).length,
        suite
      });
    }

    // Truthful empty state when database is not connected
    return Response.json({
      success: true,
      leaderboard: [],
      count: 0,
      suite: canonicalSuiteSummary()
    });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
};

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  try {
    // 1. Enforce Authenticated Session
    const { user, errorResponse } = await requireAuth(request, env);
    if (errorResponse || !user) {
      return errorResponse || Response.json(
        { success: false, error: 'Unauthorized: Valid authenticated session required to submit DYNO benchmark runs' },
        { status: 401 }
      );
    }

    // 2. Enforce Payload Size Limit & JSON Parsing
    const contentLength = request.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_PAYLOAD_BYTES) {
      return Response.json({ success: false, error: 'Payload size exceeds 5MB limit' }, { status: 413 });
    }

    let payload: any;
    try {
      const rawBody = await request.text();
      if (new TextEncoder().encode(rawBody).byteLength > MAX_PAYLOAD_BYTES) {
        return Response.json({ success: false, error: 'Payload size exceeds 5MB limit' }, { status: 413 });
      }
      payload = JSON.parse(rawBody);
    } catch {
      return Response.json({ success: false, error: 'Invalid JSON payload' }, { status: 400 });
    }

    if (!payload || typeof payload !== 'object') {
      return Response.json({ success: false, error: 'Missing run execution payload' }, { status: 400 });
    }

    const { run, subject, environment, suite, attempts } = payload;

    // Validate top-level structure
    if (!run || !subject || !environment || !suite || !Array.isArray(attempts) || attempts.length === 0) {
      return Response.json({
        success: false,
        error: 'Invalid payload structure: run, subject, environment, suite, and non-empty attempts array are required'
      }, { status: 400 });
    }

    // Reject non-submittable schema/doc examples
    if (run.id === 'run_example_non_submittable_doc_only' || payload.is_example === true) {
      return Response.json({
        success: false,
        error: 'Cannot submit non-submittable schema example. Please run a real local benchmark via ./bin/slop dyno.'
      }, { status: 400 });
    }

    // 3. Enforce Canonical Built-in Suite & Manifest (Requirement 3)
    if (
      suite.id !== CANONICAL_DYNO_SUITE_ID ||
      suite.slug !== CANONICAL_DYNO_SUITE_SLUG ||
      suite.version !== CANONICAL_DYNO_SUITE_VERSION
    ) {
      return Response.json({
        success: false,
        error: `Invalid suite: server only accepts canonical suite "${CANONICAL_DYNO_SUITE_ID}" (slug: ${CANONICAL_DYNO_SUITE_SLUG}, version: ${CANONICAL_DYNO_SUITE_VERSION}). Custom caller-defined suites are rejected.`
      }, { status: 400 });
    }

    if (suite.task_manifest_digest !== CANONICAL_DYNO_TASK_MANIFEST_DIGEST) {
      return Response.json({
        success: false,
        error: 'Invalid suite task_manifest_digest: does not match canonical task suite digest.'
      }, { status: 400 });
    }

    if (suite.grader_version !== CANONICAL_DYNO_GRADER_VERSION) {
      return Response.json({
        success: false,
        error: `Invalid suite grader_version: expected "${CANONICAL_DYNO_GRADER_VERSION}".`
      }, { status: 400 });
    }

    // 4. Validate Run Record & Bounds (Requirement 4)
    if (!run.id || typeof run.id !== 'string' || !ID_REGEX.test(run.id)) {
      return Response.json({ success: false, error: 'run.id is required and must be alphanumeric (4-128 chars)' }, { status: 400 });
    }

    if (run.status !== 'completed') {
      return Response.json({
        success: false,
        error: `Only completed runs can be submitted. Received run status: ${run.status}`
      }, { status: 400 });
    }

    const repetitions = typeof run.repetition === 'number' ? Math.floor(run.repetition) : 1;
    if (repetitions < 1 || repetitions > 5) {
      return Response.json({
        success: false,
        error: `Invalid repetition count: ${run.repetition}. Must be an integer between 1 and 5.`
      }, { status: 400 });
    }

    const randomizationSeed = String(run.randomization_seed || '').trim();
    if (!randomizationSeed || randomizationSeed.length > 128) {
      return Response.json({ success: false, error: 'run.randomization_seed is required (max 128 chars)' }, { status: 400 });
    }

    if (!run.runner_attestation_digest || !SHA256_HEX_REGEX.test(run.runner_attestation_digest)) {
      return Response.json({
        success: false,
        error: 'run.runner_attestation_digest must be a valid 64-character SHA-256 hex string'
      }, { status: 400 });
    }

    if (!run.raw_trace_sha256 || !SHA256_HEX_REGEX.test(run.raw_trace_sha256)) {
      return Response.json({
        success: false,
        error: 'run.raw_trace_sha256 must be a valid 64-character SHA-256 hex string'
      }, { status: 400 });
    }

    // Timestamps validation
    const startedAtTime = new Date(run.started_at || '').getTime();
    const completedAtTime = new Date(run.completed_at || '').getTime();
    if (isNaN(startedAtTime) || isNaN(completedAtTime)) {
      return Response.json({ success: false, error: 'run started_at and completed_at must be valid ISO-8601 timestamps' }, { status: 400 });
    }
    if (startedAtTime > completedAtTime) {
      return Response.json({ success: false, error: 'run started_at must precede completed_at' }, { status: 400 });
    }
    const maxFutureTime = Date.now() + 3600000; // 1 hour buffer
    if (completedAtTime > maxFutureTime) {
      return Response.json({ success: false, error: 'run completed_at cannot be in the future' }, { status: 400 });
    }
    const minTimestamp = new Date('2026-01-01T00:00:00.000Z').getTime();
    if (startedAtTime < minTimestamp) {
      return Response.json({ success: false, error: 'run started_at cannot precede suite release date' }, { status: 400 });
    }

    // Numeric bounds on run
    if (run.total_cost_micros !== null && run.total_cost_micros !== undefined) {
      if (typeof run.total_cost_micros !== 'number' || run.total_cost_micros < 0 || run.total_cost_micros > 1_000_000_000) {
        return Response.json({ success: false, error: 'run total_cost_micros must be between 0 and 1,000,000,000 ($1,000)' }, { status: 400 });
      }
    }
    if (run.total_tokens !== null && run.total_tokens !== undefined) {
      if (typeof run.total_tokens !== 'number' || run.total_tokens < 0 || run.total_tokens > 100_000_000) {
        return Response.json({ success: false, error: 'run total_tokens must be between 0 and 100,000,000' }, { status: 400 });
      }
    }

    // 5. Validate & Content-Address Subject (Prevent ID Poisoning)
    if (!subject.model_provider || typeof subject.model_provider !== 'string' || subject.model_provider.length > 64) {
      return Response.json({ success: false, error: 'subject.model_provider is required (max 64 chars)' }, { status: 400 });
    }
    if (!subject.model_id || typeof subject.model_id !== 'string' || subject.model_id.length > 128) {
      return Response.json({ success: false, error: 'subject.model_id is required (max 128 chars)' }, { status: 400 });
    }
    if (!subject.agent_harness || typeof subject.agent_harness !== 'string' || subject.agent_harness.length > 128) {
      return Response.json({ success: false, error: 'subject.agent_harness is required (max 128 chars)' }, { status: 400 });
    }
    if (!subject.harness_version || typeof subject.harness_version !== 'string' || subject.harness_version.length > 64) {
      return Response.json({ success: false, error: 'subject.harness_version is required (max 64 chars)' }, { status: 400 });
    }

    const normalizedModelConfig = typeof subject.model_config === 'string' ? subject.model_config : JSON.stringify(subject.model_config || {});
    if (normalizedModelConfig.length > 32768) {
      return Response.json({ success: false, error: 'subject.model_config exceeds max length of 32KB' }, { status: 400 });
    }
    const normalizedToolManifest = typeof subject.tool_manifest === 'string' ? subject.tool_manifest : JSON.stringify(subject.tool_manifest || []);
    if (normalizedToolManifest.length > 32768) {
      return Response.json({ success: false, error: 'subject.tool_manifest exceeds max length of 32KB' }, { status: 400 });
    }

    // Content-addressed deterministic subject ID prevents caller ID poisoning
    const canonicalSubjectId = 'subj_' + sha256Json({
      provider: subject.model_provider.trim(),
      modelId: subject.model_id.trim(),
      modelVersion: subject.model_version ? subject.model_version.trim() : null,
      harness: subject.agent_harness.trim(),
      harnessVersion: subject.harness_version.trim(),
      config: normalizedModelConfig,
      tools: normalizedToolManifest
    }).slice(0, 32);

    // 6. Validate & Content-Address Environment (Prevent ID Poisoning)
    if (!environment.os_name || typeof environment.os_name !== 'string' || environment.os_name.length > 64) {
      return Response.json({ success: false, error: 'environment.os_name is required (max 64 chars)' }, { status: 400 });
    }
    if (!environment.os_version || typeof environment.os_version !== 'string' || environment.os_version.length > 64) {
      return Response.json({ success: false, error: 'environment.os_version is required (max 64 chars)' }, { status: 400 });
    }
    if (!environment.architecture || typeof environment.architecture !== 'string' || environment.architecture.length > 64) {
      return Response.json({ success: false, error: 'environment.architecture is required (max 64 chars)' }, { status: 400 });
    }
    if (!environment.container_image_digest || !SHA256_HEX_REGEX.test(environment.container_image_digest)) {
      return Response.json({ success: false, error: 'environment.container_image_digest must be a valid 64-char SHA-256 hex string' }, { status: 400 });
    }
    const validPolicies = ['none', 'isolated', 'local_only', 'full'];
    const networkPolicy = environment.network_policy || 'none';
    if (!validPolicies.includes(networkPolicy)) {
      return Response.json({ success: false, error: `Invalid network policy: ${networkPolicy}` }, { status: 400 });
    }

    if (environment.memory_bytes !== null && environment.memory_bytes !== undefined) {
      if (typeof environment.memory_bytes !== 'number' || environment.memory_bytes <= 0 || environment.memory_bytes > 109951162777600) {
        return Response.json({ success: false, error: 'environment.memory_bytes must be a positive integer <= 100TB' }, { status: 400 });
      }
    }

    const normalizedRuntimeManifest = typeof environment.runtime_manifest === 'string' ? environment.runtime_manifest : JSON.stringify(environment.runtime_manifest || {});
    if (normalizedRuntimeManifest.length > 32768) {
      return Response.json({ success: false, error: 'environment.runtime_manifest exceeds max length of 32KB' }, { status: 400 });
    }

    // Content-addressed deterministic environment ID prevents caller ID poisoning
    const canonicalEnvironmentId = 'env_' + sha256Json({
      os: environment.os_name.trim(),
      osVer: environment.os_version.trim(),
      arch: environment.architecture.trim(),
      cpu: environment.cpu_model ? environment.cpu_model.trim() : null,
      gpu: environment.accelerator_model ? environment.accelerator_model.trim() : null,
      memory: environment.memory_bytes || null,
      container: environment.container_image_digest,
      runtime: normalizedRuntimeManifest,
      policy: networkPolicy
    }).slice(0, 32);

    // 7. Check for Run ID / Tuple Conflicts in D1 (Requirement 4)
    if (env && env.DB) {
      const existingRunById = await env.DB.prepare('SELECT id FROM dyno_runs WHERE id = ?').bind(run.id).first();
      if (existingRunById) {
        return Response.json({ success: false, error: `Run with ID "${run.id}" already exists` }, { status: 409 });
      }

      const existingRunByTuple = await env.DB.prepare(`
        SELECT id FROM dyno_runs
        WHERE suite_id = ? AND subject_id = ? AND environment_id = ? AND repetition = ? AND randomization_seed = ?
      `).bind(CANONICAL_DYNO_SUITE_ID, canonicalSubjectId, canonicalEnvironmentId, repetitions, randomizationSeed).first();

      if (existingRunByTuple) {
        return Response.json({
          success: false,
          error: 'A benchmark run with this exact suite, subject, environment, repetition, and seed already exists'
        }, { status: 409 });
      }
    }

    // 8. Validate Exact Known Task Set, Graders, and Repetitions (Requirements 3 & 4)
    const expectedTaskCount = NEUTRAL_DEV_FIXTURES.length * repetitions;
    if (attempts.length !== expectedTaskCount) {
      return Response.json({
        success: false,
        error: `Attempt count mismatch: expected ${expectedTaskCount} attempts (${repetitions} reps x ${NEUTRAL_DEV_FIXTURES.length} canonical tasks), received ${attempts.length}. Partial or excessive task evidence is rejected.`
      }, { status: 400 });
    }

    const seenTaskAttemptKeys = new Set<string>();
    let passedAttempts = 0;
    let firstAttemptSuccesses = 0;
    let totalHiddenPassed = 0;
    let totalHiddenTests = 0;
    let totalSafetyViolations = 0;
    let totalUnnecessaryChanges = 0;
    let totalHumanInterventions = 0;
    const durationsSeconds: number[] = [];

    for (let i = 0; i < attempts.length; i++) {
      const item = attempts[i];
      const att = item.attempt || item;

      if (!att.id || typeof att.id !== 'string' || !ID_REGEX.test(att.id)) {
        return Response.json({ success: false, error: `Attempt at index ${i} has missing or invalid id` }, { status: 400 });
      }

      if (!att.task_id || typeof att.task_id !== 'string') {
        return Response.json({ success: false, error: `Attempt at index ${i} is missing task_id` }, { status: 400 });
      }

      const fixture = CANONICAL_TASK_MAP.get(att.task_id);
      if (!fixture) {
        return Response.json({
          success: false,
          error: `Attempt at index ${i} references unknown task "${att.task_id}". Only canonical tasks are accepted.`
        }, { status: 400 });
      }

      const attemptNum = typeof att.attempt_number === 'number' ? Math.floor(att.attempt_number) : 1;
      if (attemptNum < 1 || attemptNum > repetitions) {
        return Response.json({
          success: false,
          error: `Attempt at index ${i} has invalid attempt_number: ${att.attempt_number} (repetition limit: ${repetitions})`
        }, { status: 400 });
      }

      const taskRepKey = `${att.task_id}:${attemptNum}`;
      if (seenTaskAttemptKeys.has(taskRepKey)) {
        return Response.json({
          success: false,
          error: `Duplicate attempt evidence detected for task "${att.task_id}" attempt #${attemptNum}`
        }, { status: 400 });
      }
      seenTaskAttemptKeys.add(taskRepKey);

      const validStatuses = ['passed', 'failed', 'timed_out', 'unsafe', 'cancelled'];
      if (!att.status || !validStatuses.includes(att.status)) {
        return Response.json({ success: false, error: `Attempt "${att.id}" has invalid status: ${att.status}` }, { status: 400 });
      }

      if (!att.result_digest || !SHA256_HEX_REGEX.test(att.result_digest)) {
        return Response.json({
          success: false,
          error: `Attempt "${att.id}" must have a valid 64-character SHA-256 result_digest`
        }, { status: 400 });
      }

      // Hidden test invariant check
      const expectedHiddenCount = fixture.hiddenTests.length;
      if (att.hidden_tests_total !== expectedHiddenCount) {
        return Response.json({
          success: false,
          error: `Attempt "${att.id}" for task "${att.task_id}" claimed ${att.hidden_tests_total} total hidden tests; expected ${expectedHiddenCount}.`
        }, { status: 400 });
      }

      const hiddenPassed = typeof att.hidden_tests_passed === 'number' ? Math.floor(att.hidden_tests_passed) : 0;
      if (hiddenPassed < 0 || hiddenPassed > expectedHiddenCount) {
        return Response.json({
          success: false,
          error: `Attempt "${att.id}" has invalid hidden_tests_passed: ${att.hidden_tests_passed} (total: ${expectedHiddenCount})`
        }, { status: 400 });
      }

      if (att.status === 'passed' && hiddenPassed !== expectedHiddenCount) {
        return Response.json({
          success: false,
          error: `Attempt "${att.id}" status is "passed" but only ${hiddenPassed}/${expectedHiddenCount} hidden tests passed.`
        }, { status: 400 });
      }

      // First attempt flag invariant
      const firstAttemptSuccess = att.first_attempt_success === 1 ? 1 : 0;
      if (firstAttemptSuccess === 1 && att.status !== 'passed') {
        return Response.json({
          success: false,
          error: `Attempt "${att.id}" cannot claim first_attempt_success=1 unless status="passed"`
        }, { status: 400 });
      }

      // Numeric bounds
      const durationMs = typeof att.duration_ms === 'number' ? Math.floor(att.duration_ms) : 0;
      if (durationMs < 0 || durationMs > 600000) {
        return Response.json({ success: false, error: `Attempt "${att.id}" duration_ms (${durationMs}) out of valid range (0..600000)` }, { status: 400 });
      }

      const toolCalls = typeof att.tool_calls === 'number' ? Math.floor(att.tool_calls) : 0;
      if (toolCalls < 0 || toolCalls > 10000) {
        return Response.json({ success: false, error: `Attempt "${att.id}" tool_calls (${toolCalls}) out of valid range (0..10000)` }, { status: 400 });
      }
      const interventions = typeof att.human_interventions === 'number' ? Math.max(0, Math.floor(att.human_interventions)) : 0;
      const unnecessaryFiles = typeof att.unnecessary_files_changed === 'number' ? Math.max(0, Math.floor(att.unnecessary_files_changed)) : 0;
      const safetyViolations = typeof att.safety_violations === 'number' ? Math.max(0, Math.floor(att.safety_violations)) : 0;

      // Grader outcomes validation
      const graders = item.graderResults || item.grader_results || [];
      if (graders.length !== fixture.graders.length) {
        return Response.json({
          success: false,
          error: `Attempt "${att.id}" provided ${graders.length} grader results; expected exactly ${fixture.graders.length} for task "${att.task_id}"`
        }, { status: 400 });
      }

      for (const expectedGrader of fixture.graders) {
        const matchingGrader = graders.find((g: any) => g.grader_key === expectedGrader.key);
        if (!matchingGrader) {
          return Response.json({
            success: false,
            error: `Attempt "${att.id}" missing grader outcome for "${expectedGrader.key}"`
          }, { status: 400 });
        }
        if (matchingGrader.grader_version && matchingGrader.grader_version !== expectedGrader.version) {
          return Response.json({
            success: false,
            error: `Grader "${expectedGrader.key}" version mismatch: expected ${expectedGrader.version}, received ${matchingGrader.grader_version}`
          }, { status: 400 });
        }
        if (typeof matchingGrader.score !== 'number' || matchingGrader.score < 0 || matchingGrader.score > (matchingGrader.max_score || 1)) {
          return Response.json({
            success: false,
            error: `Grader "${expectedGrader.key}" has invalid score: ${matchingGrader.score}`
          }, { status: 400 });
        }
        if (!matchingGrader.evidence_digest || !SHA256_HEX_REGEX.test(matchingGrader.evidence_digest)) {
          return Response.json({
            success: false,
            error: `Grader "${expectedGrader.key}" must have a valid 64-char SHA-256 evidence_digest`
          }, { status: 400 });
        }
      }

      // Tool events validation
      const toolEvents = item.toolEvents || item.tool_events || [];
      for (let teIdx = 0; teIdx < toolEvents.length; teIdx++) {
        const te = toolEvents[teIdx];
        if (te.sequence_number !== teIdx) {
          return Response.json({
            success: false,
            error: `Tool event sequence broken at index ${teIdx}: expected sequence_number ${teIdx}, received ${te.sequence_number}`
          }, { status: 400 });
        }
        if (!te.tool_name || typeof te.tool_name !== 'string') {
          return Response.json({ success: false, error: `Tool event at sequence ${teIdx} missing tool_name` }, { status: 400 });
        }
        if (te.safety_classification === 'violation' && safetyViolations === 0 && att.status !== 'unsafe') {
          return Response.json({
            success: false,
            error: `Tool event at sequence ${teIdx} flagged safety violation but attempt was not marked unsafe/violation`
          }, { status: 400 });
        }
      }

      if (att.status === 'passed') passedAttempts++;
      if (firstAttemptSuccess === 1) firstAttemptSuccesses++;
      totalHiddenPassed += hiddenPassed;
      totalHiddenTests += expectedHiddenCount;
      totalSafetyViolations += safetyViolations;
      totalUnnecessaryChanges += unnecessaryFiles;
      totalHumanInterventions += interventions;
      durationsSeconds.push(durationMs / 1000);
    }

    // A syntactically valid caller hash is not evidence. Recompute the trace
    // commitment from the exact canonical attempt, grader, and tool-event data.
    const canonicalTraceEvidence = attempts.map((item: any) => {
      const att = item.attempt || item;
      return {
        attemptId: att.id,
        toolEvents: item.toolEvents || item.tool_events || [],
        graderResults: item.graderResults || item.grader_results || [],
        digest: att.result_digest
      };
    });
    const computedTraceDigest = sha256Json(canonicalTraceEvidence);
    if (computedTraceDigest !== String(run.raw_trace_sha256).toLowerCase()) {
      return Response.json({
        success: false,
        error: 'Raw trace commitment does not match the canonical submitted evidence.'
      }, { status: 400 });
    }

    // 9. Deterministic Server-Side Scoring & Verification
    const firstAttemptRate = expectedTaskCount > 0 ? firstAttemptSuccesses / expectedTaskCount : 0;
    const hiddenPassedRate = totalHiddenTests > 0 ? totalHiddenPassed / totalHiddenTests : 0;
    const medianDurationSec = calculateMedian(durationsSeconds);

    const calculatedScore = calculateDynoScore({
      tasksCompleted: passedAttempts,
      totalTasks: expectedTaskCount,
      firstAttemptSuccessRate: firstAttemptRate,
      hiddenTestsPassedRate: hiddenPassedRate,
      medianCompletionSeconds: medianDurationSec,
      humanInterventions: totalHumanInterventions,
      safetyViolations: totalSafetyViolations,
      unnecessaryFilesChanged: totalUnnecessaryChanges
    });

    // Score verification against tamper/fabrication
    if (typeof run.overall_score === 'number') {
      const diff = Math.abs(run.overall_score - calculatedScore.score);
      if (diff > 1) {
        return Response.json({
          success: false,
          error: `Deterministic score validation failed: claimed score (${run.overall_score}) does not match verified attempt evidence score (${calculatedScore.score})`
        }, { status: 400 });
      }
    }

    const verifiedScore = calculatedScore.score;
    // Client-submitted evidence is NEVER self-promoted to 'verified' or 'reproducible'.
    // It is marked 'unverified' (or 'rejected' if policy violations occur).
    const verifiedVerificationStatus = totalSafetyViolations > 0 ? 'rejected' : 'unverified';

    // 10. Atomic D1 Ingestion via DB.batch() (Requirement 4)
    if (env && env.DB) {
      const statements: any[] = [];
      let storedTraceKey: string | null = null;

      // Object locations are server-owned. Ignore caller-provided storage keys.
      if (env.STORAGE && typeof env.STORAGE.put === 'function') {
        storedTraceKey = `dyno/traces/${user.id}/${run.id}/${computedTraceDigest}.json`;
        await env.STORAGE.put(storedTraceKey, JSON.stringify(canonicalTraceEvidence), {
          httpMetadata: { contentType: 'application/json' },
          customMetadata: { sha256: computedTraceDigest, runId: run.id }
        });
      }

      // a. Insert canonical suite (idempotent, server-controlled values ONLY)
      statements.push(
        env.DB.prepare(`
          INSERT OR IGNORE INTO dyno_suites (
            id, slug, version, name, methodology_markdown, task_manifest_digest, grader_version, status, published_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          CANONICAL_DYNO_SUITE_ID,
          CANONICAL_DYNO_SUITE_SLUG,
          CANONICAL_DYNO_SUITE_VERSION,
          CANONICAL_DYNO_SUITE_NAME,
          CANONICAL_DYNO_SUITE_METHODOLOGY,
          CANONICAL_DYNO_TASK_MANIFEST_DIGEST,
          CANONICAL_DYNO_GRADER_VERSION,
          'active',
          '2026-01-01T00:00:00.000Z',
          '2026-01-01T00:00:00.000Z'
        )
      );

      // b. Pre-seed all canonical tasks for the suite (server-controlled fixture metadata ONLY)
      NEUTRAL_DEV_FIXTURES.forEach((fixture, idx) => {
        statements.push(
          env.DB.prepare(`
            INSERT OR IGNORE INTO dyno_tasks (
              id, suite_id, task_key, category, title, prompt_digest, fixture_digest, grader_manifest_digest, time_limit_seconds, weight, display_order
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            `task_${CANONICAL_DYNO_SUITE_ID}_${fixture.key}`,
            CANONICAL_DYNO_SUITE_ID,
            fixture.key,
            fixture.category,
            fixture.title,
            computePromptDigest(fixture.prompt),
            computeFixtureDigest(fixture),
            computeGraderManifestDigest(fixture.graders, fixture.hiddenFiles),
            fixture.timeLimitSeconds,
            fixture.weight,
            idx
          )
        );
      });

      // c. Insert subject with content-addressed ID (idempotent)
      statements.push(
        env.DB.prepare(`
          INSERT OR IGNORE INTO dyno_subjects (
            id, model_provider, model_id, model_version, model_config, agent_harness, harness_version, tool_manifest, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          canonicalSubjectId,
          subject.model_provider.trim(),
          subject.model_id.trim(),
          subject.model_version ? subject.model_version.trim() : null,
          normalizedModelConfig,
          subject.agent_harness.trim(),
          subject.harness_version.trim(),
          normalizedToolManifest,
          new Date().toISOString()
        )
      );

      // d. Insert environment with content-addressed ID (idempotent)
      statements.push(
        env.DB.prepare(`
          INSERT OR IGNORE INTO dyno_environments (
            id, os_name, os_version, architecture, cpu_model, accelerator_model, memory_bytes,
            container_image_digest, runtime_manifest, network_policy, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          canonicalEnvironmentId,
          environment.os_name.trim(),
          environment.os_version.trim(),
          environment.architecture.trim(),
          environment.cpu_model ? environment.cpu_model.trim() : null,
          environment.accelerator_model ? environment.accelerator_model.trim() : null,
          environment.memory_bytes || null,
          environment.container_image_digest,
          normalizedRuntimeManifest,
          networkPolicy,
          new Date().toISOString()
        )
      );

      // e. Insert run
      statements.push(
        env.DB.prepare(`
          INSERT INTO dyno_runs (
            id, suite_id, subject_id, environment_id, submitted_by_user_id,
            repetition, randomization_seed, status, verification_status,
            overall_score, total_cost_micros, total_tokens,
            runner_attestation_digest, raw_trace_r2_key, raw_trace_sha256,
            started_at, completed_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          run.id,
          CANONICAL_DYNO_SUITE_ID,
          canonicalSubjectId,
          canonicalEnvironmentId,
          user.id,
          repetitions,
          randomizationSeed,
          'completed',
          verifiedVerificationStatus,
          verifiedScore,
          run.total_cost_micros ?? null,
          run.total_tokens ?? null,
          run.runner_attestation_digest,
          storedTraceKey,
          run.raw_trace_sha256,
          run.started_at,
          run.completed_at,
          new Date().toISOString()
        )
      );

      // f. Insert task attempts, grader results, and tool events
      for (const item of attempts) {
        const att = item.attempt || item;
        const taskRowId = `task_${CANONICAL_DYNO_SUITE_ID}_${att.task_id}`;

        statements.push(
          env.DB.prepare(`
            INSERT INTO dyno_task_attempts (
              id, run_id, task_id, attempt_number, status, first_attempt_success,
              hidden_tests_passed, hidden_tests_total, duration_ms,
              input_tokens, output_tokens, cached_input_tokens, cost_micros,
              tool_calls, human_interventions, unnecessary_files_changed,
              safety_violations, instruction_score, result_digest,
              started_at, completed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            att.id,
            run.id,
            taskRowId,
            att.attempt_number || 1,
            att.status,
            att.first_attempt_success === 1 ? 1 : 0,
            att.hidden_tests_passed || 0,
            att.hidden_tests_total || 0,
            att.duration_ms || 0,
            att.input_tokens || 0,
            att.output_tokens || 0,
            att.cached_input_tokens || 0,
            att.cost_micros || 0,
            att.tool_calls || 0,
            att.human_interventions || 0,
            att.unnecessary_files_changed || 0,
            att.safety_violations || 0,
            att.instruction_score ?? null,
            att.result_digest,
            att.started_at || new Date().toISOString(),
            att.completed_at || new Date().toISOString()
          )
        );

        // Grader results
        const graders = item.graderResults || item.grader_results || [];
        for (const g of graders) {
          const graderId = g.id || `grader_${att.id}_${g.grader_key}`;
          statements.push(
            env.DB.prepare(`
              INSERT INTO dyno_grader_results (
                id, task_attempt_id, grader_key, grader_version, passed, score, max_score, evidence_digest, detail, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(
              graderId,
              att.id,
              g.grader_key,
              g.grader_version || CANONICAL_DYNO_GRADER_VERSION,
              g.passed === 1 || g.passed === true ? 1 : 0,
              g.score ?? 1,
              g.max_score ?? 1,
              g.evidence_digest || att.result_digest,
              g.detail || '',
              new Date().toISOString()
            )
          );
        }

        // Tool events
        const toolEvents = item.toolEvents || item.tool_events || [];
        for (const te of toolEvents) {
          const teId = te.id || `te_${att.id}_${te.sequence_number}`;
          statements.push(
            env.DB.prepare(`
              INSERT INTO dyno_tool_events (
                id, task_attempt_id, sequence_number, tool_name, command_class,
                started_offset_ms, duration_ms, exit_code, input_digest, output_digest, safety_classification
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(
              teId,
              att.id,
              te.sequence_number,
              te.tool_name,
              te.command_class || null,
              te.started_offset_ms || 0,
              te.duration_ms ?? null,
              te.exit_code ?? null,
              te.input_digest || run.raw_trace_sha256,
              te.output_digest || null,
              te.safety_classification || 'allowed'
            )
          );
        }
      }

      // Execute entire submission atomically in a single D1 batch
      try {
        await env.DB.batch(statements);
      } catch (error) {
        if (storedTraceKey && env.STORAGE && typeof env.STORAGE.delete === 'function') {
          await env.STORAGE.delete(storedTraceKey).catch(() => undefined);
        }
        throw error;
      }

      return Response.json({
        success: true,
        runId: run.id,
        score: verifiedScore,
        grade: calculatedScore.grade,
        verificationStatus: verifiedVerificationStatus,
        badgeUrl: `https://nates-software.com/dyno/@${user.username}`
      });
    }

    return Response.json(
      { success: false, error: 'Benchmark persistence is unavailable' },
      { status: 503 }
    );
  } catch (err: any) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
};
