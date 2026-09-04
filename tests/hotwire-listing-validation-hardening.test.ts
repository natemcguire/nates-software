import { describe, it, expect } from 'vitest';
import { validateDropSubmission } from '../src/lib/hotwireDomain';

const base = { name: 'Valid App', version: 'v1.0.0' };

describe('validateDropSubmission rejects non-string array members (NSW-144)', () => {
  it('rejects a non-string tag element', () => {
    const r = validateDropSubmission({ ...base, tags: ['ok', {} as any] });
    expect(r.valid).toBe(false);
  });

  it('rejects a numeric screenshot element', () => {
    const r = validateDropSubmission({ ...base, screenshots: [1 as any] });
    expect(r.valid).toBe(false);
  });

  it('accepts well-formed string tags and screenshots', () => {
    const r = validateDropSubmission({ ...base, tags: ['tool', 'retro'], screenshots: ['https://example.com/a.png'] });
    expect(r.valid).toBe(true);
  });
});
