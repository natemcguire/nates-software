import { describe, it, expect } from 'vitest';
import { detectAppStack, createDeploymentPlan, executeAutoDeploy, publishToHotwire, MAX_REPO_SIZE_BYTES } from '../src/lib/autopilotDeployer';

describe('Autopilot Deployment Engine Suite', () => {
  it('should reject repositories over 100MB limit', () => {
    const hugeSize = 105 * 1024 * 1024;
    expect(() => detectAppStack('huge-app', ['index.html'], hugeSize)).toThrow(/exceeds maximum limit of 100MB/);
  });

  it('should detect PHP/SQLite stack and mandate isolated D1 database', () => {
    const stack = detectAppStack('picfitai', ['index.php', 'generate.php', 'config.php', 'migrations/0001_initial.sql']);
    expect(stack.type).toBe('php-sqlite');
    expect(stack.requiresDedicatedDb).toBe(true);
    expect(stack.dbName).toBe('picfitai-d1');
    expect(stack.maxConcurrency).toBe(10);
  });

  it('should generate plan with Hotwire publishing gated until explicit click', () => {
    const plan = createDeploymentPlan('picfitai', ['index.php', 'generate.php']);
    expect(plan.projectName).toBe('picfitai');
    expect(plan.isPublishedToHotwire).toBe(false);
    expect(plan.steps[6]).toContain("Pending 'Add to Hotwire'");
  });

  it('should allow publishing to Hotwire on explicit user action', () => {
    const res = publishToHotwire('picfitai');
    expect(res.success).toBe(true);
    expect(res.message).toContain('published to Hotwire');
  });
});
