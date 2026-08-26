import { describe, it, expect } from 'vitest';
import { checkDeployability, runColdPushPipeline } from '../src/lib/autopilotDeployer';

describe('Strict Push -> Check -> Deploy Pipeline (Zero Code Editing)', () => {
  it('should reject repos larger than 100MB without deploying', async () => {
    const hugeSize = 120 * 1024 * 1024;
    const result = await runColdPushPipeline('heavy-repo', ['index.html'], hugeSize);
    expect(result.success).toBe(false);
    expect(result.status).toBe('rejected_size');
  });

  it('should deploy raw static web apps without modifying code', async () => {
    const result = await runColdPushPipeline('dronehunter', ['index.html', 'game.js'], 5 * 1024 * 1024);
    expect(result.success).toBe(true);
    expect(result.status).toBe('deployed_raw');
    expect(result.rawDeployedUrl).toBe('https://dronehunter.pages.dev');
    expect(result.logs.some(l => l.includes('Zero Code Editing Invariant'))).toBe(true);
  });

  it('should check deployability for script/CLI repos', () => {
    const report = checkDeployability('certified-mailer', ['pyproject.toml', 'tools/build_dispute_letter.py'], 2 * 1024 * 1024);
    expect(report.isDeployable).toBe(true);
    expect(report.detectedType).toBe('script-cli');
  });
});
