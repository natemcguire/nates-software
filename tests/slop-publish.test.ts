import { describe, it, expect } from 'vitest';
import { handleDrop, runSlopCli } from '../bin/slop.ts';

describe('SLOP CLI Publisher (slop drop / slop publish)', () => {
  it('should prepare metadata but fail closed without HOTWIRE transport', () => {
    const res = handleDrop(['dronehunter', '--name=DroneHunter 95', '--price=15']);
    expect(res.success).toBe(false);
    expect(res.command).toBe('drop');
    expect(res.data.appId).toBe('dronehunter');
    expect(res.data.priceCents).toBe(1500);
    expect(res.data.batch).toBeNull();
    expect(res.data.queued).toBe(false);
    expect(res.data.published).toBe(false);
  });

  it('should route slop publish through runSlopCli router', async () => {
    const res = await runSlopCli(['publish', 'certified-mailer', '--name=Certified Mailer']);
    expect(res.success).toBe(false);
    expect(res.command).toBe('drop');
    expect(res.data.appId).toBe('certified-mailer');
    expect(res.data.deployed).toBe(false);
  });
});
