import { describe, expect, it } from 'vitest';
import { formatForkPrompt } from '../src/components/ForkWithAiModal';

describe('fork prompt handoff', () => {
  it('formats the selected prompt and tool for a real post-fork handoff', () => {
    expect(formatForkPrompt('cursor', 'maker/my-fork', 'Add local export.')).toBe(
      'Target repository: maker/my-fork\nTool: Cursor\n\nGoal:\nAdd local export.'
    );
  });
});
