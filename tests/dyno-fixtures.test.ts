import { describe, it, expect } from 'vitest';
import {
  NEUTRAL_DEV_FIXTURES,
  getFixtureByKey,
  computeFixtureDigest,
  computePromptDigest,
  computeGraderManifestDigest,
  DynoSandbox,
  gradeTaskAttempt
} from '../src/lib/dyno';

describe('DYNO Neutral Developer Task Fixtures', () => {
  it('should provide comprehensive neutral tasks independent from marketplace apps', () => {
    expect(NEUTRAL_DEV_FIXTURES.length).toBeGreaterThanOrEqual(7);

    for (const fixture of NEUTRAL_DEV_FIXTURES) {
      expect(fixture.key).toBeDefined();
      expect(fixture.title).toBeDefined();
      expect(fixture.prompt).toBeDefined();
      expect(fixture.timeLimitSeconds).toBeGreaterThan(0);
      expect(fixture.weight).toBeGreaterThan(0);
      expect(fixture.hiddenTests.length).toBeGreaterThanOrEqual(1);
      expect(fixture.graders.length).toBeGreaterThanOrEqual(1);
      expect(Object.keys(fixture.files).length).toBeGreaterThan(0);

      // Verify deterministic digests
      const fDigest = computeFixtureDigest(fixture);
      const pDigest = computePromptDigest(fixture.prompt);
      const gDigest = computeGraderManifestDigest(fixture.graders);

      expect(fDigest).toHaveLength(64);
      expect(pDigest).toHaveLength(64);
      expect(gDigest).toHaveLength(64);
    }
  });

  it('should test and verify the LRU Cache with TTL fixture', async () => {
    const fixture = getFixtureByKey('neutral_lru_cache_ttl')!;
    expect(fixture).toBeDefined();

    const sandbox = await DynoSandbox.create({
      initialFiles: fixture.files,
      prefix: 'dyno-test-lru-'
    });

    try {
      // 1. Initial state fails
      const initialOutcome = await gradeTaskAttempt('att_lru_init', fixture, sandbox);
      expect(initialOutcome.passed).toBe(false);

      // 2. Working implementation passes
      const solution = `class LRUCache {
  constructor(capacity) {
    this.capacity = capacity;
    this.cache = new Map();
  }

  get(key) {
    if (!this.cache.has(key)) return undefined;
    const entry = this.cache.get(key);
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    // Re-insert to refresh access order in Map
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key, value, ttlMs = 0) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.capacity) {
      // Evict oldest (first key in map)
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) this.cache.delete(oldestKey);
    }
    const expiresAt = ttlMs > 0 ? Date.now() + ttlMs : null;
    this.cache.set(key, { value, expiresAt });
  }

  size() {
    return this.cache.size;
  }
}
module.exports = { LRUCache };
`;
      await sandbox.writeFile('src/lru.js', solution);

      const fixedOutcome = await gradeTaskAttempt('att_lru_fixed', fixture, sandbox);
      expect(fixedOutcome.passed).toBe(true);
      expect(fixedOutcome.hiddenTestsPassed).toBe(1);
    } finally {
      await sandbox.cleanup();
    }
  });

  it('should test and verify SQL Query Builder parameter expansion fixture', async () => {
    const fixture = getFixtureByKey('neutral_sql_query_builder')!;
    expect(fixture).toBeDefined();

    const sandbox = await DynoSandbox.create({
      initialFiles: fixture.files,
      prefix: 'dyno-test-sql-'
    });

    try {
      const solution = `function buildSelect(table, conditions = {}) {
  const keys = Object.keys(conditions);
  if (keys.length === 0) {
    return { sql: \`SELECT * FROM \${table}\`, params: [] };
  }

  const clauses = [];
  const params = [];

  for (const key of keys) {
    const val = conditions[key];
    if (Array.isArray(val)) {
      if (val.length === 0) {
        clauses.push('1=0');
      } else {
        const placeholders = val.map(() => '?').join(', ');
        clauses.push(\`\${key} IN (\${placeholders})\`);
        params.push(...val);
      }
    } else {
      clauses.push(\`\${key} = ?\`);
      params.push(val);
    }
  }

  return {
    sql: \`SELECT * FROM \${table} WHERE \${clauses.join(' AND ')}\`,
    params
  };
}
module.exports = { buildSelect };
`;
      await sandbox.writeFile('src/queryBuilder.js', solution);

      const fixedOutcome = await gradeTaskAttempt('att_sql_fixed', fixture, sandbox);
      expect(fixedOutcome.passed).toBe(true);
      expect(fixedOutcome.hiddenTestsPassed).toBe(1);
    } finally {
      await sandbox.cleanup();
    }
  });

  it('should test and verify Safe EventEmitter abort listener fixture', async () => {
    const fixture = getFixtureByKey('neutral_async_event_emitter')!;
    expect(fixture).toBeDefined();

    const sandbox = await DynoSandbox.create({
      initialFiles: fixture.files,
      prefix: 'dyno-test-emitter-'
    });

    try {
      // The provided starter file for event emitter is already the target fix
      const outcome = await gradeTaskAttempt('att_emitter', fixture, sandbox);
      expect(outcome.passed).toBe(true);
      expect(outcome.hiddenTestsPassed).toBe(1);
    } finally {
      await sandbox.cleanup();
    }
  });

  it('should test and verify SemVer 2.0.0 resolver fixture', async () => {
    const fixture = getFixtureByKey('neutral_semver_resolver')!;
    expect(fixture).toBeDefined();

    const sandbox = await DynoSandbox.create({
      initialFiles: fixture.files,
      prefix: 'dyno-test-semver-'
    });

    try {
      const outcome = await gradeTaskAttempt('att_semver', fixture, sandbox);
      expect(outcome.passed).toBe(true);
      expect(outcome.hiddenTestsPassed).toBe(1);
    } finally {
      await sandbox.cleanup();
    }
  });

  it('should test and verify Exponential Retry fixture', async () => {
    const fixture = getFixtureByKey('neutral_retry_backoff')!;
    expect(fixture).toBeDefined();

    const sandbox = await DynoSandbox.create({
      initialFiles: fixture.files,
      prefix: 'dyno-test-retry-'
    });

    try {
      const outcome = await gradeTaskAttempt('att_retry', fixture, sandbox);
      expect(outcome.passed).toBe(true);
      expect(outcome.hiddenTestsPassed).toBe(1);
    } finally {
      await sandbox.cleanup();
    }
  });

  it('should test and verify Deep Clone repo rules fixture', async () => {
    const fixture = getFixtureByKey('neutral_strict_lint_rules')!;
    expect(fixture).toBeDefined();

    const sandbox = await DynoSandbox.create({
      initialFiles: fixture.files,
      prefix: 'dyno-test-clone-'
    });

    try {
      const outcome = await gradeTaskAttempt('att_clone', fixture, sandbox);
      expect(outcome.passed).toBe(true);
      expect(outcome.hiddenTestsPassed).toBe(1);
      expect(outcome.graderResults.every(g => g.passed === 1)).toBe(true);
    } finally {
      await sandbox.cleanup();
    }
  });
});
