// Core DYNO Benchmark Runner Engine
// Orchestrates isolated task sandboxes, agent harness invocations, trace captures,
// deterministic local grading, repetition cycles, and honest incomplete/error states.

import {
  DynoSuiteRecord,
  DynoSubjectRecord,
  DynoEnvironmentRecord,
  DynoRunRecord,
  DynoTaskAttemptRecord,
  DynoFixture,
  DynoAgentHarness,
  DynoTaskAttemptExecutionResult,
  DynoRunExecutionResult,
  DynoNetworkPolicy,
  DynoAttemptStatus,
  DynoVerificationStatus,
  DynoFileChangeSummary
} from './types';
import { DynoSandbox } from './sandbox';
import { DynoTracer } from './trace';
import { gradeTaskAttempt, GradingOutcome } from './grader';
import { detectLocalEnvironment } from './environment';
import { calculateDynoScore, calculateMedian } from './scoring';
import {
  NEUTRAL_DEV_FIXTURES,
  REFERENCE_SOLUTIONS,
  CANONICAL_DYNO_SUITE,
  CANONICAL_DYNO_SUITE_ID,
  CANONICAL_DYNO_TASK_MANIFEST_DIGEST,
  computeFixtureDigest,
  computePromptDigest,
  computeGraderManifestDigest
} from './fixtures';
import { sha256Json } from './crypto';

export interface DynoRunnerOptions {
  suite?: Partial<DynoSuiteRecord>;
  subject: DynoSubjectRecord;
  environment?: DynoEnvironmentRecord;
  fixtures?: readonly DynoFixture[];
  repetitions?: number;
  randomizationSeed?: string;
  networkPolicy?: DynoNetworkPolicy;
}

export class DynoRunner {
  private readonly fixtures: readonly DynoFixture[];
  private readonly environment: DynoEnvironmentRecord;
  private readonly suite: DynoSuiteRecord;
  private readonly subject: DynoSubjectRecord;
  private readonly repetitions: number;
  private readonly randomizationSeed: string;
  private readonly networkPolicy: DynoNetworkPolicy;

  constructor(options: DynoRunnerOptions) {
    this.fixtures = options.fixtures || NEUTRAL_DEV_FIXTURES;
    this.networkPolicy = options.networkPolicy || 'none';
    this.environment = options.environment || detectLocalEnvironment(this.networkPolicy);
    this.repetitions = Math.max(1, options.repetitions || 1);
    this.randomizationSeed = options.randomizationSeed || `seed_${Date.now().toString(36)}`;
    this.subject = options.subject;

    const taskManifestDigest = sha256Json(this.fixtures.map(f => ({
      key: f.key,
      category: f.category,
      fixtureDigest: computeFixtureDigest(f),
      promptDigest: computePromptDigest(f.prompt),
      graderDigest: computeGraderManifestDigest(f.graders)
    })));

    this.suite = {
      id: options.suite?.id || CANONICAL_DYNO_SUITE_ID,
      slug: options.suite?.slug || CANONICAL_DYNO_SUITE.slug,
      version: options.suite?.version || CANONICAL_DYNO_SUITE.version,
      name: options.suite?.name || CANONICAL_DYNO_SUITE.name,
      methodology_markdown: options.suite?.methodology_markdown || CANONICAL_DYNO_SUITE.methodology_markdown,
      task_manifest_digest: options.fixtures ? taskManifestDigest : (options.suite?.task_manifest_digest || CANONICAL_DYNO_TASK_MANIFEST_DIGEST),
      grader_version: options.suite?.grader_version || CANONICAL_DYNO_SUITE.grader_version,
      status: options.suite?.status || 'active',
      published_at: options.suite?.published_at || new Date().toISOString(),
      created_at: options.suite?.created_at || new Date().toISOString()
    };
  }

  /**
   * Executes a single task attempt in an isolated sandbox.
   */
  async runTaskAttempt(
    task: DynoFixture,
    harness: DynoAgentHarness,
    attemptNumber = 1,
    repetition = 1,
    runId = `run_${Date.now()}`
  ): Promise<DynoTaskAttemptExecutionResult> {
    const taskAttemptId = `attempt_${task.key}_rep${repetition}_att${attemptNumber}_${Date.now()}`;
    const tracer = new DynoTracer({
      taskAttemptId,
      networkPolicy: this.networkPolicy
    });

    const startTime = Date.now();
    const startedAt = new Date(startTime).toISOString();
    let sandbox: DynoSandbox | null = null;
    let attemptStatus: DynoAttemptStatus = 'running';
    let errorMessage: string | undefined;
    let agentResult: any = null;

    const abortController = new AbortController();
    const timeLimitMs = (task.timeLimitSeconds || 60) * 1000;
    const timeoutTimer = setTimeout(() => {
      abortController.abort();
    }, timeLimitMs);

    try {
      // 1. Create isolated sandbox with initial fixture files
      sandbox = await DynoSandbox.create({
        initialFiles: task.files,
        tracer,
        prefix: `dyno-${task.key}-`,
        networkPolicy: this.networkPolicy
      });

      // 2. Execute agent harness inside sandbox
      agentResult = await harness.execute({
        runId,
        taskAttemptId,
        task,
        sandbox,
        tracer,
        abortSignal: abortController.signal,
        repetition,
        randomizationSeed: this.randomizationSeed
      });

      clearTimeout(timeoutTimer);

      // Check if timed out
      if (abortController.signal.aborted) {
        attemptStatus = 'timed_out';
      }
    } catch (err: any) {
      clearTimeout(timeoutTimer);
      if (abortController.signal.aborted) {
        attemptStatus = 'timed_out';
      } else {
        attemptStatus = 'failed';
        errorMessage = err.message || String(err);
      }
    }

    const durationMs = Date.now() - startTime;
    const completedAt = new Date().toISOString();

    // 3. Safety inspection
    const safetyViolations = tracer.getSafetyViolationsCount();
    if (safetyViolations > 0 && attemptStatus !== 'timed_out') {
      attemptStatus = 'unsafe';
    }

    // 4. File changes inspection
    let fileChanges: DynoFileChangeSummary = {
      modified: [],
      created: [],
      deleted: [],
      unnecessaryChanges: []
    };

    if (sandbox) {
      try {
        fileChanges = await sandbox.getFileChanges(task.expectedModifiedFiles);
      } catch {
        // Ignore file inspection errors if directory gone
      }
    }

    // 5. Deterministic Grading
    let gradingOutcome: GradingOutcome = {
      passed: false,
      score: 0,
      maxScore: 1,
      hiddenTestsPassed: 0,
      hiddenTestsTotal: task.hiddenTests.length,
      graderResults: []
    };

    if (sandbox && attemptStatus !== 'unsafe' && attemptStatus !== 'timed_out' && !errorMessage) {
      gradingOutcome = await gradeTaskAttempt(taskAttemptId, task, sandbox);
      if (gradingOutcome.passed) {
        attemptStatus = 'passed';
      } else {
        attemptStatus = 'failed';
      }
    }

    // 6. Cleanup Sandbox
    if (sandbox) {
      await sandbox.cleanup();
    }

    const instructionScore = Math.round((gradingOutcome.score / (gradingOutcome.maxScore || 1)) * 100);
    const toolEvents = tracer.getEvents();

    const resultDigest = sha256Json({
      taskAttemptId,
      status: attemptStatus,
      durationMs,
      instructionScore,
      hiddenTestsPassed: gradingOutcome.hiddenTestsPassed,
      hiddenTestsTotal: gradingOutcome.hiddenTestsTotal,
      unnecessaryChanges: fileChanges.unnecessaryChanges,
      safetyViolations,
      error: errorMessage || null
    });

    const attemptRecord: DynoTaskAttemptRecord = {
      id: taskAttemptId,
      run_id: runId,
      task_id: task.key,
      attempt_number: attemptNumber,
      status: attemptStatus,
      // Each repetition currently contains exactly one agent execution. The
      // persisted attempt ordinal identifies that repetition, while this flag
      // records whether its sole (first) execution succeeded.
      first_attempt_success: attemptStatus === 'passed' ? 1 : 0,
      hidden_tests_passed: gradingOutcome.hiddenTestsPassed,
      hidden_tests_total: gradingOutcome.hiddenTestsTotal,
      duration_ms: durationMs,
      input_tokens: agentResult?.tokensUsed?.input ?? 0,
      output_tokens: agentResult?.tokensUsed?.output ?? 0,
      cached_input_tokens: agentResult?.tokensUsed?.cachedInput ?? 0,
      cost_micros: agentResult?.costMicros ?? 0,
      tool_calls: toolEvents.length,
      human_interventions: agentResult?.humanInterventions ?? 0,
      unnecessary_files_changed: fileChanges.unnecessaryChanges.length,
      safety_violations: safetyViolations,
      instruction_score: instructionScore,
      result_digest: resultDigest,
      started_at: startedAt,
      completed_at: completedAt
    };

    return {
      attempt: attemptRecord,
      toolEvents,
      graderResults: gradingOutcome.graderResults,
      fileChanges,
      error: errorMessage
    };
  }

  /**
   * Executes the full benchmark suite across all repetitions.
   */
  async runSuite(harness: DynoAgentHarness): Promise<DynoRunExecutionResult> {
    const runId = `run_${this.subject.id}_${Date.now()}`;
    const startedAt = new Date().toISOString();
    const allAttemptResults: DynoTaskAttemptExecutionResult[] = [];
    const repetitionScores: number[] = [];

    for (let rep = 1; rep <= this.repetitions; rep++) {
      const repAttempts: DynoTaskAttemptExecutionResult[] = [];

      for (const task of this.fixtures) {
        // The persisted schema uses attempt_number as the ordinal execution of
        // a task within a run. DYNO currently performs one execution per task
        // per repetition, so the repetition ordinal is the attempt ordinal.
        const attemptResult = await this.runTaskAttempt(task, harness, rep, rep, runId);
        repAttempts.push(attemptResult);
        allAttemptResults.push(attemptResult);
      }

      // Calculate score for this repetition
      const repPassed = repAttempts.filter(a => a.attempt.status === 'passed').length;
      const repTotal = repAttempts.length;
      const repFirstAttemptPassed = repAttempts.filter(a => a.attempt.first_attempt_success === 1).length;
      const repHiddenPassed = repAttempts.reduce((acc, a) => acc + a.attempt.hidden_tests_passed, 0);
      const repHiddenTotal = repAttempts.reduce((acc, a) => acc + a.attempt.hidden_tests_total, 0);
      const repMedianDuration = calculateMedian(repAttempts.map(a => a.attempt.duration_ms / 1000));
      const repSafetyViolations = repAttempts.reduce((acc, a) => acc + a.attempt.safety_violations, 0);
      const repUnnecessaryChanges = repAttempts.reduce((acc, a) => acc + a.attempt.unnecessary_files_changed, 0);
      const repInterventions = repAttempts.reduce((acc, a) => acc + a.attempt.human_interventions, 0);

      const repScoreResult = calculateDynoScore({
        tasksCompleted: repPassed,
        totalTasks: repTotal,
        firstAttemptSuccessRate: repTotal > 0 ? repFirstAttemptPassed / repTotal : 0,
        hiddenTestsPassedRate: repHiddenTotal > 0 ? repHiddenPassed / repHiddenTotal : 0,
        medianCompletionSeconds: repMedianDuration,
        humanInterventions: repInterventions,
        safetyViolations: repSafetyViolations,
        unnecessaryFilesChanged: repUnnecessaryChanges
      });

      repetitionScores.push(repScoreResult.score);
    }

    const completedAt = new Date().toISOString();

    // Aggregate metrics across all attempts
    const totalAttempts = allAttemptResults.length;
    const passedAttempts = allAttemptResults.filter(a => a.attempt.status === 'passed').length;
    const firstAttemptSuccesses = allAttemptResults.filter(a => a.attempt.first_attempt_success === 1).length;
    const totalHiddenPassed = allAttemptResults.reduce((acc, a) => acc + a.attempt.hidden_tests_passed, 0);
    const totalHiddenTests = allAttemptResults.reduce((acc, a) => acc + a.attempt.hidden_tests_total, 0);
    const durations = allAttemptResults.map(a => a.attempt.duration_ms);
    const toolCallCounts = allAttemptResults.map(a => a.attempt.tool_calls);
    const totalTokens = allAttemptResults.reduce((acc, a) => acc + a.attempt.input_tokens + a.attempt.output_tokens, 0);
    const totalCostMicros = allAttemptResults.reduce((acc, a) => acc + a.attempt.cost_micros, 0);
    const totalSafetyViolations = allAttemptResults.reduce((acc, a) => acc + a.attempt.safety_violations, 0);
    const totalUnnecessaryChanges = allAttemptResults.reduce((acc, a) => acc + a.attempt.unnecessary_files_changed, 0);
    const totalHumanInterventions = allAttemptResults.reduce((acc, a) => acc + a.attempt.human_interventions, 0);

    const completionRate = totalAttempts > 0 ? Math.round((passedAttempts / totalAttempts) * 100) : 0;
    const firstAttemptSuccessRate = totalAttempts > 0 ? Math.round((firstAttemptSuccesses / totalAttempts) * 100) : 0;
    const hiddenTestsPassedRate = totalHiddenTests > 0 ? Math.round((totalHiddenPassed / totalHiddenTests) * 100) : 0;
    const medianDurationMs = calculateMedian(durations);
    const medianToolCalls = calculateMedian(toolCallCounts);

    const scoreResult = calculateDynoScore({
      tasksCompleted: passedAttempts,
      totalTasks: totalAttempts,
      firstAttemptSuccessRate: firstAttemptSuccessRate / 100,
      hiddenTestsPassedRate: hiddenTestsPassedRate / 100,
      medianCompletionSeconds: medianDurationMs / 1000,
      humanInterventions: totalHumanInterventions,
      safetyViolations: totalSafetyViolations,
      unnecessaryFilesChanged: totalUnnecessaryChanges
    });

    // Local CLI repetitions improve measurement confidence, but a runner cannot
    // promote its own evidence. Only the independent DYNO verifier may do that.
    let verificationStatus: DynoVerificationStatus = 'unverified';
    if (totalSafetyViolations > 0) {
      verificationStatus = 'rejected';
    }

    const rawTraceSha256 = sha256Json(allAttemptResults.map(a => ({
      attemptId: a.attempt.id,
      toolEvents: a.toolEvents,
      graderResults: a.graderResults,
      digest: a.attempt.result_digest
    })));

    const runnerAttestationDigest = sha256Json({
      runId,
      suiteId: this.suite.id,
      subjectId: this.subject.id,
      environmentId: this.environment.id,
      score: scoreResult.score,
      rawTraceSha256,
      completedAt
    });

    const runRecord: DynoRunRecord = {
      id: runId,
      suite_id: this.suite.id,
      subject_id: this.subject.id,
      environment_id: this.environment.id,
      submitted_by_user_id: null,
      repetition: this.repetitions,
      randomization_seed: this.randomizationSeed,
      status: 'completed',
      verification_status: verificationStatus,
      overall_score: scoreResult.score,
      total_cost_micros: totalCostMicros,
      total_tokens: totalTokens,
      runner_attestation_digest: runnerAttestationDigest,
      raw_trace_r2_key: null,
      raw_trace_sha256: rawTraceSha256,
      started_at: startedAt,
      completed_at: completedAt,
      created_at: startedAt
    };

    return {
      run: runRecord,
      subject: this.subject,
      environment: this.environment,
      suite: this.suite,
      attempts: allAttemptResults,
      summary: {
        totalTasks: totalAttempts,
        tasksPassed: passedAttempts,
        completionRate,
        firstAttemptSuccessRate,
        hiddenTestsPassedRate,
        medianDurationMs,
        medianToolCalls,
        totalTokens,
        totalCostMicros,
        totalSafetyViolations,
        totalUnnecessaryFilesChanged: totalUnnecessaryChanges,
        totalHumanInterventions,
        dynoScore: scoreResult.score,
        grade: scoreResult.grade
      }
    };
  }
}

/**
 * Creates a baseline unassisted harness that inspects initial fixture files without editing them.
 */
export function createBaselineHarness(
  modelId = 'unassisted-baseline',
  harnessName = 'Baseline Unassisted'
): DynoAgentHarness {
  return {
    name: harnessName,
    version: '1.0.0',
    modelProvider: 'baseline',
    modelId,
    toolManifest: ['read_file'],
    async execute(ctx) {
      for (const expectedFile of ctx.task.expectedModifiedFiles) {
        if (await ctx.sandbox.fileExists(expectedFile)) {
          await ctx.sandbox.readFile(expectedFile);
        }
      }
      return {
        humanInterventions: 0,
        notes: 'Baseline unassisted run without intervention'
      };
    }
  };
}

/**
 * Creates a reference harness that applies verified canonical solutions for all task fixtures.
 */
export function createReferenceHarness(
  modelId = 'reference-calibration',
  harnessName = 'Reference Calibration Solver'
): DynoAgentHarness {
  return {
    name: harnessName,
    version: '1.0.0',
    modelProvider: 'reference',
    modelId,
    toolManifest: ['read_file', 'write_file'],
    async execute(ctx) {
      const solutionFiles = REFERENCE_SOLUTIONS[ctx.task.key];
      if (solutionFiles) {
        for (const [relPath, content] of Object.entries(solutionFiles)) {
          await ctx.sandbox.writeFile(relPath, content);
        }
      }
      return {
        humanInterventions: 0,
        notes: 'Reference solution applied for calibration verification'
      };
    }
  };
}

/**
 * Creates a generic CLI command harness that executes a user-specified command inside each isolated sandbox.
 */
export function createCommandHarness(
  command: string,
  modelId = 'custom-cli-agent',
  harnessName = 'CLI Command Agent'
): DynoAgentHarness {
  return {
    name: harnessName,
    version: '1.0.0',
    modelProvider: 'custom',
    modelId,
    toolManifest: ['exec', 'read_file', 'write_file', 'list_files'],
    async execute(ctx) {
      const startTime = Date.now();
      const res = await ctx.sandbox.exec(command, [], {
        cwd: ctx.sandbox.dir,
        env: {
          DYNO_TASK_KEY: ctx.task.key,
          DYNO_TASK_PROMPT: ctx.task.prompt,
          DYNO_TASK_CATEGORY: ctx.task.category,
          DYNO_TASK_TITLE: ctx.task.title,
          DYNO_SANDBOX_DIR: ctx.sandbox.dir,
          DYNO_TIME_LIMIT_SECONDS: String(ctx.task.timeLimitSeconds)
        },
        timeoutMs: (ctx.task.timeLimitSeconds || 60) * 1000,
        toolName: 'harness_exec',
        commandClass: 'agent_command'
      });

      return {
        tokensUsed: {
          input: 0,
          output: 0,
          cachedInput: 0
        },
        notes: `Agent command executed in ${Date.now() - startTime}ms (exit code: ${res.exitCode})`
      };
    }
  };
}
