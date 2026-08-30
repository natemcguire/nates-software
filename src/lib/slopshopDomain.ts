// Production Domain Logic for SLOPSHOP AI Agent Worktree & Prompt Forge
// Local-First Agentic Architecture & Truthful Feature Manifest Engine

export interface RepoCoordinate {
  readonly appId: string;
  readonly name: string;
  readonly author: string;
  readonly slug: string;
  readonly repoUrl: string;
  readonly sshRemote: string;
  readonly defaultPort: number;
  readonly sqliteDatabase?: string;
  readonly localPathHint: string;
  readonly techStack: readonly string[];
  readonly tagline: string;
  readonly version: string;
  readonly price: string;
  readonly icon: string;
}

export interface ForgeRepositoryProjection {
  readonly id: string;
  readonly appId?: string | null;
  readonly slug: string;
  readonly ownerUsername?: string | null;
  readonly status: string;
}

export interface ForgeSshTransport {
  readonly protocol: 'ssh';
  readonly configured: boolean;
  readonly active: boolean;
  readonly host: string;
  readonly port: number;
}

export interface FeaturePreset {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly description: string;
  readonly prompt: string;
  readonly targetFiles: readonly string[];
  readonly migrationSql?: string;
  readonly verificationCriteria: readonly string[];
  readonly blueprintDiffPreview: string;
}

export type AgentToolId = 'agy' | 'claude' | 'slop' | 'aider' | 'cursor';

export interface AgentToolMeta {
  readonly id: AgentToolId;
  readonly name: string;
  readonly shortName: string;
  readonly badge: string;
  readonly icon: string;
  readonly description: string;
  readonly cliBinary: string;
  readonly recommendedModel: string;
  readonly installInstruction: string;
}

export interface LocalWorkflowStep {
  readonly stepNumber: number;
  readonly title: string;
  readonly command: string;
  readonly description: string;
  readonly requiredEvidence?: string;
}

export interface SlopFeatureManifest {
  readonly $schema: string;
  readonly version: string;
  readonly targetRepository: {
    readonly appId: string;
    readonly slug: string;
    readonly repoUrl: string;
    readonly defaultPort: number;
    readonly sqliteDatabase?: string;
  };
  readonly feature: {
    readonly id: string;
    readonly name: string;
    readonly category: string;
    readonly prompt: string;
    readonly targetFiles: readonly string[];
    readonly migrationSql?: string;
    readonly verificationCriteria: readonly string[];
  };
  readonly localAgent: {
    readonly tool: AgentToolId;
    readonly command: string;
    readonly recommendedModel: string;
  };
  readonly lineageContract: {
    readonly status: 'proposal_only';
    readonly activation: 'verified commerce sale after publication';
    readonly makerHandle: string;
    readonly royaltySplit: {
      readonly maker: string;
      readonly ancestor: string;
      readonly protocolPool: string;
    };
  };
  readonly evidenceRequirements: {
    readonly typecheckRequired: boolean;
    readonly testsRequired: boolean;
    readonly migrationValidationRequired: boolean;
    readonly sha256DigestRequired: boolean;
  };
  readonly generatedAt: string;
}

export interface GeneratedAgentPlan {
  readonly agent: AgentToolMeta;
  readonly coordinate: RepoCoordinate;
  readonly feature: FeaturePreset;
  readonly singleLineCommand: string;
  readonly steps: readonly LocalWorkflowStep[];
  readonly worktreeDir: string;
  readonly branchName: string;
  readonly featureManifest: SlopFeatureManifest;
  readonly manifestJson: string;
}

export interface GatewayLandingPrerequisites {
  readonly canLandDirectlyFromBrowser: false;
  readonly reason: string;
  readonly status: 'browser_sandbox_offline' | 'awaiting_local_execution';
  readonly requiredArtifacts: readonly string[];
  readonly landingContract: {
    readonly targetBranch: string;
    readonly casValidationRequired: boolean;
    readonly evidenceDigestHeader: string;
  };
}

// ---------------------------------------------------------------------------
// Canonical Repository Coordinates
// ---------------------------------------------------------------------------

export const REPO_COORDINATES: Record<string, RepoCoordinate> = {
  dronehunter: {
    appId: 'dronehunter',
    name: 'DroneHunter 95',
    author: 'nate',
    slug: 'nate/dronehunter',
    repoUrl: '',
    sshRemote: '',
    defaultPort: 3004,
    localPathHint: '~/Projects/dronehunter',
    techStack: ['TypeScript', 'Vite', 'HTML5 Canvas', 'Web Audio API', 'Local Storage'],
    tagline: 'Retro Duck Hunt Arcade Shooter with Local High Scores & Audio Synthesis.',
    version: 'v1.0.0',
    price: '$15.00',
    icon: '🎯'
  },
  'certified-mailer': {
    appId: 'certified-mailer',
    name: 'Certified Mailer',
    author: 'nate',
    slug: 'nate/certified-mailer',
    repoUrl: '',
    sshRemote: '',
    defaultPort: 3005,
    sqliteDatabase: 'Browser localStorage (unencrypted)',
    localPathHint: '~/Projects/certified-mailer',
    techStack: ['TypeScript', 'React', 'Browser Print', 'Local Evidence Journal', 'Tailwind CSS'],
    tagline: 'Local letter preparation and user-recorded mailing evidence journal.',
    version: 'v1.1.0',
    price: '$25.00',
    icon: '📫'
  },
  picfitai: {
    appId: 'picfitai',
    name: 'PicFit',
    author: 'nate',
    slug: 'nate/picfitai',
    repoUrl: '',
    sshRemote: '',
    defaultPort: 3006,
    sqliteDatabase: '',
    localPathHint: '~/Projects/picfitai',
    techStack: ['TypeScript', 'Canvas API', 'Blob API', 'React 19'],
    tagline: 'Private in-browser crop, resize, compression, and image export studio.',
    version: 'v2.0.0',
    price: '$20.00',
    icon: '✨'
  }
};

// ---------------------------------------------------------------------------
// Canonical Feature Mod Presets
// ---------------------------------------------------------------------------

export const FEATURE_MOD_PRESETS: Record<string, FeaturePreset[]> = {
  dronehunter: [
    {
      id: 'dh-radar',
      name: '🎯 AN/MPQ-64 Sentinel Radar Sweep HUD',
      category: 'Combat & Graphics',
      description: 'Add a 360-degree rotating phosphor radar sweep in the corner with tactical target intercepts.',
      prompt: 'Implement an AN/MPQ-64 Sentinel 360-degree rotating phosphor radar sweep HUD in the top-right corner of the canvas. Detect incoming drone vectors and render blinking target blips with azimuth and range telemetry.',
      targetFiles: ['src/hud/SentinelRadar.ts', 'src/game/GameEngine.ts', 'src/types/radar.ts'],
      verificationCriteria: [
        'Canvas radar overlay renders at 60 FPS without DOM frame drops',
        'Radar target state remains ephemeral unless the fork explicitly selects persistence',
        'TypeScript build (tsc -b) passes with 0 errors'
      ],
      blueprintDiffPreview: `diff --git a/src/hud/SentinelRadar.ts b/src/hud/SentinelRadar.ts
new file mode 100644
--- /dev/null
+++ b/src/hud/SentinelRadar.ts
@@ -0,0 +1,28 @@
+export interface RadarBlip {
+  readonly id: string;
+  readonly azimuth: number;
+  readonly elevation: number;
+  readonly rangeMeters: number;
+}
+
+export class SentinelRadarHUD {
+  private sweepAngle = 0;
+  constructor(private readonly ctx: CanvasRenderingContext2D) {}
+
+  public updateAndDraw(dt: number, blips: readonly RadarBlip[]): void {
+    this.sweepAngle = (this.sweepAngle + dt * 1.8) % (2 * Math.PI);
+    this.renderPhosphorGrid();
+    this.renderBlips(blips);
+  }
+}`
    },
    {
      id: 'dh-multiplayer',
      name: '🏆 Local Multi-Player High Scores',
      category: 'Game Feature',
      description: 'Add device-local high scores with player initials, accuracy, and streak multipliers.',
      prompt: 'Weld a device-local high score board into the game. Add player name input on game over, persist the top 10 scores in browser storage, and provide an explicit reset control.',
      targetFiles: ['src/components/ScoreModal.tsx', 'src/lib/localLeaderboard.ts'],
      verificationCriteria: [
        'Leaderboard remains on the player device and survives a browser restart',
        'Accuracy percentage is bounded between 0.0 and 100.0',
        'Reset control clears only Drone Hunter leaderboard data'
      ],
      blueprintDiffPreview: `diff --git a/src/db/leaderboard.ts b/src/db/leaderboard.ts
new file mode 100644
--- /dev/null
+++ b/src/db/leaderboard.ts
@@ -0,0 +1,22 @@
+export interface LeaderboardEntry {
+  readonly id: string;
+  readonly initials: string;
+  readonly score: number;
+  readonly accuracy: number;
+}
+
+export async function recordHighScore(db: any, entry: LeaderboardEntry): Promise<void> {
+  await db.exec(
+    'INSERT INTO player_leaderboard (id, initials, score, accuracy) VALUES (?, ?, ?, ?)',
+    [entry.id, entry.initials, entry.score, entry.accuracy]
+  );
+}`
    },
    {
      id: 'dh-dog',
      name: '🐶 Retro Duck Hunt Dog & Web Audio Synthesizer',
      category: 'Sound FX & Sprites',
      description: 'Add retro pixel art dog animations on misses, celebration jumps on round clear, and synthesized 8-bit audio.',
      prompt: 'Inject retro 8-bit Duck Hunt laughing dog animations when missing shots, and triumphant celebration animations with synthesized 8-bit shotgun blast and reload audio using the native Web Audio API.',
      targetFiles: ['src/audio/SynthSoundEngine.ts', 'src/sprites/RetroDog.ts'],
      verificationCriteria: [
        'AudioContext synthesized sound triggers cleanly without user-gesture autoplay blocking errors',
        'Sprite animations match 8-bit palette constraints',
        'Clean unit tests for sound synthesizer frequency envelope'
      ],
      blueprintDiffPreview: `diff --git a/src/audio/SynthSoundEngine.ts b/src/audio/SynthSoundEngine.ts
new file mode 100644
--- /dev/null
+++ b/src/audio/SynthSoundEngine.ts
@@ -0,0 +1,24 @@
+export class RetroSynthAudio {
+  private audioCtx: AudioContext | null = null;
+
+  public playShotgunBlast(): void {
+    if (!this.audioCtx) this.audioCtx = new AudioContext();
+    const osc = this.audioCtx.createOscillator();
+    const gain = this.audioCtx.createGain();
+    osc.type = 'sawtooth';
+    osc.frequency.setValueAtTime(140, this.audioCtx.currentTime);
+    osc.frequency.exponentialRampToValueAtTime(30, this.audioCtx.currentTime + 0.15);
+    gain.gain.setValueAtTime(0.8, this.audioCtx.currentTime);
+    gain.gain.linearRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.2);
+    osc.connect(gain).connect(this.audioCtx.destination);
+    osc.start();
+    osc.stop(this.audioCtx.currentTime + 0.2);
+  }
+}`
    }
  ],
  'certified-mailer': [
    {
      id: 'cm-pdf',
      name: '📄 300 DPI High-Res PDF Flattener & Rasterizer',
      category: 'Document Engine',
      description: 'Rasterize and flatten DOCX/PDF dispute letters into 300 DPI pixel-perfect pages to prevent postal distortions.',
      prompt: 'Add a PyMuPDF / Canvas 300 DPI pixel flattening pipeline to rasterize generated DOCX and PDF dispute letters before dispatching to postal print queues.',
      targetFiles: ['src/pdf/PdfFlattener.ts', 'src/services/PrintQueue.ts'],
      migrationSql: 'CREATE TABLE IF NOT EXISTS rendered_pages (id TEXT PRIMARY KEY, letter_id TEXT NOT NULL, page_number INTEGER NOT NULL, dpi INTEGER DEFAULT 300, raster_hash TEXT NOT NULL);',
      verificationCriteria: [
        'Rendered PDF outputs exact 300 DPI bitmap bounding boxes',
        'Flattening strips script tags and active PDF form annotations',
        'sqlite schema rendered_pages stores unique SHA-256 raster hash'
      ],
      blueprintDiffPreview: `diff --git a/src/pdf/PdfFlattener.ts b/src/pdf/PdfFlattener.ts
new file mode 100644
--- /dev/null
+++ b/src/pdf/PdfFlattener.ts
@@ -0,0 +1,20 @@
+export interface FlattenedPageResult {
+  readonly pageNumber: number;
+  readonly dpi: number;
+  readonly rasterHash: string;
+  readonly buffer: ArrayBuffer;
+}
+
+export async function flattenDocumentPages(pdfBuffer: ArrayBuffer, dpi = 300): Promise<FlattenedPageResult[]> {
+  // High-fidelity rasterization logic
+  return [];
+}`
    },
    {
      id: 'cm-evidence-attachments',
      name: '📎 Local Evidence Attachments',
      category: 'Evidence Journal',
      description: 'Attach user-supplied receipt images to local observations without claiming postal verification.',
      prompt: 'Add local receipt-image attachments with bounded file validation, accessible previews, and explicit user-entered/unverified labels.',
      targetFiles: ['src/evidence/AttachmentStore.ts', 'src/components/EvidenceAttachment.tsx'],
      verificationCriteria: [
        'Only JPEG, PNG, and WebP attachments within the configured byte limit are accepted',
        'Object URLs are revoked on replacement and unmount',
        'Every attachment is labeled user-entered and unverified'
      ],
      blueprintDiffPreview: `diff --git a/src/evidence/AttachmentStore.ts b/src/evidence/AttachmentStore.ts
new file mode 100644
--- /dev/null
+++ b/src/evidence/AttachmentStore.ts
@@ -0,0 +1,16 @@
+export function validateEvidenceAttachment(file: File): void {
+  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
+    throw new Error('Evidence attachments must be JPEG, PNG, or WebP.');
+  }
+  if (file.size > 10 * 1024 * 1024) throw new Error('Attachment exceeds 10 MiB.');
+}`
    },
    {
      id: 'cm-templates',
      name: '⚖️ Statutory Tenant Dispute Demand Templates',
      category: 'Legal Engine',
      description: 'Add California Civil Code § 1950.5 and Texas Property Code § 92.109 security deposit return demand templates.',
      prompt: 'Add California and Texas security deposit return demand templates with statutory penalty calculations, dispute itemization tables, and CSV batch export.',
      targetFiles: ['src/templates/StatutoryDemand.ts', 'src/export/CsvExporter.ts'],
      verificationCriteria: [
        'California § 1950.5 formula correctly applies 2x statutory bad-faith penalty',
        'Texas § 92.109 formula correctly computes $100 + 3x withheld amount',
        'CSV batch export sanitizes formulas against injection vulnerabilities'
      ],
      blueprintDiffPreview: `diff --git a/src/templates/StatutoryDemand.ts b/src/templates/StatutoryDemand.ts
new file mode 100644
--- /dev/null
+++ b/src/templates/StatutoryDemand.ts
@@ -0,0 +1,16 @@
+export interface SecurityDepositDemandOptions {
+  readonly state: 'CA' | 'TX';
+  readonly depositAmount: number;
+  readonly withheldAmount: number;
+  readonly landlordName: string;
+}`
    }
  ],
  picfitai: [
    {
      id: 'pf-batch-export',
      name: '🗂️ Batch Image Export',
      category: 'Image Workflow',
      description: 'Apply one verified crop, resize, and format recipe to a local selection of images.',
      prompt: 'Add a local-only batch queue that applies a chosen PicFit export recipe, reports each actual encoded size, and downloads results without uploading source images.',
      targetFiles: ['src/components/BatchExportQueue.tsx', 'src/lib/batchExport.ts'],
      verificationCriteria: [
        'Every item is decoded and dimension-validated before canvas allocation',
        'Failed items can be retried without restarting successful items',
        'Object URLs and decoded image resources are released after export'
      ],
      blueprintDiffPreview: `diff --git a/src/lib/batchExport.ts b/src/lib/batchExport.ts
new file mode 100644
--- /dev/null
+++ b/src/lib/batchExport.ts
@@ -0,0 +1,5 @@
+export interface BatchExportItem {
+  readonly file: File;
+  readonly state: 'queued' | 'encoding' | 'ready' | 'error';
+}`
    },
    {
      id: 'pf-metadata-control',
      name: '🛡️ Metadata Control',
      category: 'Privacy',
      description: 'Inspect which metadata will be removed by the browser canvas export path.',
      prompt: 'Add an honest metadata inspector that distinguishes detectable source metadata from unknown metadata, without claiming guaranteed forensic erasure.',
      targetFiles: ['src/components/MetadataInspector.tsx', 'src/lib/imageMetadata.ts'],
      verificationCriteria: [
        'Unsupported metadata is reported as unknown rather than absent',
        'No source image or metadata is transmitted over the network',
        'Tests cover malformed and truncated metadata blocks'
      ],
      blueprintDiffPreview: `diff --git a/src/lib/imageMetadata.ts b/src/lib/imageMetadata.ts
new file mode 100644
--- /dev/null
+++ b/src/lib/imageMetadata.ts
@@ -0,0 +1,2 @@
+export type MetadataFinding = 'present' | 'not-detected' | 'unknown';`
    },
    {
      id: 'pf-custom-presets',
      name: '📏 Reusable Export Presets',
      category: 'Image Workflow',
      description: 'Save named dimension, format, and quality recipes in browser-local storage or portable files.',
      prompt: 'Add importable and exportable PicFit preset files plus optional browser-local storage, with no account or cloud-sync claim.',
      targetFiles: ['src/components/ExportPresetManager.tsx', 'src/lib/exportPresets.ts'],
      verificationCriteria: [
        'Preset schema rejects invalid dimensions, formats, and quality values',
        'Users can export and import portable preset JSON',
        'Clearing local presets does not affect source images or downloads'
      ],
      blueprintDiffPreview: `diff --git a/src/lib/exportPresets.ts b/src/lib/exportPresets.ts
new file mode 100644
--- /dev/null
+++ b/src/lib/exportPresets.ts
@@ -0,0 +1,6 @@
+export interface ExportPreset {
+  readonly name: string;
+  readonly width: number;
+  readonly height: number;
+  readonly format: 'image/jpeg' | 'image/png' | 'image/webp';
+}`
    }
  ]
};

export const CUSTOM_FEATURE_PRESET: FeaturePreset = {
  id: 'custom-feature',
  name: '🧩 Custom Repository Feature',
  category: 'Repository-defined',
  description: 'Describe a feature after inspecting this repository’s actual structure and conventions.',
  prompt: 'Inspect this repository first. Then implement the requested feature using its existing architecture, tests, runtime, and storage choices. Do not assume filenames, frameworks, or persistence technology that are not present.',
  targetFiles: [],
  verificationCriteria: [
    'Repository-native tests pass',
    'Repository-native build or validation command passes',
    'The final diff contains only changes required by the requested feature'
  ],
  blueprintDiffPreview: 'No speculative diff is generated before the repository is inspected.'
};

// ---------------------------------------------------------------------------
// Agent Tools Configuration
// ---------------------------------------------------------------------------

export const AGENT_TOOLS: Record<AgentToolId, AgentToolMeta> = {
  agy: {
    id: 'agy',
    name: 'Antigravity CLI (AGY)',
    shortName: 'AGY',
    badge: 'DeepMind Agent',
    icon: '⚡',
    description: 'Autonomous multi-agent CLI by Google DeepMind with architectural planning, subagents, and test verification.',
    cliBinary: 'agy',
    recommendedModel: 'gemini-2.0-flash-thinking',
    installInstruction: 'Built into Antigravity CLI environment'
  },
  claude: {
    id: 'claude',
    name: 'Claude Code',
    shortName: 'Claude',
    badge: 'Terminal Agent',
    icon: '🟣',
    description: 'Agentic terminal coding assistant from Anthropic with tool use, codebase search, and file edits.',
    cliBinary: 'claude',
    recommendedModel: 'claude-3-7-sonnet',
    installInstruction: 'npm i -g @anthropic-ai/claude-code'
  },
  slop: {
    id: 'slop',
    name: 'SLOP CLI',
    shortName: 'SLOP',
    badge: 'Native Shareware Tool',
    icon: '💻',
    description: "Nate's Software native developer CLI for isolated worktree forks, micro-dyno benchmarks, and 12:01 AM daily drops.",
    cliBinary: 'slop',
    recommendedModel: 'local-native',
    installInstruction: 'npm link ./bin/slop'
  },
  aider: {
    id: 'aider',
    name: 'Aider',
    shortName: 'Aider',
    badge: 'Pair Programmer',
    icon: '🤖',
    description: 'Terminal-based AI pair programming tool with automatic git commit history and repository-wide tree-sitter map.',
    cliBinary: 'aider',
    recommendedModel: 'claude-3-7-sonnet',
    installInstruction: 'pip install aider-chat'
  },
  cursor: {
    id: 'cursor',
    name: 'Cursor / VS Code',
    shortName: 'Cursor',
    badge: 'IDE Workspace',
    icon: '🧠',
    description: 'AI-first code editor with inline codebase context and multi-file composer diff review.',
    cliBinary: 'cursor',
    recommendedModel: 'composer-claude-3.7',
    installInstruction: 'Install Cursor IDE from cursor.com'
  }
};

// ---------------------------------------------------------------------------
// Backward Compatibility Exports
// ---------------------------------------------------------------------------

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
    repoUrl: '',
    defaultPort: 3004,
    suggestedPrompts: FEATURE_MOD_PRESETS.dronehunter.map(p => ({
      id: p.id,
      name: p.name,
      category: p.category,
      description: p.description,
      prompt: p.prompt
    }))
  },
  'certified-mailer': {
    appId: 'certified-mailer',
    repoUrl: '',
    defaultPort: 3005,
    suggestedPrompts: FEATURE_MOD_PRESETS['certified-mailer'].map(p => ({
      id: p.id,
      name: p.name,
      category: p.category,
      description: p.description,
      prompt: p.prompt
    }))
  },
  picfitai: {
    appId: 'picfitai',
    repoUrl: '',
    defaultPort: 3006,
    suggestedPrompts: FEATURE_MOD_PRESETS.picfitai.map(p => ({
      id: p.id,
      name: p.name,
      category: p.category,
      description: p.description,
      prompt: p.prompt
    }))
  }
};

// ---------------------------------------------------------------------------
// Domain Helper Functions
// ---------------------------------------------------------------------------

export function getAppCoordinates(): RepoCoordinate[] {
  return Object.values(REPO_COORDINATES);
}

export function getAppCoordinate(appId: string): RepoCoordinate {
  if (REPO_COORDINATES[appId]) {
    return REPO_COORDINATES[appId];
  }
  // Safe dynamic fallback for custom coordinates
  const cleanId = appId.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
  return {
    appId: cleanId,
    name: cleanId.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    author: 'custom',
    slug: `custom/${cleanId}`,
    repoUrl: '',
    sshRemote: '',
    defaultPort: 3010,
    localPathHint: `~/Projects/${cleanId}`,
    techStack: ['Repository-defined runtime', 'Repository-defined persistence'],
    tagline: `Custom software application repository (${cleanId}).`,
    version: 'v1.0.0',
    price: 'Not listed',
    icon: '📦'
  };
}

export function getFeaturePresets(appId: string): FeaturePreset[] {
  return FEATURE_MOD_PRESETS[appId] || [CUSTOM_FEATURE_PRESET];
}

export function coordinateFromForgeRepository(
  repository: ForgeRepositoryProjection,
  transport: ForgeSshTransport
): RepoCoordinate {
  if (!transport.configured || !transport.active || !/^[a-zA-Z0-9.-]+$/.test(transport.host) ||
      !Number.isInteger(transport.port) || transport.port < 1 || transport.port > 65535) {
    throw new Error('An active GITSMITH SSH transport is required.');
  }
  const owner = repository.ownerUsername?.trim() || 'unknown-owner';
  const rawSlug = repository.slug.trim().replace(/^\/+|\/+$/g, '');
  if (!/^[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)?$/.test(rawSlug) ||
      !/^[a-zA-Z0-9._-]+$/.test(owner)) {
    throw new Error('Forge repository owner or slug is invalid.');
  }
  const canonicalSlug = rawSlug.includes('/') ? rawSlug : `${owner}/${rawSlug}`;
  const appId = repository.appId?.trim() || rawSlug.split('/').at(-1) || repository.id;
  const known = REPO_COORDINATES[appId];
  const remote = `ssh://git@${transport.host}:${transport.port}/${canonicalSlug}.git`;
  return {
    ...(known || getAppCoordinate(appId)),
    appId,
    name: known?.name || appId.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    author: owner,
    slug: canonicalSlug,
    repoUrl: remote,
    sshRemote: remote,
    tagline: known?.tagline || `Active GITSMITH repository ${canonicalSlug}.`,
    version: known?.version || 'Forge repository',
    price: known?.price || 'Not listed'
  };
}

export function getAgentTools(): AgentToolMeta[] {
  return Object.values(AGENT_TOOLS);
}

export function getAgentTool(toolId: AgentToolId): AgentToolMeta {
  return AGENT_TOOLS[toolId] || AGENT_TOOLS.agy;
}

/**
 * Escapes strings safely for POSIX shell double quotes
 */
export function escapeShellDoubleQuotes(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');
}

/**
 * Generates structured feature manifest document (slop-feature.json)
 */
export function generateFeatureManifest(params: {
  coordinate: RepoCoordinate;
  feature: FeaturePreset;
  agent: AgentToolId;
  makerHandle?: string;
  customPrompt?: string;
}): SlopFeatureManifest {
  const prompt = params.customPrompt || params.feature.prompt;
  const toolMeta = getAgentTool(params.agent);
  const handle = params.makerHandle || '@nate';

  let agentCmd = '';
  const escaped = escapeShellDoubleQuotes(prompt);
  switch (params.agent) {
    case 'agy':
      agentCmd = `agy "${escaped}"`;
      break;
    case 'claude':
      agentCmd = `claude "${escaped}"`;
      break;
    case 'slop':
      agentCmd = `slop mod refs/features/${params.feature.id.toLowerCase().replace(/[^a-z0-9-_]/g, '-')}/v1.0.0`;
      break;
    case 'aider':
      agentCmd = `aider --message "${escaped}"`;
      break;
    case 'cursor':
      agentCmd = `cursor .`;
      break;
  }

  return {
    $schema: 'https://nates-software.com/schemas/slop-feature-manifest-v1.json',
    version: '1.0.0',
    targetRepository: {
      appId: params.coordinate.appId,
      slug: params.coordinate.slug,
      repoUrl: params.coordinate.repoUrl,
      defaultPort: params.coordinate.defaultPort,
      sqliteDatabase: params.coordinate.sqliteDatabase
    },
    feature: {
      id: params.feature.id,
      name: params.feature.name,
      category: params.feature.category,
      prompt,
      targetFiles: params.feature.targetFiles,
      migrationSql: params.feature.migrationSql,
      verificationCriteria: params.feature.verificationCriteria
    },
    localAgent: {
      tool: params.agent,
      command: agentCmd,
      recommendedModel: toolMeta.recommendedModel
    },
    lineageContract: {
      status: 'proposal_only',
      activation: 'verified commerce sale after publication',
      makerHandle: handle,
      royaltySplit: {
        maker: '70%',
        ancestor: '20%',
        protocolPool: '10%'
      }
    },
    evidenceRequirements: {
      typecheckRequired: true,
      testsRequired: true,
      migrationValidationRequired: Boolean(params.feature.migrationSql),
      sha256DigestRequired: true
    },
    generatedAt: new Date().toISOString()
  };
}

/**
 * Generates the complete, concrete local agent plan with executable shell commands,
 * step-by-step instructions, and manifest JSON.
 */
export function generateLocalAgentPlan(params: {
  coordinate: RepoCoordinate;
  feature: FeaturePreset;
  agent: AgentToolId;
  makerHandle?: string;
  customPrompt?: string;
  customWorktreeDir?: string;
}): GeneratedAgentPlan {
  const prompt = params.customPrompt || params.feature.prompt;
  const toolMeta = getAgentTool(params.agent);
  const sanitizedFeatureId = params.feature.id.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
  const worktreeDir = params.customWorktreeDir || '<worktree-path-printed-by-slop>';
  const branchName = `feature/${sanitizedFeatureId}`;
  const escapedPrompt = escapeShellDoubleQuotes(prompt);

  let agentInvokeCmd = '';
  switch (params.agent) {
    case 'agy':
      agentInvokeCmd = `agy "${escapedPrompt}"`;
      break;
    case 'claude':
      agentInvokeCmd = `claude "${escapedPrompt}"`;
      break;
    case 'slop':
      agentInvokeCmd = `slop mod refs/features/${sanitizedFeatureId}/v1.0.0`;
      break;
    case 'aider':
      agentInvokeCmd = `aider --message "${escapedPrompt}"`;
      break;
    case 'cursor':
      agentInvokeCmd = `cursor .`;
      break;
  }

  // Installation is authoritative and completes before SLOP offers to launch an
  // engine. Never chain an agent process behind an unverified clone/install.
  const cloneTarget = params.coordinate.repoUrl || params.coordinate.slug;
  const singleLineCommand = `slop fork "${escapeShellDoubleQuotes(cloneTarget)}"`;

  // 4 Concrete Local Workflow Steps
  const steps: LocalWorkflowStep[] = [
    {
      stepNumber: 1,
      title: 'Install into a Verified Local Worktree',
      command: singleLineCommand,
      description: `SLOP installs ${params.coordinate.name}, verifies the worktree, then asks which engine to start. Choose 0 if you want to save the manifest before launching an agent.`,
      requiredEvidence: 'SLOP prints the created worktree path and successful install/test evidence'
    },
    {
      stepNumber: 2,
      title: `Create Feature Branch & Start ${toolMeta.shortName}`,
      command: `cd "${worktreeDir}" && git switch -c ${branchName} && ${agentInvokeCmd}`,
      description: `After installation succeeds, create the feature branch and launch ${toolMeta.name} inside that verified worktree to modify ${params.feature.targetFiles.join(', ')}.`,
      requiredEvidence: 'Synthesized file changes matching specification prompt'
    },
    {
      stepNumber: 3,
      title: 'Execute Local Test Suite & Build Verification',
      command: params.feature.migrationSql && params.coordinate.sqliteDatabase
        ? `npm test && npm run build && sqlite3 ${params.coordinate.sqliteDatabase.replace('/data/', './data/')} "${escapeShellDoubleQuotes(params.feature.migrationSql)}"`
        : `npm test && npm run build`,
      description: 'Executes the local test suite and TypeScript compiler to produce verified cryptographic evidence.',
      requiredEvidence: params.feature.migrationSql
        ? 'Passing tests, clean build, and repository-specific persistence migration evidence'
        : 'Passing tests and clean build'
    },
    {
      stepNumber: 4,
      title: 'Inspect Diff & Prepare CAS Feature Ref',
      command: `git diff HEAD && git add -A && git commit -m "feat(${sanitizedFeatureId}): ${escapeShellDoubleQuotes(params.feature.name)}"`,
      description: 'Generates an atomic Git commit with unified diff ready for CAS landing or push to remote repository.',
      requiredEvidence: 'Valid git commit SHA with parent reference intact'
    }
  ];

  const manifest = generateFeatureManifest({
    coordinate: params.coordinate,
    feature: params.feature,
    agent: params.agent,
    makerHandle: params.makerHandle,
    customPrompt: prompt
  });

  return {
    agent: toolMeta,
    coordinate: params.coordinate,
    feature: params.feature,
    singleLineCommand,
    steps,
    worktreeDir,
    branchName,
    featureManifest: manifest,
    manifestJson: JSON.stringify(manifest, null, 2)
  };
}

/**
 * Returns the 5-point evidence verification checklist explaining local proof requirements.
 */
export function getEvidenceChecklist(feature: FeaturePreset): {
  id: string;
  title: string;
  command: string;
  description: string;
  evidenceProduced: string;
}[] {
  return [
    {
      id: 'typecheck',
      title: '1. TypeScript AST & Typecheck Validation',
      command: 'npm run build (tsc -b)',
      description: 'Verifies zero syntax errors, valid imports, and strict TypeScript compliance.',
      evidenceProduced: 'Clean build exit code 0 with 0 compilation diagnostics'
    },
    {
      id: 'tests',
      title: '2. Sandboxed Unit & Integration Tests',
      command: 'npm test (vitest run)',
      description: 'Runs project test suites to verify feature behaviors without regressions.',
      evidenceProduced: 'Vitest assertion results log and pass count'
    },
    {
      id: 'migrations',
      title: '3. Persistence Migration Proof',
      command: feature.migrationSql ? 'Run the repository-defined migration and integrity commands' : 'No persistence migration needed',
      description: 'Validates persistence changes using the target repository’s own runtime and storage contract.',
      evidenceProduced: feature.migrationSql ? 'Migration log and repository-defined integrity evidence' : 'Zero persistence delta verified'
    },
    {
      id: 'diff',
      title: '4. Git Unified Diff Verification',
      command: 'git diff HEAD',
      description: 'Generates clean, reviewable unified diff isolating additions and removals.',
      evidenceProduced: 'Unified diff patch with filenames and line offsets'
    },
    {
      id: 'evidence-digest',
      title: '5. Cryptographic Evidence Digest (SHA-256)',
      command: 'shasum -a 256 test-output.log git-diff.patch',
      description: 'Combines test logs and git diff into an immutable SHA-256 evidence digest.',
      evidenceProduced: 'sha256:8f4a21... tamper-proof signature'
    }
  ];
}

/**
 * Evaluates the truthful gateway status and explains why in-browser execution / landing
 * is offline without a host agent daemon.
 */
export function evaluateGatewayLandingStatus(_params?: {
  coordinate?: RepoCoordinate;
  feature?: FeaturePreset;
}): GatewayLandingPrerequisites {
  return {
    canLandDirectlyFromBrowser: false,
    reason: 'Browser Sandbox Mode: In-browser Web OS cannot invoke local host shells, compile native binaries, or manipulate local git working trees without a running local daemon or manual terminal execution.',
    status: 'browser_sandbox_offline',
    requiredArtifacts: [
      'Local Git worktree with clean working tree',
      'Passing test suite logs from local npm test run',
      'Verified local commit SHA (with known parent commit OID)',
      'SHA-256 cryptographic evidence digest'
    ],
    landingContract: {
      targetBranch: 'refs/heads/main',
      casValidationRequired: true,
      evidenceDigestHeader: 'X-Slop-Evidence-Digest'
    }
  };
}
