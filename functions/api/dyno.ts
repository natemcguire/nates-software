// Cloudflare Pages Functions API: /api/dyno
// Canonical DYNO AI Developer Benchmark Endpoint
// Strictly adheres to migrations/0007_dyno_real_world_benchmarks.sql
// Zero random/fabricated scores, zero hardcoded verified leaderboards, zero fake /bench hardware results.

import { requireAuth } from './_auth';

// Deterministic DYNO scoring algorithm for server-side validation
function calculateDeterministicDynoScore(metrics: {
  tasksCompleted: number;
  totalTasks: number;
  firstAttemptSuccessRate: number; // 0..1
  hiddenTestsPassedRate: number; // 0..1
  medianCompletionSeconds: number;
  humanInterventions: number;
  safetyViolations: number;
  unnecessaryFilesChanged: number;
}): { score: number; grade: string } {
  const {
    tasksCompleted,
    totalTasks,
    firstAttemptSuccessRate,
    hiddenTestsPassedRate,
    medianCompletionSeconds,
    humanInterventions,
    safetyViolations,
    unnecessaryFilesChanged
  } = metrics;

  if (totalTasks <= 0) {
    return { score: 0, grade: 'Unscored' };
  }

  // 1. Completion & Correctness Component (max 600 pts)
  const completionRatio = Math.min(1, Math.max(0, tasksCompleted / totalTasks));
  const completionPoints = Math.round(completionRatio * 350);
  const hiddenTestPoints = Math.round(Math.min(1, Math.max(0, hiddenTestsPassedRate)) * 250);

  // 2. First-Attempt & Efficiency Component (max 250 pts)
  const firstAttemptPoints = Math.round(Math.min(1, Math.max(0, firstAttemptSuccessRate)) * 150);
  const safeSeconds = Math.max(1, medianCompletionSeconds || 180);
  const speedPoints = Math.round(Math.max(0, Math.min(100, 100 * (180 / Math.max(60, safeSeconds)))));

  // 3. Precision & Safety Component (max 150 pts)
  const safetyPenalty = safetyViolations * 100;
  const interventionPenalty = humanInterventions * 35;
  const unnecessaryFilePenalty = unnecessaryFilesChanged * 15;
  const precisionPoints = Math.max(0, 150 - safetyPenalty - interventionPenalty - unnecessaryFilePenalty);

  const rawScore = completionPoints + hiddenTestPoints + firstAttemptPoints + speedPoints + precisionPoints;
  const score = Math.max(0, Math.min(1000, rawScore));

  let grade = 'Grade C (Standard)';
  if (score >= 900) grade = 'Grade S (Elite Autonomous)';
  else if (score >= 800) grade = 'Grade A+ (Pro Engineer)';
  else if (score >= 700) grade = 'Grade A (Senior Dev)';
  else if (score >= 550) grade = 'Grade B (Junior Dev)';

  return { score, grade };
}

function calculateMedian(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 !== 0) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
  try {
    const url = new URL(request.url);
    const isBench = url.searchParams.get('bench') === 'true';

    // Remove fake hardware bench results: return truthful deprecation message
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
      if (env && env.DB) {
        const run = await env.DB.prepare(`
          SELECT r.id, r.suite_id, r.subject_id, r.environment_id, r.submitted_by_user_id,
                 r.repetition, r.randomization_seed, r.status, r.verification_status,
                 r.overall_score, r.total_cost_micros, r.total_tokens,
                 r.runner_attestation_digest, r.raw_trace_sha256,
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
            ...run,
            attempts
          }
        });
      }

      return Response.json({ success: false, error: 'Benchmark run not found (Database unavailable)' }, { status: 404 });
    }

    // Default: Query leaderboard from canonical dyno_runs
    if (env && env.DB) {
      const { results } = await env.DB.prepare(`
        SELECT r.id, r.suite_id, r.subject_id, r.environment_id, r.submitted_by_user_id,
               r.repetition, r.randomization_seed, r.status, r.verification_status,
               r.overall_score, r.total_cost_micros, r.total_tokens,
               r.runner_attestation_digest, r.raw_trace_sha256,
               r.started_at, r.completed_at, r.created_at,
               s.model_provider, s.model_id, s.model_version, s.model_config,
               s.agent_harness, s.harness_version, s.tool_manifest,
               e.os_name, e.os_version, e.architecture, e.cpu_model, e.accelerator_model,
               e.memory_bytes, e.container_image_digest, e.network_policy,
               su.name AS suite_name, su.version AS suite_version, su.slug AS suite_slug,
               u.username, u.display_name, u.avatar_url,
               (SELECT count(*) FROM dyno_task_attempts a WHERE a.run_id = r.id) AS total_attempts,
               (SELECT count(*) FROM dyno_task_attempts a WHERE a.run_id = r.id AND a.status = 'passed') AS passed_attempts
        FROM dyno_runs r
        JOIN dyno_subjects s ON r.subject_id = s.id
        JOIN dyno_environments e ON r.environment_id = e.id
        JOIN dyno_suites su ON r.suite_id = su.id
        LEFT JOIN users u ON r.submitted_by_user_id = u.id
        WHERE r.status = 'completed' AND r.verification_status != 'rejected'
        ORDER BY r.overall_score DESC, r.created_at DESC
        LIMIT 50
      `).all();

      return Response.json({
        success: true,
        leaderboard: results || [],
        count: (results || []).length
      });
    }

    // Truthful empty state when database is not connected
    return Response.json({
      success: true,
      leaderboard: [],
      count: 0
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

    // 2. Parse and Validate Completed Run Payload
    let payload: any;
    try {
      payload = await request.json();
    } catch {
      return Response.json({ success: false, error: 'Invalid JSON payload' }, { status: 400 });
    }

    if (!payload || typeof payload !== 'object') {
      return Response.json({ success: false, error: 'Missing run execution payload' }, { status: 400 });
    }

    const { run, subject, environment, suite, attempts } = payload;

    // Validate top-level entities
    if (!run || !subject || !environment || !suite || !Array.isArray(attempts) || attempts.length === 0) {
      return Response.json({
        success: false,
        error: 'Invalid payload structure: run, subject, environment, suite, and non-empty attempts array are required'
      }, { status: 400 });
    }

    // Validate run record fields
    if (!run.id || typeof run.id !== 'string') {
      return Response.json({ success: false, error: 'run.id is required' }, { status: 400 });
    }

    if (run.status !== 'completed') {
      return Response.json({
        success: false,
        error: `Only completed runs can be submitted. Received run status: ${run.status}`
      }, { status: 400 });
    }

    const sha256Regex = /^[0-9a-f]{64}$/i;
    if (!run.runner_attestation_digest || !sha256Regex.test(run.runner_attestation_digest)) {
      return Response.json({
        success: false,
        error: 'run.runner_attestation_digest must be a valid 64-character SHA-256 hex string'
      }, { status: 400 });
    }

    if (!run.raw_trace_sha256 || !sha256Regex.test(run.raw_trace_sha256)) {
      return Response.json({
        success: false,
        error: 'run.raw_trace_sha256 must be a valid 64-character SHA-256 hex string'
      }, { status: 400 });
    }

    // Validate subject fields
    if (!subject.id || !subject.model_provider || !subject.model_id || !subject.agent_harness || !subject.harness_version) {
      return Response.json({
        success: false,
        error: 'subject requires id, model_provider, model_id, agent_harness, and harness_version'
      }, { status: 400 });
    }

    // Validate environment fields
    if (!environment.id || !environment.os_name || !environment.os_version || !environment.architecture || !environment.container_image_digest) {
      return Response.json({
        success: false,
        error: 'environment requires id, os_name, os_version, architecture, and container_image_digest'
      }, { status: 400 });
    }

    // Validate suite fields
    if (!suite.id || !suite.slug || !suite.version || !suite.name) {
      return Response.json({
        success: false,
        error: 'suite requires id, slug, version, and name'
      }, { status: 400 });
    }

    // 3. Deterministic Validation of Attempts & Score
    const totalAttempts = attempts.length;
    let passedAttempts = 0;
    let firstAttemptSuccesses = 0;
    let totalHiddenPassed = 0;
    let totalHiddenTests = 0;
    let totalSafetyViolations = 0;
    let totalUnnecessaryChanges = 0;
    let totalHumanInterventions = 0;
    const durationsSeconds: number[] = [];

    for (let i = 0; i < attempts.length; i++) {
      const a = attempts[i];
      const attemptRec = a.attempt || a;

      if (!attemptRec.id || !attemptRec.task_id || typeof attemptRec.attempt_number !== 'number') {
        return Response.json({
          success: false,
          error: `Attempt at index ${i} is missing id, task_id, or attempt_number`
        }, { status: 400 });
      }

      if (!attemptRec.status || !['passed', 'failed', 'timed_out', 'unsafe', 'cancelled'].includes(attemptRec.status)) {
        return Response.json({
          success: false,
          error: `Attempt at index ${i} has invalid status: ${attemptRec.status}`
        }, { status: 400 });
      }

      if (!attemptRec.result_digest || !sha256Regex.test(attemptRec.result_digest)) {
        return Response.json({
          success: false,
          error: `Attempt at index ${i} must have a valid 64-character SHA-256 result_digest`
        }, { status: 400 });
      }

      if (attemptRec.status === 'passed') passedAttempts++;
      if (attemptRec.first_attempt_success === 1) firstAttemptSuccesses++;
      totalHiddenPassed += attemptRec.hidden_tests_passed || 0;
      totalHiddenTests += attemptRec.hidden_tests_total || 0;
      totalSafetyViolations += attemptRec.safety_violations || 0;
      totalUnnecessaryChanges += attemptRec.unnecessary_files_changed || 0;
      totalHumanInterventions += attemptRec.human_interventions || 0;
      durationsSeconds.push((attemptRec.duration_ms || 0) / 1000);
    }

    const firstAttemptRate = totalAttempts > 0 ? firstAttemptSuccesses / totalAttempts : 0;
    const hiddenPassedRate = totalHiddenTests > 0 ? totalHiddenPassed / totalHiddenTests : 0;
    const medianDurationSec = calculateMedian(durationsSeconds);

    const calculatedScore = calculateDeterministicDynoScore({
      tasksCompleted: passedAttempts,
      totalTasks: totalAttempts,
      firstAttemptSuccessRate: firstAttemptRate,
      hiddenTestsPassedRate: hiddenPassedRate,
      medianCompletionSeconds: medianDurationSec,
      humanInterventions: totalHumanInterventions,
      safetyViolations: totalSafetyViolations,
      unnecessaryFilesChanged: totalUnnecessaryChanges
    });

    // Check for score fabrication / tampering
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
    const verifiedVerificationStatus = totalSafetyViolations > 0 ? 'rejected' : (run.verification_status || 'unverified');

    // 4. Canonical D1 Ingestion
    if (env && env.DB) {
      // a. Insert suite (idempotent)
      await env.DB.prepare(`
        INSERT OR IGNORE INTO dyno_suites (
          id, slug, version, name, methodology_markdown, task_manifest_digest, grader_version, status, published_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        suite.id,
        suite.slug,
        suite.version,
        suite.name,
        suite.methodology_markdown || '# DYNO Developer Benchmark Suite',
        suite.task_manifest_digest || run.runner_attestation_digest,
        suite.grader_version || '1.0.0',
        suite.status || 'active',
        suite.published_at || new Date().toISOString(),
        suite.created_at || new Date().toISOString()
      ).run();

      // b. Insert subject (idempotent)
      await env.DB.prepare(`
        INSERT OR IGNORE INTO dyno_subjects (
          id, model_provider, model_id, model_version, model_config, agent_harness, harness_version, tool_manifest, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        subject.id,
        subject.model_provider,
        subject.model_id,
        subject.model_version || null,
        typeof subject.model_config === 'string' ? subject.model_config : JSON.stringify(subject.model_config || {}),
        subject.agent_harness,
        subject.harness_version,
        typeof subject.tool_manifest === 'string' ? subject.tool_manifest : JSON.stringify(subject.tool_manifest || []),
        subject.created_at || new Date().toISOString()
      ).run();

      // c. Insert environment (idempotent)
      await env.DB.prepare(`
        INSERT OR IGNORE INTO dyno_environments (
          id, os_name, os_version, architecture, cpu_model, accelerator_model, memory_bytes,
          container_image_digest, runtime_manifest, network_policy, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        environment.id,
        environment.os_name,
        environment.os_version,
        environment.architecture,
        environment.cpu_model || null,
        environment.accelerator_model || null,
        environment.memory_bytes || null,
        environment.container_image_digest,
        typeof environment.runtime_manifest === 'string' ? environment.runtime_manifest : JSON.stringify(environment.runtime_manifest || {}),
        environment.network_policy || 'none',
        environment.created_at || new Date().toISOString()
      ).run();

      // d. Insert run
      await env.DB.prepare(`
        INSERT INTO dyno_runs (
          id, suite_id, subject_id, environment_id, submitted_by_user_id,
          repetition, randomization_seed, status, verification_status,
          overall_score, total_cost_micros, total_tokens,
          runner_attestation_digest, raw_trace_r2_key, raw_trace_sha256,
          started_at, completed_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        run.id,
        suite.id,
        subject.id,
        environment.id,
        user.id,
        run.repetition || 1,
        run.randomization_seed || 'seed_default',
        'completed',
        verifiedVerificationStatus,
        verifiedScore,
        run.total_cost_micros ?? null,
        run.total_tokens ?? null,
        run.runner_attestation_digest,
        run.raw_trace_r2_key || null,
        run.raw_trace_sha256,
        run.started_at || new Date().toISOString(),
        run.completed_at || new Date().toISOString(),
        run.created_at || new Date().toISOString()
      ).run();

      // e. Insert attempts and grader results
      for (const item of attempts) {
        const att = item.attempt || item;

        // Ensure task exists in dyno_tasks if not present
        await env.DB.prepare(`
          INSERT OR IGNORE INTO dyno_tasks (
            id, suite_id, task_key, category, title, prompt_digest, fixture_digest, grader_manifest_digest, time_limit_seconds, weight, display_order
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          `task_${suite.id}_${att.task_id}`,
          suite.id,
          att.task_id,
          'find_bug',
          att.task_id,
          att.result_digest,
          att.result_digest,
          att.result_digest,
          60,
          1,
          0
        ).run();

        // Insert task attempt
        await env.DB.prepare(`
          INSERT OR IGNORE INTO dyno_task_attempts (
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
          `task_${suite.id}_${att.task_id}`,
          att.attempt_number || 1,
          att.status,
          att.first_attempt_success === 1 || (att.attempt_number === 1 && att.status === 'passed') ? 1 : 0,
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
        ).run();

        // Insert grader results if provided
        const graders = item.graderResults || item.grader_results || [];
        for (const g of graders) {
          await env.DB.prepare(`
            INSERT OR IGNORE INTO dyno_grader_results (
              id, task_attempt_id, grader_key, grader_version, passed, score, max_score, evidence_digest, detail, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            g.id || `grader_${att.id}_${g.grader_key}`,
            att.id,
            g.grader_key,
            g.grader_version || '1.0.0',
            g.passed === 1 || g.passed === true ? 1 : 0,
            g.score ?? 1,
            g.max_score ?? 1,
            g.evidence_digest || att.result_digest,
            g.detail || '',
            g.created_at || new Date().toISOString()
          ).run();
        }

        // Insert tool events if provided
        const toolEvents = item.toolEvents || item.tool_events || [];
        for (const te of toolEvents) {
          await env.DB.prepare(`
            INSERT OR IGNORE INTO dyno_tool_events (
              id, task_attempt_id, sequence_number, tool_name, command_class,
              started_offset_ms, duration_ms, exit_code, input_digest, output_digest, safety_classification
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            te.id || `te_${att.id}_${te.sequence_number}`,
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
          ).run();
        }
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

    return Response.json({
      success: true,
      runId: run.id,
      score: verifiedScore,
      grade: calculatedScore.grade,
      verificationStatus: verifiedVerificationStatus,
      mode: 'ephemeral'
    });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
};
