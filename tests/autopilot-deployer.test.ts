import { describe, it, expect } from 'vitest';
import { detectAppStack, createDeploymentPlan, executeAutoDeploy } from '../src/lib/autopilotDeployer';

describe('Autopilot Deployment Engine Suite', () => {
  it('should detect PHP/SQLite stack and mandate isolated D1 database', () => {
    const stack = detectAppStack('picfitai', ['index.php', 'generate.php', 'config.php', 'migrations/0001_initial.sql']);
    expect(stack.type).toBe('php-sqlite');
    expect(stack.requiresDedicatedDb).toBe(true);
    expect(stack.dbName).toBe('picfitai-d1');
    expect(stack.maxConcurrency).toBe(10);
  });

  it('should detect Python CLI/Script stack', () => {
    const stack = detectAppStack('certified-mailer', ['pyproject.toml', 'tools/build_dispute_letter.py', 'README.md']);
    expect(stack.type).toBe('cli-script');
    expect(stack.requiresDedicatedDb).toBe(true);
    expect(stack.dbName).toBe('certified-mailer-d1');
  });

  it('should detect HTML5 Canvas game stack', () => {
    const stack = detectAppStack('dronehunter', ['index.html', 'game.js', 'style.css']);
    expect(stack.type).toBe('static-html5');
    expect(stack.requiresDedicatedDb).toBe(true);
    expect(stack.dbName).toBe('dronehunter-d1');
  });

  it('should generate complete deployment plan with custom domain and DNS steps', () => {
    const plan = createDeploymentPlan('picfitai', ['index.php', 'generate.php']);
    expect(plan.projectName).toBe('picfitai');
    expect(plan.customDomain).toBe('picfitai.nates-software.com');
    expect(plan.d1DatabaseName).toBe('picfitai-d1');
    expect(plan.steps.length).toBe(7);
    expect(plan.steps[1]).toContain('picfitai-d1');
  });

  it('should execute autopilot deployment successfully with zero lock collisions', async () => {
    const plan = createDeploymentPlan('dronehunter', ['index.html']);
    const result = await executeAutoDeploy(plan);
    expect(result.success).toBe(true);
    expect(result.liveUrl).toBe('https://dronehunter.pages.dev');
    expect(result.customDomainUrl).toBe('https://dronehunter.nates-software.com');
    expect(result.logs.some(l => l.includes('10 max concurrent users'))).toBe(true);
  });
});
