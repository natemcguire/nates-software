import { renderToString } from 'react-dom/server';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DynoView } from '../src/views/DynoView';

const renderDyno = () => renderToString(<DynoView />);

describe('DynoView honest subject defaults (no fabricated pre-integrated model/harness claims)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, acceptingJobs: false, message: 'offline' })
    } as Response);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('does not hardcode gemini-3.7-flash-high, Antigravity CLI, or the agy shell command as defaults', () => {
    const html = renderDyno();

    expect(html).not.toContain('gemini-3.7-flash-high');
    expect(html).not.toContain('Antigravity CLI');
    expect(html).not.toContain('agy --model');
  });

  it('renders blank subject inputs with honest, non-product-claim placeholders', () => {
    const html = renderDyno();

    expect(html).toContain('placeholder="e.g. claude-opus-4-8"');
    expect(html).toContain('placeholder="your agent harness"');
    expect(html).toContain('your run command');
  });

  it('does not use "commissioned integrations" language', () => {
    const html = renderDyno();
    expect(html.toLowerCase()).not.toContain('commissioned integrations');
  });

  it('shows an honest placeholder CLI command instead of a runnable command built from empty fields', () => {
    const html = renderDyno();
    expect(html).toContain('Enter your model, agent harness, and run command above');
    expect(html).not.toContain("--model=''");
    expect(html).not.toContain("--harness=''");
  });

  it('disables the CLI copy button until the subject is fully configured', () => {
    const html = renderDyno();
    const cliBlockIdx = html.indexOf('Execute local benchmark via CLI runner');
    expect(cliBlockIdx).toBeGreaterThan(-1);
    const nextButtonIdx = html.indexOf('<button', cliBlockIdx);
    const buttonSnippet = html.slice(nextButtonIdx, nextButtonIdx + 400);
    expect(buttonSnippet).toContain('disabled=""');
  });
});

describe('DynoView verifier availability messaging', () => {
  it('does not claim runs can become verified/reproduced unconditionally in static copy', () => {
    const html = renderDyno();
    expect(html).not.toContain('will be automatically verified');
    expect(html).not.toContain('will be reproduced automatically');
  });
});
