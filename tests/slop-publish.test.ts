import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { handleDrop, runSlopCli } from '../bin/slop.ts';

describe('SLOP CLI Publisher (slop drop / slop publish)', () => {
  const originalSlopToken = process.env.SLOP_SESSION_TOKEN;
  const originalSessionToken = process.env.SESSION_TOKEN;
  const originalAuthToken = process.env.AUTH_TOKEN;
  // Credential isolation: pin XDG_CONFIG_HOME to a temp dir so a REAL persisted
  // login (~/.config/slop/credentials) can never make these "unauthenticated,
  // fails closed" tests silently authenticate. See slop-cli.test.ts for the
  // incident this guards against.
  const originalXdg = process.env.XDG_CONFIG_HOME;
  let xdgTemp: string | null = null;

  beforeEach(() => {
    delete process.env.SLOP_SESSION_TOKEN;
    delete process.env.SESSION_TOKEN;
    delete process.env.AUTH_TOKEN;
    xdgTemp = mkdtempSync(join(tmpdir(), 'slop-publish-xdg-'));
    process.env.XDG_CONFIG_HOME = xdgTemp;
  });

  afterEach(() => {
    if (originalSlopToken !== undefined) process.env.SLOP_SESSION_TOKEN = originalSlopToken;
    else delete process.env.SLOP_SESSION_TOKEN;
    if (originalSessionToken !== undefined) process.env.SESSION_TOKEN = originalSessionToken;
    else delete process.env.SESSION_TOKEN;
    if (originalAuthToken !== undefined) process.env.AUTH_TOKEN = originalAuthToken;
    else delete process.env.AUTH_TOKEN;
    if (originalXdg !== undefined) process.env.XDG_CONFIG_HOME = originalXdg;
    else delete process.env.XDG_CONFIG_HOME;
    if (xdgTemp) rmSync(xdgTemp, { recursive: true, force: true });
    xdgTemp = null;
  });

  it('should prepare metadata but fail closed without an authenticated CLI session', async () => {
    const res = await handleDrop(['dronehunter', '--name=DroneHunter 95', '--price=15']);
    expect(res.success).toBe(false);
    expect(res.command).toBe('drop');
    expect(res.data.appId).toBe('dronehunter');
    expect(res.data.priceCents).toBe(1500);
    expect(res.data.batch).toBeNull();
    expect(res.data.queued).toBe(false);
    expect(res.data.published).toBe(false);
    expect(res.message).toContain('slop login');
  });

  it('should route slop publish through runSlopCli router', async () => {
    const res = await runSlopCli(['publish', 'certified-mailer', '--name=Certified Mailer']);
    expect(res.success).toBe(false);
    expect(res.command).toBe('drop');
    expect(res.data.appId).toBe('certified-mailer');
    expect(res.data.deployed).toBe(false);
  });
});
