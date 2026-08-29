// Deterministic Local Grader Engine for DYNO benchmark runner
// Evaluates file states, hidden test executions, syntax integrity, and rule adherence.
// Produces canonical DynoGraderResultRecord objects with cryptographic evidence digests.

import {
  DynoGraderSpec,
  DynoGraderResultRecord,
  DynoSandboxInstance,
  DynoFixture
} from './types';
import { sha256 } from './crypto';

export interface GradingOutcome {
  readonly passed: boolean;
  readonly score: number;
  readonly maxScore: number;
  readonly hiddenTestsPassed: number;
  readonly hiddenTestsTotal: number;
  readonly graderResults: readonly DynoGraderResultRecord[];
}

/**
 * Runs a single grader specification against the sandbox.
 */
export async function evaluateGrader(
  taskAttemptId: string,
  grader: DynoGraderSpec,
  sandbox: DynoSandboxInstance
): Promise<DynoGraderResultRecord> {
  const maxScore = grader.weight ?? 1;
  let score = 0;
  let passed = false;
  let detail = '';

  try {
    switch (grader.type) {
      case 'test_runner': {
        const tests = grader.config.testCommands || [];
        let testsPassedCount = 0;
        const testLogs: string[] = [];

        for (const test of tests) {
          const timeoutMs = test.timeoutMs || 15_000;
          const execRes = await sandbox.exec(test.command, [], {
            timeoutMs,
            toolName: 'grader_test_exec',
            commandClass: 'grading'
          });

          const expectedCode = test.expectedExitCode ?? 0;
          const codeMatch = execRes.exitCode === expectedCode;
          const outputMatch = test.expectedOutputContains
            ? execRes.stdout.includes(test.expectedOutputContains)
            : true;

          const testPassed = codeMatch && outputMatch && !execRes.timedOut;
          if (testPassed) {
            testsPassedCount++;
            testLogs.push(`[PASS] ${test.name}`);
          } else {
            testLogs.push(`[FAIL] ${test.name} (exit=${execRes.exitCode}, timedOut=${execRes.timedOut})\nStdout: ${execRes.stdout}\nStderr: ${execRes.stderr}`);
          }
        }

        const totalTests = tests.length || 1;
        passed = testsPassedCount === totalTests;
        score = passed ? maxScore : (testsPassedCount / totalTests) * maxScore;
        detail = testLogs.join('\n');
        break;
      }

      case 'file_content': {
        const targetFiles = grader.config.targetFiles || [];
        const expectedPatterns = grader.config.expectedPatterns || [];
        const forbiddenPatterns = grader.config.forbiddenPatterns || [];
        const checks: string[] = [];
        let allChecksPassed = true;

        for (const file of targetFiles) {
          const exists = await sandbox.fileExists(file);
          if (!exists) {
            allChecksPassed = false;
            checks.push(`[FAIL] Required file missing: ${file}`);
            continue;
          }

          const content = await sandbox.readFile(file);

          for (const pattern of expectedPatterns) {
            const matches = pattern instanceof RegExp ? pattern.test(content) : content.includes(pattern);
            if (!matches) {
              allChecksPassed = false;
              checks.push(`[FAIL] Expected pattern not found in ${file}: ${String(pattern)}`);
            } else {
              checks.push(`[PASS] Expected pattern verified in ${file}`);
            }
          }

          for (const pattern of forbiddenPatterns) {
            const matches = pattern instanceof RegExp ? pattern.test(content) : content.includes(pattern);
            if (matches) {
              allChecksPassed = false;
              checks.push(`[FAIL] Forbidden pattern detected in ${file}: ${String(pattern)}`);
            } else {
              checks.push(`[PASS] Forbidden pattern absent in ${file}`);
            }
          }
        }

        passed = allChecksPassed;
        score = passed ? maxScore : 0;
        detail = checks.join('\n');
        break;
      }

      case 'file_integrity': {
        const readOnlyFiles = grader.config.readOnlyFiles || [];
        const changes = await sandbox.getFileChanges([]);
        const modifiedSet = new Set(changes.modified);
        const deletedSet = new Set(changes.deleted);
        const checks: string[] = [];
        let integrityPassed = true;

        for (const roFile of readOnlyFiles) {
          if (modifiedSet.has(roFile)) {
            integrityPassed = false;
            checks.push(`[FAIL] Read-only file was modified: ${roFile}`);
          } else if (deletedSet.has(roFile)) {
            integrityPassed = false;
            checks.push(`[FAIL] Read-only file was deleted: ${roFile}`);
          } else {
            checks.push(`[PASS] Read-only integrity preserved: ${roFile}`);
          }
        }

        passed = integrityPassed;
        score = passed ? maxScore : 0;
        detail = checks.join('\n');
        break;
      }

      case 'custom': {
        if (grader.config.customGrader) {
          const res = await grader.config.customGrader(sandbox);
          passed = res.passed;
          score = res.score;
          detail = res.detail;
        } else {
          passed = false;
          score = 0;
          detail = 'No custom grader implementation provided';
        }
        break;
      }
    }
  } catch (err: any) {
    passed = false;
    score = 0;
    detail = `Grader exception: ${err.message}\n${err.stack || ''}`;
  }

  const evidenceDigest = sha256(detail.length > 0 ? detail : `${grader.key}:${passed ? 'pass' : 'fail'}`);

  return {
    id: `grader_res_${taskAttemptId}_${grader.key}`,
    task_attempt_id: taskAttemptId,
    grader_key: grader.key,
    grader_version: grader.version,
    passed: passed ? 1 : 0,
    score: Math.round(score * 100) / 100,
    max_score: maxScore,
    evidence_digest: evidenceDigest,
    detail,
    created_at: new Date().toISOString()
  };
}

/**
 * Runs all graders for a task against the sandbox and aggregates outcomes.
 */
export async function gradeTaskAttempt(
  taskAttemptId: string,
  task: DynoFixture,
  sandbox: DynoSandboxInstance
): Promise<GradingOutcome> {
  for (const [relativePath, content] of Object.entries(task.hiddenFiles || {})) {
    await sandbox.writeFile(relativePath, content);
  }
  const graderResults: DynoGraderResultRecord[] = [];
  let totalScore = 0;
  let totalMaxScore = 0;
  let allPassed = true;

  // Run all defined task graders
  for (const grader of task.graders) {
    const res = await evaluateGrader(taskAttemptId, grader, sandbox);
    graderResults.push(res);
    totalScore += res.score;
    totalMaxScore += res.max_score;
    if (res.passed === 0) {
      allPassed = false;
    }
  }

  // Count hidden tests passed vs total
  let hiddenTestsPassed = 0;
  let hiddenTestsTotal = task.hiddenTests.length;

  for (const ht of task.hiddenTests) {
    // Check if there is a matching test_runner result that passed
    const matchingGrader = graderResults.find(g => g.detail.includes(`[PASS] ${ht.name}`));
    if (matchingGrader) {
      hiddenTestsPassed++;
    }
  }

  return {
    passed: allPassed,
    score: totalScore,
    maxScore: totalMaxScore > 0 ? totalMaxScore : 1,
    hiddenTestsPassed,
    hiddenTestsTotal,
    graderResults
  };
}
