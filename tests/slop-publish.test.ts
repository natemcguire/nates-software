import { describe, it, expect } from 'vitest';
import { handleDrop, runSlopCli } from '../bin/slop.ts';

describe('SLOP CLI Publisher (slop drop / slop publish)', () => {
  it('should package and queue app for 12:01 AM UTC daily drop', () => {
    const res = handleDrop(['dronehunter', '--name=DroneHunter 95', '--price=15']);
    expect(res.success).toBe(true);
    expect(res.command).toBe('drop');
    expect(res.data.appId).toBe('dronehunter');
    expect(res.data.priceCents).toBe(1500);
    expect(res.data.batch).toBe(85);
    expect(res.data.liveUrl).toContain('dronehunter');
  });

  it('should route slop publish through runSlopCli router', () => {
    const res = runSlopCli(['publish', 'certified-mailer', '--name=Certified Mailer']);
    expect(res.success).toBe(true);
    expect(res.command).toBe('drop');
    expect(res.data.appId).toBe('certified-mailer');
  });
});
