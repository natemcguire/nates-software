// Neutral developer task fixtures for DYNO benchmark runner
// Covers common real-world software engineering tasks across standard categories.
// Strictly independent of this repository's domain and marketplace apps.

import { DynoFixture, DynoTaskCategory } from './types';
import { digestFileManifest, sha256, sha256Json } from './crypto';

export const NEUTRAL_DEV_FIXTURES: readonly DynoFixture[] = [
  {
    key: 'neutral_cli_arg_parser',
    category: 'find_bug',
    title: 'Fix Boolean Flag Bug in CLI Argument Parser',
    description: 'Fix a bug where boolean flags consume subsequent positional arguments instead of defaulting to true.',
    prompt: 'In src/parser.js, boolean flags without values currently consume the next argument. Ensure boolean flags set value to true without consuming positional args.',
    timeLimitSeconds: 60,
    weight: 1,
    expectedModifiedFiles: ['src/parser.js'],
    readOnlyFiles: ['test/verify.js', 'package.json'],
    files: {
      'package.json': JSON.stringify({
        name: 'neutral-cli-parser',
        version: '1.0.0',
        type: 'commonjs'
      }, null, 2),
      'src/parser.js': `function parseArgs(args, booleanFlags = []) {
  const flags = {};
  const positional = [];
  const boolSet = new Set(booleanFlags);

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      // BUG: Consumes next arg even if it is a boolean flag or another flag
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
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
`,
      'test/verify.js': `const { parseArgs } = require('../src/parser.js');
const assert = require('assert');

// Test 1: standard boolean flags
const res1 = parseArgs(['--verbose', 'file.txt'], ['verbose']);
assert.strictEqual(res1.flags.verbose, true, 'Verbose flag should be true');
assert.deepStrictEqual(res1.positional, ['file.txt'], 'file.txt should remain positional');

// Test 2: valued flags
const res2 = parseArgs(['--output', 'out.log', 'input.txt'], ['verbose']);
assert.strictEqual(res2.flags.output, 'out.log');
assert.deepStrictEqual(res2.positional, ['input.txt']);

// Test 3: mixed flags
const res3 = parseArgs(['--dry-run', '--config', 'app.json', 'target'], ['dry-run']);
assert.strictEqual(res3.flags['dry-run'], true);
assert.strictEqual(res3.flags.config, 'app.json');
assert.deepStrictEqual(res3.positional, ['target']);

console.log('ALL_TESTS_PASSED');
`
    },
    hiddenTests: [
      {
        name: 'verify_boolean_args_parsing',
        command: 'node test/verify.js',
        expectedExitCode: 0,
        expectedOutputContains: 'ALL_TESTS_PASSED'
      }
    ],
    graders: [
      {
        key: 'cli_parser_unit_tests',
        version: '1.0.0',
        type: 'test_runner',
        description: 'Verify parser handles boolean and valued flags accurately without dropping positional arguments.',
        config: {
          testCommands: [
            {
              name: 'verify_boolean_args_parsing',
              command: 'node test/verify.js',
              expectedExitCode: 0,
              expectedOutputContains: 'ALL_TESTS_PASSED'
            }
          ]
        }
      },
      {
        key: 'cli_parser_integrity',
        version: '1.0.0',
        type: 'file_integrity',
        description: 'Ensure only target file was modified',
        config: {
          readOnlyFiles: ['test/verify.js', 'package.json']
        }
      }
    ]
  },

  {
    key: 'neutral_lru_cache_ttl',
    category: 'implement_feature',
    title: 'Implement LRU Cache with TTL Eviction',
    description: 'Implement Least-Recently-Used cache with capacity limits and millisecond TTL expiration.',
    prompt: 'Implement LRUCache in src/lru.js supporting get(key), set(key, value, ttlMs), size(), and automatic eviction on capacity overflow or TTL expiration.',
    timeLimitSeconds: 90,
    weight: 1.5,
    expectedModifiedFiles: ['src/lru.js'],
    readOnlyFiles: ['test/verify.js'],
    files: {
      'package.json': JSON.stringify({ name: 'neutral-lru-cache', type: 'commonjs' }, null, 2),
      'src/lru.js': `class LRUCache {
  constructor(capacity) {
    this.capacity = capacity;
    this.cache = new Map();
  }

  get(key) {
    // TODO: implement LRU access order update & TTL check
    return undefined;
  }

  set(key, value, ttlMs = 0) {
    // TODO: implement set with TTL and capacity eviction
  }

  size() {
    return this.cache.size;
  }
}

module.exports = { LRUCache };
`,
      'test/verify.js': `const { LRUCache } = require('../src/lru.js');
const assert = require('assert');

const cache = new LRUCache(3);
cache.set('a', 1);
cache.set('b', 2);
cache.set('c', 3);

assert.strictEqual(cache.get('a'), 1, 'Key a should be 1');
cache.set('d', 4); // should evict 'b' since 'a' was recently accessed

assert.strictEqual(cache.get('b'), undefined, 'Key b should have been evicted');
assert.strictEqual(cache.get('a'), 1, 'Key a should still exist');
assert.strictEqual(cache.get('c'), 3, 'Key c should still exist');
assert.strictEqual(cache.get('d'), 4, 'Key d should exist');

// Test TTL
const ttlCache = new LRUCache(5);
ttlCache.set('temp', 99, 10); // 10ms TTL
assert.strictEqual(ttlCache.get('temp'), 99);

setTimeout(() => {
  assert.strictEqual(ttlCache.get('temp'), undefined, 'Expired key should return undefined');
  console.log('ALL_TESTS_PASSED');
}, 50);
`
    },
    hiddenTests: [
      {
        name: 'verify_lru_cache',
        command: 'node test/verify.js',
        expectedExitCode: 0,
        expectedOutputContains: 'ALL_TESTS_PASSED'
      }
    ],
    graders: [
      {
        key: 'lru_cache_tests',
        version: '1.0.0',
        type: 'test_runner',
        description: 'Verify LRU access tracking and TTL expiration work deterministically.',
        config: {
          testCommands: [
            {
              name: 'verify_lru_cache',
              command: 'node test/verify.js',
              expectedExitCode: 0,
              expectedOutputContains: 'ALL_TESTS_PASSED'
            }
          ]
        }
      }
    ]
  },

  {
    key: 'neutral_sql_query_builder',
    category: 'modify_schema',
    title: 'Add Parameterized IN-Clause Expansion in Query Builder',
    description: 'Add safe parameterized WHERE ... IN (?) array expansion to prevent SQL injection.',
    prompt: 'Update buildWhere in src/queryBuilder.js to safely expand array parameters in WHERE conditions into comma-separated placeholders with matching param bindings.',
    timeLimitSeconds: 60,
    weight: 1,
    expectedModifiedFiles: ['src/queryBuilder.js'],
    readOnlyFiles: ['test/verify.js'],
    files: {
      'package.json': JSON.stringify({ name: 'neutral-query-builder', type: 'commonjs' }, null, 2),
      'src/queryBuilder.js': `function buildSelect(table, conditions = {}) {
  const keys = Object.keys(conditions);
  if (keys.length === 0) {
    return { sql: \`SELECT * FROM \${table}\`, params: [] };
  }

  const clauses = [];
  const params = [];

  for (const key of keys) {
    const val = conditions[key];
    if (Array.isArray(val)) {
      // BUG: does not handle empty array or expand placeholders properly
      clauses.push(\`\${key} IN (?)\`);
      params.push(val);
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
`,
      'test/verify.js': `const { buildSelect } = require('../src/queryBuilder.js');
const assert = require('assert');

// Test 1: Single values
const res1 = buildSelect('users', { status: 'active', role: 'admin' });
assert.strictEqual(res1.sql, 'SELECT * FROM users WHERE status = ? AND role = ?');
assert.deepStrictEqual(res1.params, ['active', 'admin']);

// Test 2: Array values expanded
const res2 = buildSelect('items', { category: 'electronics', id: [10, 20, 30] });
assert.strictEqual(res2.sql, 'SELECT * FROM items WHERE category = ? AND id IN (?, ?, ?)');
assert.deepStrictEqual(res2.params, ['electronics', 10, 20, 30]);

// Test 3: Empty array safe fallback (e.g. 1=0 or IN (NULL))
const res3 = buildSelect('items', { id: [] });
assert.ok(res3.sql.includes('1=0') || res3.sql.includes('IN (NULL)') || res3.params.length === 0);

console.log('ALL_TESTS_PASSED');
`
    },
    hiddenTests: [
      {
        name: 'verify_query_builder',
        command: 'node test/verify.js',
        expectedExitCode: 0,
        expectedOutputContains: 'ALL_TESTS_PASSED'
      }
    ],
    graders: [
      {
        key: 'query_builder_tests',
        version: '1.0.0',
        type: 'test_runner',
        description: 'Verify safe parameterized array expansion in SQL query builder.',
        config: {
          testCommands: [
            {
              name: 'verify_query_builder',
              command: 'node test/verify.js',
              expectedExitCode: 0,
              expectedOutputContains: 'ALL_TESTS_PASSED'
            }
          ]
        }
      }
    ]
  },

  {
    key: 'neutral_async_event_emitter',
    category: 'repair_test',
    title: 'Repair Listener Memory Leak in EventEmitter',
    description: 'Fix dangling listeners on once() with AbortSignal in EventEmitter implementation.',
    prompt: 'Fix EventEmitter.once in src/emitter.js so that if an AbortSignal triggers before the event fires, the event listener is cleaned up immediately.',
    timeLimitSeconds: 60,
    weight: 1,
    expectedModifiedFiles: ['src/emitter.js'],
    readOnlyFiles: ['test/verify.js'],
    files: {
      'package.json': JSON.stringify({ name: 'neutral-event-emitter', type: 'commonjs' }, null, 2),
      'src/emitter.js': `class SafeEventEmitter {
  constructor() {
    this.listeners = new Map();
  }

  on(event, fn) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(fn);
    return () => this.off(event, fn);
  }

  off(event, fn) {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(fn);
      if (set.size === 0) this.listeners.delete(event);
    }
  }

  emit(event, ...args) {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of Array.from(set)) {
      fn(...args);
    }
  }

  listenerCount(event) {
    return this.listeners.get(event)?.size || 0;
  }

  once(event, signal) {
    return new Promise((resolve, reject) => {
      const handler = (...args) => {
        cleanup();
        resolve(args[0]);
      };

      const onAbort = () => {
        cleanup();
        reject(new Error('Operation aborted'));
      };

      const cleanup = () => {
        this.off(event, handler);
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
      };

      if (signal?.aborted) {
        return reject(new Error('Operation aborted'));
      }

      if (signal) {
        signal.addEventListener('abort', onAbort);
      }

      this.on(event, handler);
    });
  }
}

module.exports = { SafeEventEmitter };
`,
      'test/verify.js': `const { SafeEventEmitter } = require('../src/emitter.js');
const assert = require('assert');

async function run() {
  const ee = new SafeEventEmitter();

  // Test 1: normal once resolution
  const p1 = ee.once('data');
  assert.strictEqual(ee.listenerCount('data'), 1);
  ee.emit('data', 'hello');
  const val1 = await p1;
  assert.strictEqual(val1, 'hello');
  assert.strictEqual(ee.listenerCount('data'), 0, 'Listener should be cleaned up after firing');

  // Test 2: abort cleanup
  const controller = new AbortController();
  const p2 = ee.once('data', controller.signal);
  assert.strictEqual(ee.listenerCount('data'), 1);
  controller.abort();

  await assert.rejects(p2, /Operation aborted/);
  assert.strictEqual(ee.listenerCount('data'), 0, 'Listener must be cleaned up on abort');

  console.log('ALL_TESTS_PASSED');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
`
    },
    hiddenTests: [
      {
        name: 'verify_event_emitter',
        command: 'node test/verify.js',
        expectedExitCode: 0,
        expectedOutputContains: 'ALL_TESTS_PASSED'
      }
    ],
    graders: [
      {
        key: 'emitter_tests',
        version: '1.0.0',
        type: 'test_runner',
        description: 'Verify EventEmitter once cleanup on execution and abort signal.',
        config: {
          testCommands: [
            {
              name: 'verify_event_emitter',
              command: 'node test/verify.js',
              expectedExitCode: 0,
              expectedOutputContains: 'ALL_TESTS_PASSED'
            }
          ]
        }
      }
    ]
  },

  {
    key: 'neutral_semver_resolver',
    category: 'build_package',
    title: 'Implement SemVer Range Matcher & Pre-Release Precedence',
    description: 'Implement semantic version comparator supporting caret (^), tilde (~), and pre-release precedence.',
    prompt: 'In src/semver.js, implement compare(v1, v2) and satisfies(version, range) conforming to SemVer 2.0.0 specification.',
    timeLimitSeconds: 60,
    weight: 1,
    expectedModifiedFiles: ['src/semver.js'],
    readOnlyFiles: ['test/verify.js'],
    files: {
      'package.json': JSON.stringify({ name: 'neutral-semver', type: 'commonjs' }, null, 2),
      'src/semver.js': `function parseVersion(v) {
  const match = v.trim().match(/^(\\d+)\\.(\\d+)\\.(\\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) throw new Error(\`Invalid semver: \${v}\`);
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4] || null
  };
}

function compare(v1, v2) {
  const p1 = parseVersion(v1);
  const p2 = parseVersion(v2);

  if (p1.major !== p2.major) return p1.major - p2.major;
  if (p1.minor !== p2.minor) return p1.minor - p2.minor;
  if (p1.patch !== p2.patch) return p1.patch - p2.patch;

  if (p1.prerelease && !p2.prerelease) return -1;
  if (!p1.prerelease && p2.prerelease) return 1;
  if (p1.prerelease && p2.prerelease) {
    return p1.prerelease.localeCompare(p2.prerelease);
  }
  return 0;
}

function satisfies(version, range) {
  const v = parseVersion(version);
  const trimmed = range.trim();

  if (trimmed.startsWith('^')) {
    const base = parseVersion(trimmed.slice(1));
    if (v.major !== base.major) return false;
    return compare(version, trimmed.slice(1)) >= 0;
  }

  if (trimmed.startsWith('~')) {
    const base = parseVersion(trimmed.slice(1));
    if (v.major !== base.major || v.minor !== base.minor) return false;
    return compare(version, trimmed.slice(1)) >= 0;
  }

  return compare(version, trimmed) === 0;
}

module.exports = { parseVersion, compare, satisfies };
`,
      'test/verify.js': `const { compare, satisfies } = require('../src/semver.js');
const assert = require('assert');

// Test 1: basic comparisons
assert.ok(compare('1.2.3', '1.2.2') > 0);
assert.ok(compare('1.2.3', '1.2.3') === 0);
assert.ok(compare('1.2.3', '1.3.0') < 0);

// Test 2: pre-release precedence
assert.ok(compare('1.0.0-alpha', '1.0.0') < 0, '1.0.0-alpha < 1.0.0');
assert.ok(compare('1.0.0-alpha.1', '1.0.0-alpha.2') < 0);

// Test 3: Caret ranges
assert.strictEqual(satisfies('1.2.5', '^1.2.0'), true);
assert.strictEqual(satisfies('1.9.0', '^1.2.0'), true);
assert.strictEqual(satisfies('2.0.0', '^1.2.0'), false);

// Test 4: Tilde ranges
assert.strictEqual(satisfies('1.2.5', '~1.2.0'), true);
assert.strictEqual(satisfies('1.3.0', '~1.2.0'), false);

console.log('ALL_TESTS_PASSED');
`
    },
    hiddenTests: [
      {
        name: 'verify_semver',
        command: 'node test/verify.js',
        expectedExitCode: 0,
        expectedOutputContains: 'ALL_TESTS_PASSED'
      }
    ],
    graders: [
      {
        key: 'semver_tests',
        version: '1.0.0',
        type: 'test_runner',
        description: 'Verify SemVer comparisons and caret/tilde range matching.',
        config: {
          testCommands: [
            {
              name: 'verify_semver',
              command: 'node test/verify.js',
              expectedExitCode: 0,
              expectedOutputContains: 'ALL_TESTS_PASSED'
            }
          ]
        }
      }
    ]
  },

  {
    key: 'neutral_retry_backoff',
    category: 'recover_failure',
    title: 'Implement Exponential Backoff with Jitter and Abort',
    description: 'Implement resilient retry utility with exponential delay, full jitter, and cancellation.',
    prompt: 'In src/retry.js, implement retryAsync(fn, options) supporting maxRetries, initialDelayMs, maxDelayMs, backoffFactor, and abortSignal.',
    timeLimitSeconds: 60,
    weight: 1,
    expectedModifiedFiles: ['src/retry.js'],
    readOnlyFiles: ['test/verify.js'],
    files: {
      'package.json': JSON.stringify({ name: 'neutral-retry', type: 'commonjs' }, null, 2),
      'src/retry.js': `async function retryAsync(fn, options = {}) {
  const maxRetries = options.maxRetries ?? 3;
  const initialDelayMs = options.initialDelayMs ?? 10;
  const maxDelayMs = options.maxDelayMs ?? 1000;
  const backoffFactor = options.backoffFactor ?? 2;
  const signal = options.signal;

  let attempt = 0;
  let delay = initialDelayMs;

  while (true) {
    if (signal?.aborted) {
      throw new Error('Operation aborted');
    }

    try {
      return await fn(attempt);
    } catch (err) {
      attempt++;
      if (attempt > maxRetries) {
        throw err;
      }

      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, delay);
        if (signal) {
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('Operation aborted'));
          }, { once: true });
        }
      });

      delay = Math.min(maxDelayMs, delay * backoffFactor);
    }
  }
}

module.exports = { retryAsync };
`,
      'test/verify.js': `const { retryAsync } = require('../src/retry.js');
const assert = require('assert');

async function run() {
  // Test 1: Successful retry after 2 failures
  let calls = 0;
  const res = await retryAsync(async (attempt) => {
    calls++;
    if (attempt < 2) throw new Error('Transient error');
    return 'success';
  }, { initialDelayMs: 5 });

  assert.strictEqual(res, 'success');
  assert.strictEqual(calls, 3);

  // Test 2: Exhausted retries
  let failedCalls = 0;
  await assert.rejects(async () => {
    await retryAsync(async () => {
      failedCalls++;
      throw new Error('Fatal error');
    }, { maxRetries: 2, initialDelayMs: 5 });
  }, /Fatal error/);
  assert.strictEqual(failedCalls, 3);

  // Test 3: AbortSignal cancellation
  const controller = new AbortController();
  const retryPromise = retryAsync(async () => {
    throw new Error('Retry me');
  }, { maxRetries: 10, initialDelayMs: 100, signal: controller.signal });

  setTimeout(() => controller.abort(), 20);
  await assert.rejects(retryPromise, /Operation aborted/);

  console.log('ALL_TESTS_PASSED');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
`
    },
    hiddenTests: [
      {
        name: 'verify_retry',
        command: 'node test/verify.js',
        expectedExitCode: 0,
        expectedOutputContains: 'ALL_TESTS_PASSED'
      }
    ],
    graders: [
      {
        key: 'retry_tests',
        version: '1.0.0',
        type: 'test_runner',
        description: 'Verify retry backoff, attempt counting, and abort cancellation.',
        config: {
          testCommands: [
            {
              name: 'verify_retry',
              command: 'node test/verify.js',
              expectedExitCode: 0,
              expectedOutputContains: 'ALL_TESTS_PASSED'
            }
          ]
        }
      }
    ]
  },

  {
    key: 'neutral_strict_lint_rules',
    category: 'follow_repo_rules',
    title: 'Implement Type-Safe Helper Adhering to Strict Code Rules',
    description: 'Implement safe deep clone function without using any forbidden patterns (no eval, no Function, preserve comments, strict types).',
    prompt: 'In src/deepClone.js, implement deepClone(obj) preserving circular references, Dates, RegExps, Maps, Sets, and Arrays. Do not use eval, Function, or lodash.',
    timeLimitSeconds: 60,
    weight: 1,
    expectedModifiedFiles: ['src/deepClone.js'],
    readOnlyFiles: ['test/verify.js'],
    files: {
      'package.json': JSON.stringify({ name: 'neutral-deep-clone', type: 'commonjs' }, null, 2),
      'src/deepClone.js': `/**
 * Performs a deep clone of complex JavaScript data structures.
 * Rules:
 * - Must preserve Dates, RegExps, Maps, Sets
 * - Must handle circular references safely
 * - Must not use eval or Function constructor
 */
function deepClone(value, visited = new WeakMap()) {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (visited.has(value)) {
    return visited.get(value);
  }

  if (value instanceof Date) {
    return new Date(value.getTime());
  }

  if (value instanceof RegExp) {
    return new RegExp(value.source, value.flags);
  }

  if (value instanceof Map) {
    const copy = new Map();
    visited.set(value, copy);
    for (const [k, v] of value.entries()) {
      copy.set(deepClone(k, visited), deepClone(v, visited));
    }
    return copy;
  }

  if (value instanceof Set) {
    const copy = new Set();
    visited.set(value, copy);
    for (const item of value) {
      copy.add(deepClone(item, visited));
    }
    return copy;
  }

  if (Array.isArray(value)) {
    const copy = [];
    visited.set(value, copy);
    for (let i = 0; i < value.length; i++) {
      copy[i] = deepClone(value[i], visited);
    }
    return copy;
  }

  const copy = Object.create(Object.getPrototypeOf(value));
  visited.set(value, copy);
  for (const key of Object.keys(value)) {
    copy[key] = deepClone(value[key], visited);
  }
  return copy;
}

module.exports = { deepClone };
`,
      'test/verify.js': `const { deepClone } = require('../src/deepClone.js');
const assert = require('assert');

// Test 1: Complex object with Date and RegExp
const orig = {
  num: 42,
  str: 'hello',
  date: new Date('2026-01-01T00:00:00Z'),
  regex: /test/gi,
  map: new Map([['k1', { v: 1 }]]),
  set: new Set([1, 2, 3])
};

const cloned = deepClone(orig);
assert.deepStrictEqual(cloned, orig);
assert.notStrictEqual(cloned, orig);
assert.notStrictEqual(cloned.date, orig.date);
assert.notStrictEqual(cloned.map, orig.map);
assert.notStrictEqual(cloned.map.get('k1'), orig.map.get('k1'));

// Test 2: Circular reference
const circular = { name: 'root' };
circular.self = circular;

const circularCloned = deepClone(circular);
assert.strictEqual(circularCloned.name, 'root');
assert.strictEqual(circularCloned.self, circularCloned);
assert.notStrictEqual(circularCloned, circular);

console.log('ALL_TESTS_PASSED');
`
    },
    hiddenTests: [
      {
        name: 'verify_deep_clone',
        command: 'node test/verify.js',
        expectedExitCode: 0,
        expectedOutputContains: 'ALL_TESTS_PASSED'
      }
    ],
    graders: [
      {
        key: 'deep_clone_tests',
        version: '1.0.0',
        type: 'test_runner',
        description: 'Verify deep clone handles complex structures and circular references.',
        config: {
          testCommands: [
            {
              name: 'verify_deep_clone',
              command: 'node test/verify.js',
              expectedExitCode: 0,
              expectedOutputContains: 'ALL_TESTS_PASSED'
            }
          ]
        }
      },
      {
        key: 'repo_rules_no_eval',
        version: '1.0.0',
        type: 'file_content',
        description: 'Verify no forbidden eval or Function constructors are used.',
        config: {
          targetFiles: ['src/deepClone.js'],
          forbiddenPatterns: [/\beval\s*\(/, /\bnew\s+Function\s*\(/]
        }
      }
    ]
  }
];

export function getFixtureByKey(key: string): DynoFixture | undefined {
  return NEUTRAL_DEV_FIXTURES.find(f => f.key === key);
}

export function getFixturesByCategory(category: DynoTaskCategory): readonly DynoFixture[] {
  return NEUTRAL_DEV_FIXTURES.filter(f => f.category === category);
}

export function computeFixtureDigest(fixture: DynoFixture): string {
  return digestFileManifest(fixture.files);
}

export function computePromptDigest(prompt: string): string {
  return sha256(prompt.trim());
}

export function computeGraderManifestDigest(graders: readonly unknown[]): string {
  return sha256Json(graders);
}

/**
 * Reference solutions for calibration and deterministic verification of all task fixtures.
 */
export const REFERENCE_SOLUTIONS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  neutral_cli_arg_parser: {
    'src/parser.js': `function parseArgs(args, booleanFlags = []) {
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
`
  },
  neutral_lru_cache_ttl: {
    'src/lru.js': `class LRUCache {
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
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key, value, ttlMs = 0) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.capacity) {
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
`
  },
  neutral_sql_query_builder: {
    'src/queryBuilder.js': `function buildSelect(table, conditions = {}) {
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
`
  },
  neutral_async_event_emitter: {
    'src/emitter.js': `class SafeEventEmitter {
  constructor() {
    this.listeners = new Map();
  }

  on(event, fn) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(fn);
    return () => this.off(event, fn);
  }

  off(event, fn) {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(fn);
      if (set.size === 0) this.listeners.delete(event);
    }
  }

  emit(event, ...args) {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of Array.from(set)) {
      fn(...args);
    }
  }

  listenerCount(event) {
    return this.listeners.get(event)?.size || 0;
  }

  once(event, signal) {
    return new Promise((resolve, reject) => {
      const handler = (...args) => {
        cleanup();
        resolve(args[0]);
      };

      const onAbort = () => {
        cleanup();
        reject(new Error('Operation aborted'));
      };

      const cleanup = () => {
        this.off(event, handler);
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
      };

      if (signal?.aborted) {
        return reject(new Error('Operation aborted'));
      }

      if (signal) {
        signal.addEventListener('abort', onAbort);
      }

      this.on(event, handler);
    });
  }
}

module.exports = { SafeEventEmitter };
`
  },
  neutral_semver_resolver: {
    'src/semver.js': `function parseVersion(v) {
  const match = v.trim().match(/^(\\d+)\\.(\\d+)\\.(\\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) throw new Error(\`Invalid semver: \${v}\`);
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4] || null
  };
}

function compare(v1, v2) {
  const p1 = parseVersion(v1);
  const p2 = parseVersion(v2);

  if (p1.major !== p2.major) return p1.major - p2.major;
  if (p1.minor !== p2.minor) return p1.minor - p2.minor;
  if (p1.patch !== p2.patch) return p1.patch - p2.patch;

  if (p1.prerelease && !p2.prerelease) return -1;
  if (!p1.prerelease && p2.prerelease) return 1;
  if (p1.prerelease && p2.prerelease) {
    return p1.prerelease.localeCompare(p2.prerelease);
  }
  return 0;
}

function satisfies(version, range) {
  const v = parseVersion(version);
  const trimmed = range.trim();

  if (trimmed.startsWith('^')) {
    const base = parseVersion(trimmed.slice(1));
    if (v.major !== base.major) return false;
    return compare(version, trimmed.slice(1)) >= 0;
  }

  if (trimmed.startsWith('~')) {
    const base = parseVersion(trimmed.slice(1));
    if (v.major !== base.major || v.minor !== base.minor) return false;
    return compare(version, trimmed.slice(1)) >= 0;
  }

  return compare(version, trimmed) === 0;
}

module.exports = { parseVersion, compare, satisfies };
`
  },
  neutral_retry_backoff: {
    'src/retry.js': `async function retryAsync(fn, options = {}) {
  const maxRetries = options.maxRetries ?? 3;
  const initialDelayMs = options.initialDelayMs ?? 10;
  const maxDelayMs = options.maxDelayMs ?? 1000;
  const backoffFactor = options.backoffFactor ?? 2;
  const signal = options.signal;

  let attempt = 0;
  let delay = initialDelayMs;

  while (true) {
    if (signal?.aborted) {
      throw new Error('Operation aborted');
    }

    try {
      return await fn(attempt);
    } catch (err) {
      attempt++;
      if (attempt > maxRetries) {
        throw err;
      }

      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, delay);
        if (signal) {
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('Operation aborted'));
          }, { once: true });
        }
      });

      delay = Math.min(maxDelayMs, delay * backoffFactor);
    }
  }
}

module.exports = { retryAsync };
`
  },
  neutral_strict_lint_rules: {
    'src/deepClone.js': `/**
 * Performs a deep clone of complex JavaScript data structures.
 * Rules:
 * - Must preserve Dates, RegExps, Maps, Sets
 * - Must handle circular references safely
 * - Must not use eval or Function constructor
 */
function deepClone(value, visited = new WeakMap()) {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (visited.has(value)) {
    return visited.get(value);
  }

  if (value instanceof Date) {
    return new Date(value.getTime());
  }

  if (value instanceof RegExp) {
    return new RegExp(value.source, value.flags);
  }

  if (value instanceof Map) {
    const copy = new Map();
    visited.set(value, copy);
    for (const [k, v] of value.entries()) {
      copy.set(deepClone(k, visited), deepClone(v, visited));
    }
    return copy;
  }

  if (value instanceof Set) {
    const copy = new Set();
    visited.set(value, copy);
    for (const item of value) {
      copy.add(deepClone(item, visited));
    }
    return copy;
  }

  if (Array.isArray(value)) {
    const copy = [];
    visited.set(value, copy);
    for (let i = 0; i < value.length; i++) {
      copy[i] = deepClone(value[i], visited);
    }
    return copy;
  }

  const copy = Object.create(Object.getPrototypeOf(value));
  visited.set(value, copy);
  for (const key of Object.keys(value)) {
    copy[key] = deepClone(value[key], visited);
  }
  return copy;
}

module.exports = { deepClone };
`
  }
};

export function getReferenceSolution(taskKey: string): Readonly<Record<string, string>> | undefined {
  return REFERENCE_SOLUTIONS[taskKey];
}
