import React, { useState, useEffect, useRef } from 'react';
import {
  GitBranch,
  GitFork,
  Star,
  Search,
  ExternalLink,
  Code,
  FileCode,
  ShieldCheck,
  Copy,
  Check,
  Sparkles,
  Play,
  Clock,
  CircleDot,
  Folder,
  FileText,
  GripVertical,
  Globe,
  Plus,
  X
} from 'lucide-react';
import { playClickSound, playSuccessChime } from '../lib/soundEngine';
import { useAuth } from '../context/AuthContext';
import { useAlert } from '../context/AlertContext';

import { ForkWithAiModal } from '../components/ForkWithAiModal';
import { Bot } from 'lucide-react';

export interface GitsmithRepo {
  id: string;
  name: string;
  owner: string;
  avatar: string;
  description: string;
  stars: number | null;
  forks: number | null;
  language: string;
  license: string;
  sqlitePath: string;
  branch: string;
  lastCommit: {
    sha: string;
    message: string;
    author: string;
    time: string;
    verified: boolean;
  };
  tags: string[];
  liveUrl?: string;
  liveAppUrl?: string;
  files: { name: string; type: 'file' | 'dir'; size?: string; content?: string }[];
  source: 'canonical' | 'showcase';
  visibility: 'public' | 'unlisted' | 'private';
  status: string;
}

export interface CanonicalRepositoryProjection {
  id: string;
  slug: string;
  ownerUserId: string;
  ownerUsername?: string | null;
  visibility: 'public' | 'unlisted' | 'private';
  status: string;
  defaultRef: string;
  defaultCommitOid?: string | null;
  forkCount?: number | string | null;
  objectFormat?: string;
  updatedAt?: string;
}

export function mapCanonicalRepository(repo: CanonicalRepositoryProjection): GitsmithRepo {
  const owner = repo.ownerUsername || repo.ownerUserId;
  const commitOid = repo.defaultCommitOid || '';
  const isPushed = Boolean(commitOid && commitOid !== 'No projected ref' && !commitOid.startsWith('-'));
  const status = repo.status === 'provisioning'
    ? 'provisioning'
    : (!isPushed ? 'source not pushed' : repo.status);

  return {
    id: repo.id,
    name: repo.slug,
    owner,
    avatar: '🔩',
    description: `Canonical ${repo.visibility} repository. Gateway state: ${status}.`,
    stars: null,
    forks: Number(repo.forkCount || 0),
    language: 'Not reported',
    license: 'Not reported',
    sqlitePath: 'Application-defined',
    branch: repo.defaultRef.replace(/^refs\/heads\//, ''),
    lastCommit: {
      sha: isPushed ? commitOid.slice(0, 12) : 'No projected ref',
      message: isPushed ? 'Authoritative default-ref projection' : (repo.status === 'provisioning' ? 'Repository provisioning' : 'Source not pushed yet'),
      author: owner,
      time: repo.updatedAt || 'Not reported',
      verified: false
    },
    tags: ['Canonical', repo.visibility, status, repo.objectFormat || 'git'],
    files: [],
    source: 'canonical',
    visibility: repo.visibility,
    status
  };
}

export const GITSMITH_REPOS: GitsmithRepo[] = [
  {
    id: 'dronehunter',
    name: 'dronehunter',
    owner: 'nate',
    avatar: '🎯',
    description: 'Fast-paced retro browser shooter inspired by Duck Hunt. Double-barrel shotgun, laughing dog animations, drone explosions, and local high score tracking.',
    stars: null,
    forks: null,
    language: 'TypeScript / Canvas Game',
    license: 'MIT Open Source Shareware',
    sqlitePath: 'Local Storage (Storage Freedom)',
    branch: 'main',
    lastCommit: {
      sha: '5cdee6f',
      message: 'feat(arcade): Duck Hunt style shotgun shooter with local high scores',
      author: 'nate',
      time: '12 mins ago',
      verified: false
    },
    tags: ['Arcade', 'Retro', 'Duck Hunt', 'Canvas', 'Web Audio'],
    source: 'showcase',
    visibility: 'public',
    status: 'bundled',
    files: [
      { name: 'assets', type: 'dir' },
      { name: 'src', type: 'dir' },
      { name: 'src/game.js', type: 'file', size: '18.4 KB', content: `// DroneHunter 95 - Authentic Duck Hunt Arcade Mechanics\nclass DroneHunterGame {\n  constructor() {\n    this.canvas = document.getElementById('gameCanvas');\n    this.ctx = this.canvas.getContext('2d');\n    this.score = 0;\n    this.shotsLeft = 3;\n    this.drones = [];\n    this.dog = { state: 'hunting', x: 100, y: 400 };\n    this.initAudio();\n    this.bindEvents();\n    this.loop();\n  }\n\n  shoot(e) {\n    if (this.shotsLeft <= 0) return;\n    this.shotsLeft--;\n    this.playShotgun();\n    this.checkCollisions(e.clientX, e.clientY);\n  }\n}` },
      { name: 'src/game.ts', type: 'file', size: '14.8 KB', content: `// DroneHunter 95 - Duck Hunt Style Canvas Arcade\nexport class DroneHunterGame {\n  private canvas: HTMLCanvasElement;\n  private ctx: CanvasRenderingContext2D;\n  private score: number = 0;\n  private shells: number = 2;\n\n  constructor(canvasId: string) {\n    this.canvas = document.getElementById(canvasId) as HTMLCanvasElement;\n    this.ctx = this.canvas.getContext('2d')!;\n    this.initAudioAndSprites();\n  }\n\n  public shoot(x: number, y: number): boolean {\n    if (this.shells <= 0) return false;\n    this.shells--;\n    this.playShotgunSound();\n    return this.checkHit(x, y);\n  }\n}` },
      { name: 'style.css', type: 'file', size: '2.1 KB', content: `body { background: #000; margin: 0; display: flex; justify-content: center; align-items: center; height: 100vh; font-family: monospace; }\n#gameCanvas { border: 4px solid #fff; cursor: crosshair; background: #63b5f6; }` },
      { name: 'index.html', type: 'file', size: '4.2 KB', content: `<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <title>DroneHunter 95</title>\n  <link rel="stylesheet" href="/style.css">\n</head>\n<body>\n  <canvas id="gameCanvas" width="800" height="600"></canvas>\n  <script src="/src/game.js"></script>\n</body>\n</html>` },
      { name: 'package.json', type: 'file', size: '740 B', content: `{\n  "name": "dronehunter",\n  "version": "1.0.0",\n  "type": "module",\n  "scripts": {\n    "dev": "vite",\n    "build": "tsc && vite build",\n    "test": "vitest run"\n  }\n}` },
      { name: 'slop.config.json', type: 'file', size: '320 B', content: `{\n  "appId": "dronehunter",\n  "memoryCapMb": 256\n}` },
      { name: 'README.md', type: 'file', size: '2.8 KB', content: `# 🎯 DroneHunter 95\n\nRetro Duck Hunt arcade shooter with local high score tracking.` }
    ]
  },
  {
    id: 'certified-mailer',
    name: 'certified-mailer',
    owner: 'nate',
    avatar: '📫',
    description: 'Browser-local correspondence preparation and unverified mailing-evidence journal. It does not submit mail or verify postal tracking.',
    stars: null,
    forks: null,
    language: 'TypeScript / React',
    license: 'MIT Local-First Utility',
    sqlitePath: 'Browser localStorage (unencrypted)',
    branch: 'main',
    lastCommit: {
      sha: '9f0412b',
      message: 'feat(mail): local preparation and evidence journal',
      author: 'nate',
      time: '35 mins ago',
      verified: false
    },
    tags: ['Correspondence', 'Postal', 'Evidence Journal', 'Local-First'],
    source: 'showcase',
    visibility: 'public',
    status: 'bundled',
    liveUrl: '',
    liveAppUrl: '',
    files: [
      { name: 'src', type: 'dir' },
      { name: 'src/certifiedMailerDomain.ts', type: 'file', size: '18.4 KB', content: `export type MailStatus = 'draft' | 'ready' | 'mailed' | 'delivered' | 'returned' | 'closed';\n\n// Postal observations are user-entered evidence, never provider verification.\nexport interface EvidenceObservation {\n  observedAt: string;\n  trackingNumber?: string;\n  note: string;\n  verified: false;\n}` },
      { name: 'package.json', type: 'file', size: '620 B', content: `{\n  "name": "certified-mailer",\n  "version": "1.0.0",\n  "private": true,\n  "scripts": { "test": "vitest run", "build": "tsc -b && vite build" }\n}` },
      { name: 'README.md', type: 'file', size: '3.1 KB', content: `# 📫 Certified Mailer\n\nPrepare and print correspondence, then record user-supplied mailing evidence locally. No postal provider is connected.` }
    ]
  },
  {
    id: 'wallart', name: 'wallart', owner: 'nate', avatar: '🖼️',
    description: 'Private multi-tenant photo-to-art studio with durable generation queues, tenant isolation, and print variants.',
    stars: null, forks: null, language: 'TypeScript / Cloudflare Workers', license: 'Private Shareware',
    sqlitePath: 'Application-owned D1 and private R2', branch: 'main',
    lastCommit: { sha: 'current', message: 'feat(studio): durable tenant-isolated photo-to-art workflow', author: 'nate', time: 'local project', verified: false },
    tags: ['Wall Art', 'Cloudflare', 'D1', 'R2', 'Queues', 'Tenant Isolation'], source: 'showcase', visibility: 'private', status: 'gitsmith',
    files: [
      { name: 'worker', type: 'dir' },
      { name: 'worker/index.ts', type: 'file', size: '24 KB', content: `// Tenant-scoped routes, queues, cron recovery, and private object access.` },
      { name: 'db/schema.ts', type: 'file', size: '18 KB', content: `// Tenants, assets, jobs, credentials, and audit events.` },
      { name: 'README.md', type: 'file', size: '9 KB', content: `# WallArt Studio\n\nPrivate photo-to-art workspace using D1, R2, Queues, Durable Objects, Images, and user-owned model credentials.` }
    ]
  },
  {
    id: 'american-gardener', name: 'american-gardener', owner: 'nate', avatar: '🌱',
    description: 'Private local garden operations dashboard for crop timing, GDD targets, DLI observations, inventory, and Home Assistant snapshots.',
    stars: null, forks: null, language: 'JavaScript / SQLite', license: 'Private Local-First Shareware',
    sqlitePath: 'Application-owned local SQLite (private and ignored)', branch: 'main',
    lastCommit: { sha: 'local', message: 'feat(garden): unify garden operations and observation dashboard', author: 'nate', time: 'local project', verified: false },
    tags: ['Gardening', 'SQLite', 'Home Assistant', 'GDD', 'DLI', 'Local-First'], source: 'showcase', visibility: 'private', status: 'local-source',
    files: [
      { name: 'dashboard', type: 'dir' },
      { name: 'scripts/dashboard-server.js', type: 'file', size: '8 KB', content: `// Loopback-only dashboard server backed by application-owned SQLite.` },
      { name: 'scripts/home-assistant-sync.js', type: 'file', size: '12 KB', content: `// Read-only Home Assistant garden observation snapshot adapter.` },
      { name: 'README.md', type: 'file', size: '5 KB', content: `# American Gardener\n\nPrivate garden inventory, crop, light, and weather operations software. Household data is never bundled.` }
    ]
  }
];

// Slug -> embedded showcase files. The four seeded showcase apps (dronehunter,
// certified-mailer, wallart, american-gardener) also exist as canonical D1 repos,
// but their committed blobs are NOT browsable through the object gateway
// (/api/repo-file 404s for every path, including real files like README.md).
// Rather than show a scary "File Read Unavailable / HTTP 404" for these known apps,
// we serve their already-embedded showcase file content directly (no fetch).
export const SHOWCASE_FILES_BY_SLUG: Record<string, GitsmithRepo['files']> =
  GITSMITH_REPOS.reduce((acc, repo) => {
    acc[repo.name] = repo.files;
    return acc;
  }, {} as Record<string, GitsmithRepo['files']>);

export const GitsmithView: React.FC = () => {
  const { user, openAuthModal } = useAuth();
  const { showAlert } = useAlert();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRepo, setSelectedRepo] = useState<GitsmithRepo | null>(null);
  const [activeFile, setActiveFile] = useState<{ name: string; type: 'file' | 'dir'; size?: string; content?: string } | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [copiedClone, setCopiedClone] = useState(false);
  const [showForkModal, setShowForkModal] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [activeTab, setActiveTab] = useState<'code' | 'commits' | 'lineage'>('code');
  const [canonicalRepoCount, setCanonicalRepoCount] = useState<number | null>(null);
  const [canonicalRepositories, setCanonicalRepositories] = useState<GitsmithRepo[]>([]);
  const [canonicalLoadState, setCanonicalLoadState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [showBundledExamples, setShowBundledExamples] = useState(false);
  const [gatewayReady, setGatewayReady] = useState(false);
  const [gatewayCheckState, setGatewayCheckState] = useState<'checking' | 'ready' | 'unavailable'>('checking');
  const [transportReady, setTransportReady] = useState(false);
  const [transportEndpoint, setTransportEndpoint] = useState<{ host: string; port: number } | null>(null);
  const [filterMine, setFilterMine] = useState(false);
  const [showCreateRepo, setShowCreateRepo] = useState(false);
  const [newRepoSlug, setNewRepoSlug] = useState('');
  const [newRepoVisibility, setNewRepoVisibility] = useState<'public' | 'unlisted' | 'private'>('public');
  const [isCreatingRepo, setIsCreatingRepo] = useState(false);

  const refreshCanonicalRepositories = async () => {
    try {
      const response = await fetch('/api/git?list=1', { credentials: 'same-origin' });
      const payload = await response.json();
      if (response.ok && payload.success && Array.isArray(payload.repositories)) {
        const mapped: GitsmithRepo[] = payload.repositories.map((repo: CanonicalRepositoryProjection) => mapCanonicalRepository(repo));
        setCanonicalRepositories(mapped);
        setCanonicalRepoCount(mapped.length);
        setCanonicalLoadState('loaded');
        if (mapped.length > 0) {
          setSelectedRepo(current => {
            if (current?.source === 'canonical') {
              const existing = mapped.find(repo => repo.id === current.id);
              if (existing) return existing;
            }
            return mapped[0];
          });
          setActiveFile(null);
        } else {
          setSelectedRepo(current => (showBundledExamples && current?.source === 'showcase' ? current : null));
          if (!showBundledExamples) {
            setActiveFile(null);
          }
        }
        return;
      }
      setCanonicalLoadState('error');
      setSelectedRepo(current => (showBundledExamples && current?.source === 'showcase' ? current : null));
    } catch {
      setCanonicalRepoCount(null);
      setCanonicalLoadState('error');
      setSelectedRepo(current => (showBundledExamples && current?.source === 'showcase' ? current : null));
    }
  };

  const refreshGatewayReadiness = async () => {
    setGatewayCheckState('checking');
    try {
      const response = await fetch('/api/git?action=gateway-readiness', { credentials: 'same-origin', cache: 'no-store' });
      const payload = await response.json();
      const ready = response.ok && payload?.success === true && payload?.ready === true;
      setGatewayReady(ready);
      setTransportReady(payload?.transport?.active === true);
      setTransportEndpoint(payload?.transport?.active === true && payload?.transport?.host
        ? { host: payload.transport.host, port: Number(payload.transport.port || 22) }
        : null);
      setGatewayCheckState(ready ? 'ready' : 'unavailable');
    } catch {
      setGatewayReady(false);
      setTransportReady(false);
      setTransportEndpoint(null);
      setGatewayCheckState('unavailable');
    }
  };

  useEffect(() => {
    void refreshCanonicalRepositories();
    void refreshGatewayReadiness();
  }, [user?.id]);

  const showingShowcases = canonicalRepositories.length === 0 && showBundledExamples;
  const repositoryCatalog = canonicalRepositories.length > 0
    ? canonicalRepositories
    : showingShowcases ? GITSMITH_REPOS : [];
  const filteredRepos = repositoryCatalog.filter(repo => {
    if (filterMine && user?.username && repo.owner !== user.username) {
      return false;
    }
    const q = searchQuery.toLowerCase();
    const matchName = repo.name.toLowerCase().includes(q) || repo.owner.toLowerCase().includes(q);
    const matchDesc = repo.description.toLowerCase().includes(q);
    const matchTag = repo.tags.some(t => t.toLowerCase().includes(q));
    const matchLang = repo.language.toLowerCase().includes(q);
    return matchName || matchDesc || matchTag || matchLang;
  });

  const candidateFiles: { name: string; type: 'file' | 'dir'; size?: string; content?: string }[] = [
    { name: 'README.md', type: 'file' },
    { name: 'spec.md', type: 'file' },
    { name: 'slop.config.json', type: 'file' },
    { name: 'package.json', type: 'file' }
  ];
  // For canonical repos that mirror a seeded showcase app, surface the real embedded
  // file list (with names + content) instead of the phantom candidateFiles guess.
  const showcaseFilesForSelected = selectedRepo && selectedRepo.source !== 'showcase'
    ? SHOWCASE_FILES_BY_SLUG[selectedRepo.name]
    : undefined;
  const displayedFiles = selectedRepo
    ? (selectedRepo.source === 'showcase'
        ? selectedRepo.files
        : (selectedRepo.files.length > 0
            ? selectedRepo.files
            : (showcaseFilesForSelected && showcaseFilesForSelected.length > 0
                ? showcaseFilesForSelected
                : candidateFiles)))
    : [];

  useEffect(() => {
    let isCancelled = false;

    if (!selectedRepo) {
      setFileContent(null);
      setFileError(null);
      setFileLoading(false);
      return;
    }

    if (selectedRepo.source === 'showcase') {
      const showcaseFile = activeFile || selectedRepo.files.find(f => f.type === 'file') || selectedRepo.files[0];
      setFileContent(showcaseFile?.content || null);
      setFileError(null);
      setFileLoading(false);
      return;
    }

    // Canonical repo that mirrors a seeded showcase app: serve the embedded content
    // directly. The object gateway has no browsable blobs for these, so a fetch would
    // 404 on every file. If the clicked file has embedded content, use it; if it's a
    // directory or a phantom, fall through to the "select a file" empty state.
    const showcaseFiles = SHOWCASE_FILES_BY_SLUG[selectedRepo.name];
    if (showcaseFiles && showcaseFiles.length > 0) {
      const target = activeFile
        ? showcaseFiles.find(f => f.name === activeFile.name)
        : (showcaseFiles.find(f => f.type === 'file') || showcaseFiles[0]);
      setFileContent(target?.content ?? null);
      setFileError(null);
      setFileLoading(false);
      return;
    }

    // Canonical repository
    if (selectedRepo.status === 'provisioning' || !selectedRepo.lastCommit.sha || selectedRepo.lastCommit.sha === 'No projected ref') {
      setFileContent(null);
      setFileError('Repository has no commits yet. Push the first commit to main to browse files.');
      setFileLoading(false);
      return;
    }

    if (selectedRepo.visibility === 'private' || selectedRepo.visibility === 'unlisted') {
      setFileContent(null);
      setFileError('HTTP file browsing proxy is restricted to public repositories. Use SSH clone to inspect private repository files.');
      setFileLoading(false);
      return;
    }

    const fileName = activeFile?.name || 'README.md';
    setFileLoading(true);
    setFileError(null);
    setFileContent(null);

    const query = selectedRepo.id
      ? `repoId=${encodeURIComponent(selectedRepo.id)}`
      : `owner=${encodeURIComponent(selectedRepo.owner)}&slug=${encodeURIComponent(selectedRepo.name)}`;
    const url = `/api/repo-file?${query}&path=${encodeURIComponent(fileName)}`;

    fetch(url, { credentials: 'same-origin' })
      .then(async res => {
        if (isCancelled) return;
        if (res.ok) {
          const text = await res.text();
          setFileContent(text);
          setFileError(null);
        } else if (res.status === 404) {
          setFileContent(null);
          setFileError(`File "${fileName}" not found in repository (HTTP 404).`);
        } else if (res.status === 502) {
          setFileContent(null);
          setFileError('Repository gateway unreachable (HTTP 502). File browsing requires an active GITSMITH object gateway.');
        } else if (res.status === 413) {
          setFileContent(null);
          setFileError(`File "${fileName}" exceeds maximum allowed file size (HTTP 413).`);
        } else {
          setFileContent(null);
          setFileError(`Failed to retrieve "${fileName}" from repository (HTTP ${res.status}).`);
        }
      })
      .catch(err => {
        if (isCancelled) return;
        setFileContent(null);
        setFileError(`Transport error: ${err?.message || 'Network request failed'}`);
      })
      .finally(() => {
        if (!isCancelled) {
          setFileLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [
    selectedRepo?.id,
    selectedRepo?.owner,
    selectedRepo?.name,
    selectedRepo?.source,
    selectedRepo?.status,
    selectedRepo?.visibility,
    selectedRepo?.lastCommit?.sha,
    activeFile?.name
  ]);

  const handleCreateRepository = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user) {
      openAuthModal('login');
      return;
    }
    if (!gatewayReady) {
      showAlert('The GITSMITH gateway is not ready, so no provisioning request was created. Try again after gateway readiness returns.', 'GITSMITH Gateway Unavailable', 'error');
      return;
    }
    setIsCreatingRepo(true);
    try {
      const response = await fetch('/api/git', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create-repository',
          slug: newRepoSlug.trim(),
          visibility: newRepoVisibility
        })
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || payload.errors?.join(' ') || 'Repository creation failed.');
      }
      setNewRepoSlug('');
      setShowCreateRepo(false);
      await refreshCanonicalRepositories();
      showAlert(
        `${payload.repository.slug} is queued for Git gateway provisioning. It becomes active only after the gateway confirms its first authoritative ref.`,
        'Repository Provisioning Started',
        'success'
      );
    } catch (error: any) {
      showAlert(error?.message || 'Repository creation failed.', 'GITSMITH', 'error');
    } finally {
      setIsCreatingRepo(false);
    }
  };

  // Interactive Resizable Split Panes
  const [sidebarWidth, setSidebarWidth] = useState<number>(320);
  const [fileTreeWidth, setFileTreeWidth] = useState<number>(240);
  const isDraggingSidebar = useRef(false);
  const isDraggingFileTree = useRef(false);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingSidebar.current) {
        setSidebarWidth(Math.max(220, Math.min(520, e.clientX)));
      }
      if (isDraggingFileTree.current) {
        setFileTreeWidth(Math.max(160, Math.min(460, e.clientX - sidebarWidth)));
      }
    };

    const handleMouseUp = () => {
      isDraggingSidebar.current = false;
      isDraggingFileTree.current = false;
      document.body.style.cursor = 'default';
      document.body.style.userSelect = 'auto';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [sidebarWidth]);

  const startResizeSidebar = (e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingSidebar.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const startResizeFileTree = (e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingFileTree.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const handleCopyClone = (repo: GitsmithRepo) => {
    playClickSound();
    if (repo.source === 'showcase') {
      showAlert('Bundled showcase examples cannot be installed or cloned. They are static local snapshots for demonstration only.', 'Showcase Demo Only', 'info');
      return;
    }
    if (!transportReady || !transportEndpoint) {
      showAlert('GITSMITH SSH transport is pending. Clone endpoint is not active yet.', 'SSH Transport Pending', 'error');
      return;
    }
    const source = `ssh://git@${transportEndpoint.host}:${transportEndpoint.port}/${repo.owner}/${repo.name}.git`;
    navigator.clipboard.writeText(`slop fork ${source}`);
    setCopiedClone(true);
    setTimeout(() => setCopiedClone(false), 2000);
  };

  const handleCopyCode = () => {
    if (!fileContent) return;
    playClickSound();
    navigator.clipboard.writeText(fileContent);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const codeLines = fileContent !== null ? fileContent.split('\n') : [];

  return (
    <div className="flex flex-col h-full bg-[#0f172a] text-slate-200 font-sans text-xs overflow-hidden select-none">
      {/* Top Forge Navigation Bar */}
      <div className="bg-[#1e293b] border-b border-slate-700 px-4 py-2.5 flex items-center justify-between flex-wrap gap-2 shadow-md">
        <div className="flex items-center gap-3">
          <div 
            onClick={() => { playClickSound(); setSearchQuery(''); }}
            className="flex items-center gap-2 bg-slate-900 px-3 py-1.5 rounded-md border border-slate-700 shadow-inner cursor-pointer hover:border-sky-400 transition-colors"
          >
            <Code size={16} className="text-sky-400" />
            <span className="font-bold text-white text-sm tracking-wide font-mono">GITSMITH</span>
            <span className="bg-sky-600 text-white text-[10px] font-mono px-1.5 py-0.5 rounded font-bold">FORGE</span>
          </div>
          <span className="text-slate-400 font-mono text-xs hidden sm:inline flex items-center gap-1.5">
            <Globe size={13} className="text-sky-400" />
            <span>Repository control plane · Git transport requires the GITSMITH gateway</span>
          </span>
        </div>

        {/* Global Stats Badges */}
        <div className="flex items-center gap-2.5 text-xs font-mono">
          <div className="flex items-center gap-1.5 bg-slate-900 px-2.5 py-1 rounded border border-slate-700 text-emerald-400">
            <ShieldCheck size={14} />
            <span>{canonicalRepoCount === null ? 'Control plane' : `${canonicalRepoCount} canonical repos`}</span>
          </div>
          <div className={`flex items-center gap-1.5 bg-slate-900 px-2.5 py-1 rounded border border-slate-700 ${gatewayCheckState === 'ready' ? 'text-emerald-400' : gatewayCheckState === 'checking' ? 'text-amber-400' : 'text-red-400'}`}>
            <CircleDot size={14} />
            <span>{gatewayCheckState === 'ready' ? 'Storage gateway ready' : gatewayCheckState === 'checking' ? 'Checking gateway' : 'Gateway unavailable'}</span>
          </div>
          <div className={`flex items-center gap-1.5 bg-slate-900 px-2.5 py-1 rounded border border-slate-700 ${transportReady ? 'text-emerald-400' : 'text-amber-400'}`}>
            <GitBranch size={14} />
            <span>{transportReady ? 'SSH transport ready' : 'SSH transport pending'}</span>
          </div>
          <div className="flex items-center gap-1.5 bg-slate-900 px-2.5 py-1 rounded border border-slate-700 text-amber-400">
            <Sparkles size={14} />
            <span>70/20/10 Lineage Pool</span>
          </div>
          <button
            onClick={() => {
              if (!user) return openAuthModal('login');
              if (!gatewayReady) return showAlert('Repository creation is disabled until the GITSMITH gateway is ready.', 'GITSMITH Gateway Unavailable', 'error');
              setShowCreateRepo(true);
            }}
            disabled={Boolean(user) && !gatewayReady}
            className="flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 disabled:text-slate-400 disabled:border-slate-600 px-2.5 py-1 rounded border border-sky-400 text-white font-bold"
          >
            <Plus size={14} /> New Repository
          </button>
        </div>
      </div>

      {showCreateRepo && (
        <form onSubmit={handleCreateRepository} className="bg-slate-900 border-b border-sky-700 px-4 py-3 flex items-end gap-3 flex-wrap">
          <div className="flex-1 min-w-[220px]">
            <label htmlFor="gitsmith-repo-slug" className="block text-[11px] text-sky-300 font-bold mb-1">Repository slug</label>
            <input
              id="gitsmith-repo-slug"
              value={newRepoSlug}
              onChange={event => setNewRepoSlug(event.target.value.toLowerCase())}
              placeholder="my-shareware-app"
              pattern="[a-z0-9][a-z0-9._-]*"
              maxLength={100}
              required
              className="w-full bg-slate-950 border border-slate-600 rounded px-3 py-1.5 text-white font-mono focus:outline-none focus:border-sky-400"
            />
          </div>
          <div>
            <label htmlFor="gitsmith-repo-visibility" className="block text-[11px] text-sky-300 font-bold mb-1">Visibility</label>
            <select
              id="gitsmith-repo-visibility"
              value={newRepoVisibility}
              onChange={event => setNewRepoVisibility(event.target.value as typeof newRepoVisibility)}
              className="bg-slate-950 border border-slate-600 rounded px-3 py-1.5 text-white"
            >
              <option value="public">Public</option>
              <option value="unlisted">Unlisted</option>
              <option value="private">Private</option>
            </select>
          </div>
          <button disabled={isCreatingRepo} className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-3 py-1.5 rounded font-bold">
            {isCreatingRepo ? 'Queuing…' : 'Create & Provision'}
          </button>
          <button type="button" onClick={() => setShowCreateRepo(false)} className="p-1.5 text-slate-400 hover:text-white" aria-label="Close repository form">
            <X size={16} />
          </button>
          <p className="basis-full text-[11px] text-slate-400">The control plane creates a provisioning record first. Git objects and refs become active only after confirmation from the authoritative gateway.</p>
        </form>
      )}

      {/* Main Forge Body Grid with Resizable Split Panes */}
      {showingShowcases ? (
        <div className="bg-amber-950/80 border-b border-amber-700 px-4 py-2 text-[11px] text-amber-200 font-mono flex items-center justify-between">
          <span>DEMO GALLERY — Bundled showcase snapshots for UI preview only. Not canonical repositories, gateway objects, or live forge state.</span>
          <button
            onClick={() => {
              setShowBundledExamples(false);
              setSelectedRepo(canonicalRepositories.length > 0 ? canonicalRepositories[0] : null);
            }}
            className="text-amber-300 hover:text-white underline text-[11px] ml-3 shrink-0"
          >
            Close Demo Gallery
          </button>
        </div>
      ) : canonicalRepositories.length > 0 ? (
        <div className="bg-emerald-950/80 border-b border-emerald-700 px-4 py-2 text-[11px] text-emerald-200 font-mono">
          CANONICAL CONTROL-PLANE RECORDS — Repository status, default refs, and fork totals are loaded from D1. Git objects remain authoritative at the gateway.
        </div>
      ) : (
        <div className={`${canonicalLoadState === 'error' ? 'bg-red-950/80 border-red-700 text-red-200' : 'bg-slate-900 border-slate-700 text-slate-300'} border-b px-4 py-2 text-[11px] font-mono`}>
          {canonicalLoadState === 'loading'
            ? 'LOADING CANONICAL FORGE…'
            : canonicalLoadState === 'error'
              ? 'CANONICAL FORGE UNAVAILABLE — No cached or example repository has been substituted.'
              : 'NO VISIBLE CANONICAL REPOSITORIES — Create your first repository or explicitly open the bundled examples.'}
        </div>
      )}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Column: Repository Sidebar (Drag-Resizable Width) */}
        <div 
          style={{ width: `${sidebarWidth}px`, minWidth: '220px', maxWidth: '520px' }}
          className="border-r border-slate-700 bg-[#0f172a] flex flex-col overflow-hidden shrink-0"
        >
          {/* Search Header */}
          <div className="p-3 border-b border-slate-700 bg-[#1e293b]">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="Find a repository or maker..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#0f172a] border border-slate-600 rounded-md px-3 py-1.5 pl-8 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-sky-400 shadow-inner"
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-400 mt-2 px-1 font-mono">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => { playClickSound(); setFilterMine(false); }}
                  className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${
                    !filterMine
                      ? 'bg-sky-600 text-white shadow-sm'
                      : 'bg-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  All ({repositoryCatalog.length})
                </button>
                {user?.username && (
                  <button
                    type="button"
                    onClick={() => { playClickSound(); setFilterMine(true); }}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${
                      filterMine
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : 'bg-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    Mine ({repositoryCatalog.filter(r => r.owner === user.username).length})
                  </button>
                )}
              </div>
              <span className={showingShowcases ? 'text-amber-400 font-bold' : 'text-emerald-400 font-bold'}>
                {showingShowcases ? 'Bundled snapshots' : 'Canonical D1'}
              </span>
            </div>
          </div>

          {/* Repo List Items */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-800">
            {repositoryCatalog.length === 0 && canonicalLoadState !== 'loading' && (
              <div className="p-4 space-y-3 text-slate-300">
                <p className="font-bold text-white">No canonical repositories to show.</p>
                <p className="text-[11px] leading-relaxed text-slate-400">
                  {canonicalLoadState === 'error'
                    ? 'The control plane could not be reached. Retry before creating, cloning, or forking anything.'
                    : user ? 'Create a repository to provision its authoritative bare Git storage.' : 'Sign in to create a repository, or explore the demo gallery.'}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setShowBundledExamples(true);
                    setSelectedRepo(GITSMITH_REPOS[0]);
                    setActiveFile(GITSMITH_REPOS[0].files.find(file => file.type === 'file') || GITSMITH_REPOS[0].files[0]);
                  }}
                  className="w-full border border-amber-700 bg-amber-950/60 hover:bg-amber-900/70 text-amber-200 rounded px-3 py-2 text-[11px] font-bold"
                >
                  Open Demo Gallery (Bundled Examples)
                </button>
              </div>
            )}
            {filterMine && user?.username && filteredRepos.length === 0 && repositoryCatalog.length > 0 && (
              <div className="p-4 text-center space-y-2 text-slate-400">
                <p className="font-bold text-white text-xs">No repositories owned by @{user.username}</p>
                <p className="text-[11px]">Click "New Repository" above to create your first forge repo.</p>
              </div>
            )}
            {filteredRepos.map(repo => {
              const isSelected = selectedRepo?.id === repo.id;
              const isOwner = Boolean(user?.username && repo.owner === user.username);
              return (
                <div
                  key={repo.id}
                  onClick={() => {
                    playClickSound();
                    setSelectedRepo(repo);
                    // Prefer the repo's own files; for a canonical repo mirroring a
                    // seeded showcase app, seed activeFile from the embedded showcase
                    // files so the tree highlight + preview line up on first click.
                    const seedFiles = repo.files.length > 0
                      ? repo.files
                      : (repo.source !== 'showcase' ? SHOWCASE_FILES_BY_SLUG[repo.name] : undefined) || repo.files;
                    setActiveFile(seedFiles.find(f => f.type === 'file') || seedFiles[0] || null);
                  }}
                  className={`p-3.5 cursor-pointer transition-all ${
                    isSelected
                      ? 'bg-slate-800/90 border-l-4 border-sky-400 shadow-sm'
                      : 'hover:bg-slate-800/50 text-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2 font-bold text-sm">
                      <span className="text-base">{repo.avatar}</span>
                      <span className={isSelected ? 'text-sky-300' : 'text-white'}>{repo.owner}/{repo.name}</span>
                      {isOwner && (
                        <span className="text-[10px] font-mono text-emerald-300 bg-emerald-950 px-1.5 py-0.2 rounded border border-emerald-700 font-bold">
                          you
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] font-mono text-slate-300 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-700">
                      {repo.branch}
                    </span>
                  </div>

                  <p className="text-slate-400 text-xs line-clamp-2 mb-2 leading-relaxed">
                    {repo.description}
                  </p>

                  <div className="flex items-center gap-3 text-[11px] text-slate-400 font-mono">
                    <span className="flex items-center gap-1"><CircleDot size={11} className="text-amber-400" /> {repo.language.split('/')[0]}</span>
                    <span className="flex items-center gap-1"><Star size={11} className="text-yellow-400" /> {repo.stars ?? 'not tracked'}</span>
                    <span className="flex items-center gap-1"><GitFork size={11} className="text-sky-400" /> {repo.forks ?? 'not synced'}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* DRAG RESIZER 1: Between Sidebar and Main Bay */}
        <div
          onMouseDown={startResizeSidebar}
          className="w-1.5 hover:w-2 bg-slate-800 hover:bg-sky-500 cursor-col-resize flex items-center justify-center transition-all z-20 select-none group"
          title="Drag to resize repository sidebar"
        >
          <GripVertical size={10} className="text-slate-500 group-hover:text-white" />
        </div>

        {/* Right Column: Selected Repo Detail View (GitHub IDE Style) */}
        <div className="flex-1 flex flex-col bg-[#0b1120] overflow-y-auto p-4 space-y-3 min-w-0">
          {!selectedRepo || repositoryCatalog.length === 0 ? (
            <div className="m-auto max-w-xl rounded-lg border border-slate-700 bg-slate-900 p-6 text-center shadow-xl">
              <Code size={36} className="mx-auto mb-3 text-sky-400" />
              <h1 className="text-lg font-bold text-white">
                {canonicalLoadState === 'loading'
                  ? 'Loading the forge…'
                  : canonicalLoadState === 'error'
                    ? 'Forge Control Plane Unavailable'
                    : 'Start with an authoritative repository'}
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">
                {canonicalLoadState === 'error'
                  ? 'GITSMITH could not load the canonical catalog. Nothing from the bundled examples is being presented as live repository state.'
                  : canonicalLoadState === 'loading'
                    ? 'Checking the control plane and Git gateway before enabling repository actions.'
                    : 'Create a repository to commission bare Git storage, then push the first ref from your local checkout.'}
              </p>
            </div>
          ) : (<>
          {/* Repo Title Header Banner */}
          <div className="bg-[#1e293b] border border-slate-700 rounded-lg p-4 shadow-sm">
            <div className="flex items-start justify-between flex-wrap gap-3 mb-3">
              <div>
                <div className="flex items-center gap-2.5 mb-1.5 flex-wrap">
                  <span className="text-2xl">{selectedRepo.avatar}</span>
                  <h1 className="text-xl font-bold text-white flex items-center gap-1.5 font-mono">
                    <span className="text-slate-400 font-normal">{selectedRepo.owner}</span>
                    <span className="text-slate-500">/</span>
                    <span className="text-sky-400 font-black">{selectedRepo.name}</span>
                  </h1>
                  <span className="bg-slate-900 text-slate-300 text-[11px] font-bold px-2 py-0.5 rounded-full border border-slate-700">
                    {selectedRepo.visibility}
                  </span>
                  {user?.username && selectedRepo.owner === user.username && (
                    <span className="bg-emerald-950 text-emerald-300 text-[11px] font-bold px-2 py-0.5 rounded-full border border-emerald-700">
                      Owned by you
                    </span>
                  )}
                  <span className={`${
                    selectedRepo.source === 'showcase'
                      ? 'bg-amber-950 text-amber-300 border-amber-700'
                      : selectedRepo.status === 'active' && selectedRepo.lastCommit.sha !== 'No projected ref'
                        ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
                        : 'bg-amber-950 text-amber-300 border-amber-700'
                  } text-[11px] font-bold px-2 py-0.5 rounded-full border`}>
                    {selectedRepo.source === 'canonical'
                      ? (selectedRepo.status === 'provisioning'
                          ? 'Provisioning'
                          : selectedRepo.lastCommit.sha === 'No projected ref'
                            ? 'Source not pushed'
                            : 'Active')
                      : 'Demo Showcase'}
                  </span>
                </div>
                <p className="text-xs text-slate-300 max-w-3xl leading-relaxed">
                  {selectedRepo.description}
                </p>
              </div>

              {/* Action Buttons: Live App, Fork, Clone */}
              <div className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-2 flex-wrap">
                  {selectedRepo.liveUrl && <a
                    href={selectedRepo.liveUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => playClickSound()}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white px-3.5 py-1.5 rounded-md font-bold text-xs flex items-center gap-1.5 transition-colors shadow-md"
                  >
                    <Play size={13} fill="currentColor" />
                    <span>▷ View Live App</span>
                    <ExternalLink size={12} />
                  </a>}

                  <button
                    onClick={() => {
                      if (selectedRepo.source === 'showcase') {
                        showAlert('Bundled showcase examples cannot be forked. Create or select a canonical repository to fork.', 'Demo Example', 'info');
                        return;
                      }
                      if (!transportReady) {
                        return showAlert('This repository is provisioned, but GITSMITH SSH transport has not been activated. No fork or remote was created.', 'SSH Transport Pending', 'error');
                      }
                      if (!selectedRepo.lastCommit?.sha || selectedRepo.lastCommit.sha === 'No projected ref') {
                        return showAlert('This repository has no commits yet. Push the first commit before forking.', 'Source Not Pushed', 'info');
                      }
                      playSuccessChime();
                      setShowForkModal(true);
                    }}
                    className="bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 text-white font-bold px-3.5 py-1.5 rounded-md text-xs flex items-center gap-1.5 transition-all shadow-md border border-amber-400"
                    title="Fork into isolated worktree with Claude Code / AGY / Cursor"
                  >
                    <Bot size={14} className="text-yellow-200" />
                    <span>⚡ Fork with AI</span>
                    <span className="bg-amber-900/60 px-1.5 py-0.5 rounded text-[10px] text-amber-200 font-mono">{selectedRepo.forks ?? 'local'}</span>
                  </button>

                  <button
                    onClick={() => {
                      handleCopyClone(selectedRepo);
                    }}
                    className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 px-3.5 py-1.5 rounded-md text-xs font-bold flex items-center gap-1.5 transition-colors shadow-sm"
                    title="Copy SLOP install command"
                  >
                    {copiedClone ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                    <span>{copiedClone ? 'Install copied!' : 'Install'}</span>
                  </button>
                </div>
                <div className="text-[11px] font-mono text-slate-400 flex items-center gap-1">
                  <span>your fork &rarr;</span>
                  <span className="text-emerald-400 font-bold">
                    @{user?.username || 'you'}/{selectedRepo.name}
                  </span>
                </div>
              </div>
            </div>

            {/* Meta Stats Bar */}
            <div className="pt-3 border-t border-slate-700 flex items-center justify-between text-xs text-slate-300 flex-wrap gap-2 font-mono">
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1.5 text-sky-400 font-bold bg-slate-900 px-2 py-0.5 rounded border border-slate-700">
                  <GitBranch size={13} /> {selectedRepo.branch}
                </span>
                <span>Storage: <strong className="text-emerald-400 font-semibold">{selectedRepo.sqlitePath}</strong></span>
                <span>License: <strong className="text-white">{selectedRepo.license}</strong></span>
              </div>

              {/* Verified Commit Badge */}
              <div className="flex items-center gap-2 bg-slate-900 px-3 py-1 rounded border border-slate-700">
                <Clock size={13} className="text-slate-400" />
                <span className="text-slate-400">
                  {selectedRepo.source === 'canonical' ? 'Authoritative ref:' : 'Bundled snapshot:'}
                </span>
                <span className="text-sky-400 font-bold">{selectedRepo.lastCommit.sha}</span>
                <span className="text-white">"{selectedRepo.lastCommit.message}"</span>
                <span className="bg-slate-800 text-slate-300 font-mono text-[10px] px-1.5 py-0.2 rounded font-bold border border-slate-600">
                  {selectedRepo.source === 'canonical'
                    ? (selectedRepo.lastCommit.sha === 'No projected ref' ? 'NO REF PROJECTED' : 'D1 PROJECTION')
                    : 'DEMO ONLY'}
                </span>
              </div>
            </div>
          </div>

          {/* Sub Tabs: Code & Files / Commit Log / Lineage */}
          <div className="flex items-center gap-2 border-b border-slate-700 select-none">
            <button
              onClick={() => { playClickSound(); setActiveTab('code'); }}
              className={`px-4 py-2 border-b-2 font-bold text-xs flex items-center gap-2 transition-colors ${
                activeTab === 'code'
                  ? 'border-sky-400 text-sky-400 bg-slate-800/40 rounded-t'
                  : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              <Code size={14} /> Code &amp; Files
            </button>
            <button
              onClick={() => { playClickSound(); setActiveTab('commits'); }}
              className={`px-4 py-2 border-b-2 font-bold text-xs flex items-center gap-2 transition-colors ${
                activeTab === 'commits'
                  ? 'border-sky-400 text-sky-400 bg-slate-800/40 rounded-t'
                  : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              <Clock size={14} /> Commit Log &amp; CAS Reflog
            </button>
            <button
              onClick={() => { playClickSound(); setActiveTab('lineage'); }}
              className={`px-4 py-2 border-b-2 font-bold text-xs flex items-center gap-2 transition-colors ${
                activeTab === 'lineage'
                  ? 'border-sky-400 text-sky-400 bg-slate-800/40 rounded-t'
                  : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              <Sparkles size={14} /> 70/20 Lineage Settlement
            </button>
          </div>

          {/* Tab 1: Code & Files with Resizable File Tree and Line Numbers */}
          {activeTab === 'code' && (
            <div className="border border-slate-700 rounded-lg overflow-hidden bg-[#1e293b] shadow-md flex flex-col flex-1 min-h-[420px]">
              {/* File Breadcrumb & Action Bar */}
              <div className="bg-slate-900 px-4 py-2.5 border-b border-slate-700 flex items-center justify-between font-mono text-xs">
                <div className="flex items-center gap-2 text-white font-bold">
                  <FileCode size={15} className="text-sky-400" />
                  <span>{selectedRepo.name}</span>
                  <span className="text-slate-500">/</span>
                  <span className="text-sky-300">{activeFile?.name || (displayedFiles[0]?.name || 'README.md')}</span>
                </div>
                <div className="flex items-center gap-3">
                  {fileContent !== null && (
                    <span className="text-slate-400 text-[11px]">
                      {codeLines.length} lines · {activeFile?.size || 'Raw UTF-8'}
                    </span>
                  )}
                  <button
                    onClick={handleCopyCode}
                    disabled={!fileContent}
                    className="bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 border border-slate-600 px-2 py-1 rounded text-[11px] flex items-center gap-1 font-mono transition-colors"
                  >
                    {copiedCode ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                    <span>{copiedCode ? 'Copied' : 'Copy Code'}</span>
                  </button>
                </div>
              </div>

              <div className="flex flex-1 overflow-hidden">
                {/* File List Tree Sidebar (Drag-Resizable Width) */}
                <div 
                  style={{ width: `${fileTreeWidth}px`, minWidth: '160px', maxWidth: '460px' }}
                  className="bg-[#0f172a] p-2 space-y-1 overflow-y-auto shrink-0"
                >
                  <div className="text-[10px] font-bold text-slate-400 uppercase px-2 py-1 tracking-wider font-mono">
                    Repository Files
                  </div>
                  {displayedFiles.map((file, idx) => {
                    const isFileActive = (activeFile?.name || displayedFiles[0]?.name || 'README.md') === file.name;
                    return (
                      <button
                        key={idx}
                        onClick={() => {
                          playClickSound();
                          setActiveFile(file);
                        }}
                        className={`w-full text-left px-3 py-1.5 rounded-md flex items-center justify-between text-xs font-mono transition-colors ${
                          isFileActive
                            ? 'bg-sky-600 text-white font-bold shadow'
                            : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                        }`}
                      >
                        <span className="flex items-center gap-2 truncate">
                          {file.type === 'dir' ? (
                            <Folder size={14} className="text-sky-400 shrink-0" />
                          ) : (
                            <FileText size={14} className={isFileActive ? 'text-white' : 'text-slate-400 shrink-0'} />
                          )}
                          <span className="truncate">{file.name}</span>
                        </span>
                        {file.size && <span className="text-[10px] opacity-75 shrink-0">{file.size}</span>}
                      </button>
                    );
                  })}
                </div>

                {/* DRAG RESIZER 2: Between File Tree and Code Editor */}
                <div
                  onMouseDown={startResizeFileTree}
                  className="w-1.5 hover:w-2 bg-slate-800 hover:bg-sky-500 cursor-col-resize flex items-center justify-center transition-all z-20 select-none group"
                  title="Drag to resize file tree panel"
                >
                  <GripVertical size={10} className="text-slate-500 group-hover:text-white" />
                </div>

                {/* Code Editor Viewport */}
                {fileLoading ? (
                  <div className="flex-1 bg-[#090d16] p-6 font-mono text-xs text-slate-400 flex items-center justify-center">
                    <div className="flex items-center gap-2">
                      <Clock size={16} className="animate-spin text-sky-400" />
                      <span>Loading file from repository…</span>
                    </div>
                  </div>
                ) : fileError ? (
                  <div className="flex-1 bg-[#090d16] p-6 font-mono text-xs overflow-auto flex items-start">
                    <div className="max-w-xl p-4 bg-rose-950/50 border border-rose-800 rounded-lg text-rose-300 space-y-2">
                      <div className="font-bold flex items-center gap-2 text-rose-400 text-sm">
                        <X size={16} className="text-rose-400" />
                        <span>File Read Unavailable</span>
                      </div>
                      <p className="text-xs leading-relaxed text-rose-200">{fileError}</p>
                      <p className="text-[11px] text-rose-400/80">Authoritative Git storage is queried via /api/repo-file. No synthetic fallback is generated.</p>
                    </div>
                  </div>
                ) : fileContent !== null ? (
                  <div className="flex-1 bg-[#090d16] p-4 font-mono text-xs overflow-auto text-slate-100 flex min-w-0">
                    {/* Line Numbers Gutter */}
                    <div className="select-none text-slate-600 text-right pr-4 border-r border-slate-800 font-mono space-y-1 shrink-0">
                      {codeLines.map((_: string, i: number) => (
                        <div key={i} className="leading-relaxed">{i + 1}</div>
                      ))}
                    </div>

                    {/* Code Text Content */}
                    <div className="pl-4 flex-1 space-y-1 overflow-x-auto select-text font-mono text-slate-200">
                      {codeLines.map((line: string, i: number) => (
                        <div key={i} className="leading-relaxed whitespace-pre font-mono">
                          {line || ' '}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 bg-[#090d16] p-6 font-mono text-xs text-slate-500 flex items-center justify-center">
                    <span>Select a file from the repository to view its contents.</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Tab 2: Commit Log & CAS Reflog */}
          {activeTab === 'commits' && (
            <div className="border border-slate-700 rounded-lg overflow-hidden bg-[#1e293b] p-4 space-y-3 shadow-md">
              <div className="font-mono text-sm font-bold text-white mb-2 flex items-center justify-between">
                <span>{selectedRepo.source === 'canonical' ? 'Canonical Default-Ref Projection' : 'Bundled Commit Snapshot'}</span>
                <span className={`text-xs font-normal ${selectedRepo.source === 'canonical' ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {selectedRepo.source === 'canonical' ? selectedRepo.branch : 'Not a canonical gateway reflog'}
                </span>
              </div>

              <div className="space-y-2 font-mono text-xs">
                <div className="bg-[#0f172a] p-3.5 rounded-lg border border-slate-700 flex items-center justify-between">
                  <div>
                    <div className="text-white font-bold text-sm">{selectedRepo.lastCommit.message}</div>
                    <div className="text-slate-400 text-xs mt-1">
                      Authored by <strong className="text-sky-300">@{selectedRepo.lastCommit.author}</strong> ({selectedRepo.lastCommit.time})
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="bg-slate-800 text-sky-400 px-2.5 py-1 rounded border border-slate-700 font-bold">
                      {selectedRepo.lastCommit.sha}
                    </span>
                    <span className="bg-slate-800 text-slate-300 px-2 py-1 rounded border border-slate-600 font-bold text-[10px]">
                      {selectedRepo.source === 'canonical' ? 'D1 PROJECTION' : 'UNVERIFIED SNAPSHOT'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Tab 3: Lineage Settlement */}
          {activeTab === 'lineage' && (
            <div className="border border-slate-700 rounded-lg overflow-hidden bg-[#1e293b] p-4 space-y-4 shadow-md">
              <div className="flex items-center justify-between border-b border-slate-700 pb-3">
                <div>
                  <h3 className="font-bold text-sm text-white">70% Maker / 20% Lineage Ancestor Settlement</h3>
                  <p className="text-xs text-slate-400">Mathematical splits automatically credited upon license purchase or fork fee.</p>
                </div>
                <span className="bg-amber-950 text-amber-300 border border-amber-700 px-2.5 py-1 rounded text-xs font-mono font-bold">
                  Immutable Protocol Rule
                </span>
              </div>

              <div className="grid grid-cols-3 gap-3 font-mono text-xs">
                <div className="bg-[#0f172a] p-3 rounded-lg border border-slate-700">
                  <div className="text-slate-400 mb-1 font-bold">Root Release</div>
                  <div className="text-2xl font-black text-emerald-400">90% / 10%</div>
                  <div className="text-[11px] text-slate-400 mt-1">No ancestor claim: unused lineage allocation returns to the maker.</div>
                </div>
                <div className="bg-[#0f172a] p-3 rounded-lg border border-slate-700">
                  <div className="text-slate-400 mb-1 font-bold">Downstream Release</div>
                  <div className="text-2xl font-black text-sky-400">70% / 20% / 10%</div>
                  <div className="text-[11px] text-slate-400 mt-1">Immediate maker / upstream ancestors / protocol pool.</div>
                </div>
                <div className="bg-[#0f172a] p-3 rounded-lg border border-slate-700">
                  <div className="text-slate-400 mb-1 font-bold">Selected Repository</div>
                  <div className="text-lg font-black text-amber-400">No sale projection loaded</div>
                  <div className="text-[11px] text-slate-400 mt-1">A purchase-time lineage snapshot is required before showing exact allocations.</div>
                </div>
              </div>
            </div>
          )}
          </>)}
        </div>
      </div>
      {/* 1-Click Fork & Code with AI Modal */}
      {selectedRepo && repositoryCatalog.length > 0 && selectedRepo.source === 'canonical' && <ForkWithAiModal
        isOpen={showForkModal}
        onClose={() => setShowForkModal(false)}
        app={{
          id: selectedRepo.id,
          name: selectedRepo.name,
          version: 'v1.0.0',
          author: selectedRepo.owner,
          creator: selectedRepo.owner,
          avatar: selectedRepo.avatar,
          creatorAvatar: selectedRepo.avatar,
          hasCanonicalRepo: true,
          repositoryId: selectedRepo.id,
          isRepoActive: selectedRepo.status === 'active',
          repoSlug: selectedRepo.name,
          repoStatus: selectedRepo.status,
          repoVisibility: selectedRepo.visibility,
          repoDefaultRef: selectedRepo.branch
        }}
      />}
    </div>
  );
};
