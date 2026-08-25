import { describe, it, expect } from 'vitest';
import { INITIAL_THREADS, filterThreadsByCategory } from '../src/lib/inboxDomain';

describe('INBOX 3-Pane Client & Merge Proposals', () => {
  it('should initialize with valid threads', () => {
    expect(INITIAL_THREADS.length).toBeGreaterThan(0);
    INITIAL_THREADS.forEach(t => {
      expect(t.id).toBeDefined();
      expect(t.subject).toBeDefined();
    });
  });

  it('should filter threads by category correctly', () => {
    const proposals = filterThreadsByCategory(INITIAL_THREADS, 'proposals');
    expect(proposals.length).toBe(2);
    expect(proposals.every(p => p.category === 'proposals')).toBe(true);

    const all = filterThreadsByCategory(INITIAL_THREADS, 'all');
    expect(all.length).toBe(INITIAL_THREADS.length);
  });
});
