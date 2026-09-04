import { describe, it, expect } from 'vitest';
import { fetchFrozenLiens } from '../src/lib/commerceDomain';

function fakeDb(rows: any[]) {
  const calls: { sql: string; args: any[] }[] = [];
  return {
    db: {
      prepare: (sql: string) => ({
        bind: (...args: any[]) => {
          calls.push({ sql, args });
          return {
            all: async () => ({ results: rows }),
          };
        },
      }),
    },
    calls,
  };
}

describe('fetchFrozenLiens', () => {
  it('maps rows to LienInput[] sorted root-first (depth DESC)', async () => {
    const { db, calls } = fakeDb([
      { ancestor_user_id: 'ann', ancestor_repository_id: 'repo_a', bps: 1000, depth: 2 },
      { ancestor_user_id: 'bob', ancestor_repository_id: 'repo_b', bps: 1000, depth: 1 },
    ]);

    const liens = await fetchFrozenLiens(db, 'repo_carol');

    expect(liens).toEqual([
      { ancestorUserId: 'ann', ancestorRepositoryId: 'repo_a', bps: 1000, depth: 2 },
      { ancestorUserId: 'bob', ancestorRepositoryId: 'repo_b', bps: 1000, depth: 1 },
    ]);

    expect(calls.length).toBe(1);
    expect(calls[0].sql).toContain('repository_fork_liens');
    expect(calls[0].sql).toContain('ORDER BY depth DESC');
    expect(calls[0].args).toEqual(['repo_carol']);
  });

  it('returns an empty array when there are no liens (root repository)', async () => {
    const { db } = fakeDb([]);
    const liens = await fetchFrozenLiens(db, 'repo_root');
    expect(liens).toEqual([]);
  });

  it('is defensively resilient to a missing results field', async () => {
    const db = {
      prepare: () => ({
        bind: () => ({
          all: async () => ({}),
        }),
      }),
    };
    const liens = await fetchFrozenLiens(db, 'repo_x');
    expect(liens).toEqual([]);
  });
});
