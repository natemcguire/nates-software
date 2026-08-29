import { describe, expect, it } from 'vitest';
import { WHITEPAPERS_DATA } from '../src/data/whitepapersData';

describe('RIG storage-freedom product contract', () => {
  it('describes RIG as a runtime boundary without forcing an app database', () => {
    const paper = WHITEPAPERS_DATA.rig;
    expect(paper).toContain('Runtime-Agnostic Preview and Build Isolation');
    expect(paper).toContain('SQLite and WAL');
    expect(paper).toContain('never platform requirements');
    expect(paper).toContain('or no persistence at all');
    expect(paper).not.toContain('journal_mode=WAL');
    expect(paper).not.toContain('Exactly one durable database volume');
    expect(paper).not.toContain('Every instance mounts');
  });

  it('keeps the suite boundary storage-neutral', () => {
    expect(WHITEPAPERS_DATA.suite).toContain('app + chosen storage');
    expect(WHITEPAPERS_DATA.suite).not.toContain('app + .sqlite');
  });
});
