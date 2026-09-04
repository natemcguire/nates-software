import { describe, it, expect } from 'vitest';
import {
  REPO_COORDINATES,
  FEATURE_MOD_PRESETS,
  AGENT_TOOLS,
  WORKTREE_CONFIGS,
  getAppCoordinates,
  getAppCoordinate,
  getFeaturePresets,
  getAgentTools,
  getAgentTool,
  escapeShellDoubleQuotes,
  generateFeatureManifest,
  generateLocalAgentPlan,
  coordinateFromForgeRepository,
  getEvidenceChecklist,
  evaluateGatewayLandingStatus
} from '../src/lib/slopshopDomain';

describe('SLOPSHOP Local-First Domain & Agent Workflow Engine', () => {
  describe('Repository Coordinates & Metadata', () => {
    it('should expose canonical repository coordinates for flagship apps', () => {
      expect(Object.keys(REPO_COORDINATES)).toContain('dronehunter');
      expect(Object.keys(FEATURE_MOD_PRESETS)).toContain('dronehunter');
      expect(Object.keys(AGENT_TOOLS)).toContain('agy');

      const coords = getAppCoordinates();
      expect(coords.length).toBeGreaterThanOrEqual(2);

      const drone = getAppCoordinate('dronehunter');
      expect(drone.appId).toBe('dronehunter');
      expect(drone.name).toBe('DroneHunter 95');
      expect(drone.slug).toBe('nate/dronehunter');
      expect(drone.repoUrl).toBe('');
      expect(drone.sshRemote).toBe('');
      expect(drone.defaultPort).toBe(3004);
      expect(drone.sqliteDatabase).toBeUndefined();
      expect(drone.techStack).toContain('Local Storage');

      const mailer = getAppCoordinate('certified-mailer');
      expect(mailer.appId).toBe('certified-mailer');
      expect(mailer.slug).toBe('nate/certified-mailer');
    });

    it('should handle custom repository coordinates cleanly', () => {
      const custom = getAppCoordinate('my-custom-tool');
      expect(custom.appId).toBe('my-custom-tool');
      expect(custom.slug).toBe('custom/my-custom-tool');
      expect(custom.repoUrl).toBe('');
      expect(custom.defaultPort).toBe(3010);
    });

    it('should derive live clone coordinates from verified GITSMITH transport', () => {
      const coordinate = coordinateFromForgeRepository({
        id: 'repo_1', appId: 'my-tool', slug: 'my-tool', ownerUsername: 'nate', status: 'active'
      }, { protocol: 'ssh', configured: true, active: true, host: 'forge.example.test', port: 10609 });
      expect(coordinate.slug).toBe('nate/my-tool');
      expect(coordinate.repoUrl).toBe('ssh://git@forge.example.test:10609/nate/my-tool.git');
      expect(coordinate.sshRemote).toBe(coordinate.repoUrl);
    });

    it('should fail closed without an active GITSMITH transport', () => {
      expect(() => coordinateFromForgeRepository({
        id: 'repo_1', slug: 'my-tool', ownerUsername: 'nate', status: 'active'
      }, { protocol: 'ssh', configured: true, active: false, host: 'forge.example.test', port: 10609 })).toThrow('active GITSMITH');
    });

    it('should preserve backward-compatible WORKTREE_CONFIGS', () => {
      expect(WORKTREE_CONFIGS.dronehunter.defaultPort).toBe(3004);
      expect(WORKTREE_CONFIGS['certified-mailer'].defaultPort).toBe(3005);
    });
  });

  describe('Feature Mod Presets', () => {
    it('uses a neutral repository-inspection preset for unknown applications', () => {
      const preset = getFeaturePresets('my-tool')[0];
      expect(preset.id).toBe('custom-feature');
      expect(preset.targetFiles).toEqual([]);
      expect(preset.prompt).toContain('Inspect this repository first');
      expect(preset.prompt).not.toContain('Drone');
    });
    it('should provide rich presets with prompts, target files, and verification criteria for each app', () => {
      const dronePresets = getFeaturePresets('dronehunter');
      expect(dronePresets.length).toBeGreaterThanOrEqual(3);
      const radar = dronePresets.find(p => p.id === 'dh-radar');
      expect(radar).toBeDefined();
      expect(radar?.prompt).toContain('AN/MPQ-64 Sentinel');
      expect(radar?.targetFiles.length).toBeGreaterThan(0);
      expect(radar?.migrationSql).toBeUndefined();
      expect(radar?.verificationCriteria.length).toBeGreaterThan(0);
      expect(radar?.blueprintDiffPreview).toContain('diff --git');

      const mailerPresets = getFeaturePresets('certified-mailer');
      expect(mailerPresets.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Agent Tools Configuration', () => {
    it('should configure supported agents: AGY, Claude Code, SLOP CLI, Aider, and Cursor', () => {
      const tools = getAgentTools();
      expect(tools.map(t => t.id)).toEqual(['agy', 'claude', 'slop', 'aider', 'cursor']);

      const agy = getAgentTool('agy');
      expect(agy.name).toContain('Antigravity');
      expect(agy.cliBinary).toBe('agy');

      const claude = getAgentTool('claude');
      expect(claude.name).toBe('Claude Code');
      expect(claude.cliBinary).toBe('claude');

      const slop = getAgentTool('slop');
      expect(slop.name).toBe('SLOP CLI');
      expect(slop.cliBinary).toBe('slop');
    });
  });

  describe('Shell Escaping and Security Helpers', () => {
    it('should safely escape shell special characters for double-quoted arguments', () => {
      const raw = 'Fix "bug" in $HOME with `echo hack` and \\ backslash';
      const escaped = escapeShellDoubleQuotes(raw);
      expect(escaped).toBe('Fix \\"bug\\" in \\$HOME with \\`echo hack\\` and \\\\ backslash');
    });
  });

  describe('Feature Manifest Generation (slop-feature.json)', () => {
    it('should generate concrete feature manifest matching schema contract', () => {
      const coord = getAppCoordinate('dronehunter');
      const feature = getFeaturePresets('dronehunter')[0];
      const manifest = generateFeatureManifest({
        coordinate: coord,
        feature,
        agent: 'agy',
        makerHandle: '@josh'
      });

      expect(manifest.$schema).toBe('https://nates-software.com/schemas/slop-feature-manifest-v1.json');
      expect(manifest.version).toBe('1.0.0');
      expect(manifest.targetRepository.appId).toBe('dronehunter');
      expect(manifest.targetRepository.slug).toBe('nate/dronehunter');
      expect(manifest.feature.id).toBe(feature.id);
      expect(manifest.feature.prompt).toBe(feature.prompt);
      expect(manifest.feature.targetFiles).toEqual(feature.targetFiles);
      expect(manifest.feature.migrationSql).toBe(feature.migrationSql);
      expect(manifest.localAgent.tool).toBe('agy');
      expect(manifest.localAgent.command).toContain('agy "');
      expect(manifest.lineageContract.makerHandle).toBe('@josh');
      expect(manifest.lineageContract.status).toBe('proposal_only');
      expect(manifest.lineageContract.activation).toBe('verified commerce sale after publication');
      expect(manifest.lineageContract.royaltySplit.maker).toBe('rest');
      expect(manifest.lineageContract.royaltySplit.ancestor).toBe('frozen royalty rate');
      expect(manifest.evidenceRequirements.typecheckRequired).toBe(true);
      expect(manifest.evidenceRequirements.testsRequired).toBe(true);
      expect(manifest.evidenceRequirements.sha256DigestRequired).toBe(true);
    });

    it('should support custom prompts in manifest generation', () => {
      const coord = getAppCoordinate('certified-mailer');
      const feature = getFeaturePresets('certified-mailer')[0];
      const customPrompt = 'Custom localized demand letter for Washington State';
      const manifest = generateFeatureManifest({
        coordinate: coord,
        feature,
        agent: 'claude',
        customPrompt
      });

      expect(manifest.feature.prompt).toBe(customPrompt);
      expect(manifest.localAgent.command).toContain(customPrompt);
    });
  });

  describe('Local Agent Plan & Command Generation', () => {
    it('should hand the same feature ref to SLOP in the manifest and local plan', () => {
      const coord = getAppCoordinate('dronehunter');
      const feature = getFeaturePresets('dronehunter')[0];
      const manifest = generateFeatureManifest({ coordinate: coord, feature, agent: 'slop' });
      const plan = generateLocalAgentPlan({ coordinate: coord, feature, agent: 'slop' });

      expect(manifest.localAgent.command).toBe('slop mod refs/features/dh-radar/v1.0.0');
      expect(plan.steps[1].command).toContain(manifest.localAgent.command);
      expect(plan.singleLineCommand).toBe('slop fork "nate/dronehunter"');
      expect(plan.singleLineCommand).not.toContain('slop dyno');
    });

    it('should install before offering to start AGY', () => {
      const coord = getAppCoordinate('dronehunter');
      const feature = getFeaturePresets('dronehunter')[0];
      const plan = generateLocalAgentPlan({
        coordinate: coord,
        feature,
        agent: 'agy'
      });

      expect(plan.singleLineCommand).toBe('slop fork "nate/dronehunter"');
      expect(plan.singleLineCommand).not.toContain('agy');
      expect(plan.worktreeDir).toBe('<worktree-path-printed-by-slop>');
      expect(plan.steps[1].command).toContain('git switch -c feature/dh-radar');
      expect(plan.steps[1].command).toContain('agy "');
      expect(plan.steps.length).toBe(4);
      expect(plan.manifestJson).toContain('"appId": "dronehunter"');
    });

    it('should generate concrete local workflow steps with descriptions and required evidence', () => {
      const coord = getAppCoordinate('certified-mailer');
      const feature = getFeaturePresets('certified-mailer')[0];
      const plan = generateLocalAgentPlan({
        coordinate: coord,
        feature,
        agent: 'claude'
      });

      expect(plan.steps[0].title).toContain('Install into a Verified Local Worktree');
      expect(plan.steps[0].command).toBe('slop fork "nate/certified-mailer"');
      expect(plan.steps[0].requiredEvidence).toBeDefined();

      expect(plan.steps[1].title).toContain('Claude');
      expect(plan.steps[1].command).toContain('claude "');

      expect(plan.steps[2].title).toContain('Execute Local Test Suite');
      expect(plan.steps[2].command).toContain('npm test');

      expect(plan.steps[3].title).toContain('Inspect Diff & Prepare CAS Feature Ref');
      expect(plan.steps[3].command).toContain('git diff');
    });
  });

  describe('Evidence Checklist & Contracts', () => {
    it('should generate 5-point evidence verification checklist', () => {
      const feature = getFeaturePresets('dronehunter')[0];
      const checklist = getEvidenceChecklist(feature);
      expect(checklist.length).toBe(5);
      expect(checklist[0].id).toBe('typecheck');
      expect(checklist[1].id).toBe('tests');
      expect(checklist[2].id).toBe('migrations');
      expect(checklist[3].id).toBe('diff');
      expect(checklist[4].id).toBe('evidence-digest');
      expect(checklist[4].evidenceProduced).toContain('sha256');
    });
  });

  describe('Truthful Gateway & CAS Landing State Evaluation', () => {
    it('should truthfully indicate in-browser landing is offline and requires local execution', () => {
      const coord = getAppCoordinate('dronehunter');
      const feature = getFeaturePresets('dronehunter')[0];
      const status = evaluateGatewayLandingStatus({ coordinate: coord, feature });

      expect(status.canLandDirectlyFromBrowser).toBe(false);
      expect(status.status).toBe('browser_sandbox_offline');
      expect(status.reason).toContain('Browser Sandbox Mode');
      expect(status.reason).toContain('cannot invoke local host shells');
      expect(status.requiredArtifacts.length).toBeGreaterThan(0);
      expect(status.landingContract.casValidationRequired).toBe(true);
      expect(status.landingContract.targetBranch).toBe('refs/heads/main');
    });
  });
});
