// Production Domain Logic for SLOPSHOP AI Agent Worktree & Prompt Forge

export interface AgentPromptPreset {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly description: string;
  readonly prompt: string;
}

export interface AppWorktreeConfig {
  readonly appId: string;
  readonly repoUrl: string;
  readonly defaultPort: number;
  readonly suggestedPrompts: readonly AgentPromptPreset[];
}

export const WORKTREE_CONFIGS: Record<string, AppWorktreeConfig> = {
  dronehunter: {
    appId: 'dronehunter',
    repoUrl: 'https://github.com/natemcguire/dronehunter.git',
    defaultPort: 3004,
    suggestedPrompts: [
      {
        id: 'dh-weapons',
        name: 'Dual-Wield Laser Shotgun',
        category: 'Game Weapons',
        description: 'Add rapid-fire dual laser shotguns with Web Audio reload synthesis.',
        prompt: 'Add dual-wield laser shotguns and a new boss wave telemetry table in SQLite.'
      },
      {
        id: 'dh-leaderboard',
        name: 'Persistent High Scores (WAL)',
        category: 'Backend Telemetry',
        description: 'Add persistent player high scores and accuracy metrics in /data/dronehunter.sqlite.',
        prompt: 'Implement top 10 player high scores with accuracy percentages in local SQLite WAL mode.'
      }
    ]
  },
  'certified-mailer': {
    appId: 'certified-mailer',
    repoUrl: 'https://github.com/natemcguire/certified-mailer.git',
    defaultPort: 3005,
    suggestedPrompts: [
      {
        id: 'cm-templates',
        name: 'Statutory Tenant Demand Letters',
        category: 'Legal Notice Engine',
        description: 'Add California and Texas security deposit return demand templates.',
        prompt: 'Add California Tenant Security Deposit statutory demand templates and CSV batch export.'
      }
    ]
  },
  picfitai: {
    appId: 'picfitai',
    repoUrl: 'https://github.com/natemcguire/picfitai.git',
    defaultPort: 3006,
    suggestedPrompts: [
      {
        id: 'pf-wardrobe',
        name: 'Streetwear Wardrobe Rack',
        category: 'AI Try-On',
        description: 'Add custom streetwear wardrobe racks and high-resolution lookbook PDF exports.',
        prompt: 'Add custom streetwear wardrobe racks and high-resolution lookbook PDF exports.'
      }
    ]
  }
};
