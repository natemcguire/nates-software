import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { LocalProcessProvider } from '../src/providers/LocalProcessProvider.js';

describe('Ephemeral Workspace Creation & Cleanup', () => {
  it('creates fresh temp workspace, initializes git and slop, and deletes on destroy', async () => {
    const provider = new LocalProcessProvider();
    const sessionId = `test-session-${Date.now()}`;

    // Create session
    const session = await provider.createSession({
      sessionId,
      username: 'nate'
    });

    expect(session.id).toBe(sessionId);
    expect(fs.existsSync(session.workspacePath)).toBe(true);

    // Verify workspace structure
    const pkgPath = path.join(session.workspacePath, 'package.json');
    const readmePath = path.join(session.workspacePath, 'README.md');
    const slopBinPath = path.join(session.workspacePath, 'bin/slop');
    const gitPath = path.join(session.workspacePath, '.git');

    expect(fs.existsSync(pkgPath)).toBe(true);
    expect(fs.existsSync(readmePath)).toBe(true);
    expect(fs.existsSync(slopBinPath)).toBe(true);
    expect(fs.existsSync(gitPath)).toBe(true);

    // Check executable permissions on slop launcher
    const stat = fs.statSync(slopBinPath);
    expect(stat.mode & 0o111).toBeGreaterThan(0); // Has execute bits

    // Verify process is alive
    expect(session.isAlive()).toBe(true);

    // Destroy session
    await session.destroy();

    // Verify ephemeral workspace is completely erased
    expect(fs.existsSync(session.workspacePath)).toBe(false);
    expect(session.isAlive()).toBe(false);
  });

  it('ensures platform secrets and LLM credentials are never passed to session environment', async () => {
    // Temporarily inject dummy secrets into process.env to verify sanitization
    const prevOpenAi = process.env.OPENAI_API_KEY;
    const prevAnthropic = process.env.ANTHROPIC_API_KEY;
    const prevStripe = process.env.STRIPE_SECRET_KEY;

    process.env.OPENAI_API_KEY = 'sk-secret-test-openai-key';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-secret-test-anthropic-key';
    process.env.STRIPE_SECRET_KEY = 'sk_live_secret_stripe_test';

    const provider = new LocalProcessProvider();
    const sessionId = `test-secret-scrub-${Date.now()}`;

    const session = await provider.createSession({ sessionId });

    let output = '';
    session.onOutput((chunk) => {
      output += chunk;
    });

    // Write command to print env
    session.write('env\n');

    // Wait a bit for command execution
    await new Promise((r) => setTimeout(r, 400));

    expect(output).not.toContain('sk-secret-test-openai-key');
    expect(output).not.toContain('sk-ant-secret-test-anthropic-key');
    expect(output).not.toContain('sk_live_secret_stripe_test');

    await session.destroy();

    // Restore env
    if (prevOpenAi) process.env.OPENAI_API_KEY = prevOpenAi; else delete process.env.OPENAI_API_KEY;
    if (prevAnthropic) process.env.ANTHROPIC_API_KEY = prevAnthropic; else delete process.env.ANTHROPIC_API_KEY;
    if (prevStripe) process.env.STRIPE_SECRET_KEY = prevStripe; else delete process.env.STRIPE_SECRET_KEY;
  });
});
