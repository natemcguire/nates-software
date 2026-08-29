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
  return {
    id: repo.id,
    name: repo.slug,
    owner,
    avatar: '🔩',
    description: `Canonical ${repo.visibility} repository. Gateway state: ${repo.status}.`,
    stars: null,
    forks: Number(repo.forkCount || 0),
    language: 'Not reported',
    license: 'Not reported',
    sqlitePath: 'Application-defined',
    branch: repo.defaultRef.replace(/^refs\/heads\//, ''),
    lastCommit: {
      sha: commitOid ? commitOid.slice(0, 12) : 'No projected ref',
      message: commitOid ? 'Authoritative default-ref projection' : `Repository ${repo.status}`,
      author: owner,
      time: repo.updatedAt || 'Not reported',
      verified: false
    },
    tags: ['Canonical', repo.visibility, repo.status, repo.objectFormat || 'git'],
    files: [],
    source: 'canonical',
    visibility: repo.visibility,
    status: repo.status
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
    id: 'picfitai',
    name: 'picfitai',
    owner: 'nate',
    avatar: '✨',
    description: 'Private in-browser image crop, resize, compression, format conversion, and download utility.',
    stars: null,
    forks: null,
    language: 'TypeScript / Canvas API',
    license: 'MIT Image Utility',
    sqlitePath: 'No database required',
    branch: 'main',
    lastCommit: {
      sha: '4d88e01',
      message: 'feat(studio): add validated crop, resize, and local export pipeline',
      author: 'nate',
      time: '1h ago',
      verified: false
    },
    tags: ['Images', 'Crop', 'Resize', 'Compression', 'Browser'],
    source: 'showcase',
    visibility: 'public',
    status: 'bundled',
    liveUrl: 'https://picfitai.nates-software.com',
    liveAppUrl: 'https://picfitai.nates-software.com',
    files: [
      { name: 'src', type: 'dir' },
      { name: 'src/PicFitStudio.tsx', type: 'file', size: '28.4 KB', content: `export function PicFitStudio() {\n  return <main aria-label="PicFit image studio" />;\n}` },
      { name: 'src/picfitDomain.ts', type: 'file', size: '14.2 KB', content: `export const MAX_CANVAS_PIXELS = 32_000_000;\nexport type OutputFormat = 'image/jpeg' | 'image/png' | 'image/webp';` },
      { name: 'package.json', type: 'file', size: '1.2 KB', content: `{ "name": "picfit", "private": true, "type": "module" }` },
      { name: 'README.md', type: 'file', size: '3.1 KB', content: `# PicFit\n\nCrop, resize, compress, convert, and download images locally in your browser.` }
    ]
  }
];

export const GitsmithView: React.FC = () => {
  const { user, openAuthModal } = useAuth();
  const { showAlert } = useAlert();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRepo, setSelectedRepo] = useState<GitsmithRepo>(GITSMITH_REPOS[0]);
  const [activeFile, setActiveFile] = useState<any>(GITSMITH_REPOS[0].files.find(f => f.type === 'file') || GITSMITH_REPOS[0].files[0]);
  const [copiedClone, setCopiedClone] = useState(false);
  const [showForkModal, setShowForkModal] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [activeTab, setActiveTab] = useState<'code' | 'commits' | 'lineage'>('code');
  const [canonicalRepoCount, setCanonicalRepoCount] = useState<number | null>(null);
  const [canonicalRepositories, setCanonicalRepositories] = useState<GitsmithRepo[]>([]);
  const [canonicalLoadState, setCanonicalLoadState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [gatewayReady, setGatewayReady] = useState(false);
  const [gatewayCheckState, setGatewayCheckState] = useState<'checking' | 'ready' | 'unavailable'>('checking');
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
          setSelectedRepo(current => mapped.find(repo => repo.id === current.id) || mapped[0]);
          setActiveFile(undefined);
        } else {
          setSelectedRepo(GITSMITH_REPOS[0]);
          setActiveFile(GITSMITH_REPOS[0].files.find(file => file.type === 'file') || GITSMITH_REPOS[0].files[0]);
        }
        return;
      }
      setCanonicalLoadState('error');
    } catch {
      setCanonicalRepoCount(null);
      setCanonicalLoadState('error');
    }
  };

  const refreshGatewayReadiness = async () => {
    setGatewayCheckState('checking');
    try {
      const response = await fetch('/api/git?action=gateway-readiness', { credentials: 'same-origin', cache: 'no-store' });
      const payload = await response.json();
      const ready = response.ok && payload?.success === true && payload?.ready === true;
      setGatewayReady(ready);
      setGatewayCheckState(ready ? 'ready' : 'unavailable');
    } catch {
      setGatewayReady(false);
      setGatewayCheckState('unavailable');
    }
  };

  useEffect(() => {
    void refreshCanonicalRepositories();
    void refreshGatewayReadiness();
  }, [user?.id]);

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

  const repositoryCatalog = canonicalRepositories.length > 0 ? canonicalRepositories : GITSMITH_REPOS;
  const showingShowcases = canonicalRepositories.length === 0;
  const filteredRepos = repositoryCatalog.filter(repo => {
    const q = searchQuery.toLowerCase();
    const matchName = repo.name.toLowerCase().includes(q) || repo.owner.toLowerCase().includes(q);
    const matchDesc = repo.description.toLowerCase().includes(q);
    const matchTag = repo.tags.some(t => t.toLowerCase().includes(q));
    const matchLang = repo.language.toLowerCase().includes(q);
    return matchName || matchDesc || matchTag || matchLang;
  });

  const handleCopyClone = (repo: GitsmithRepo) => {
    playClickSound();
    navigator.clipboard.writeText(`slop fork ${repo.owner}/${repo.name}`);
    setCopiedClone(true);
    setTimeout(() => setCopiedClone(false), 2000);
  };

  const handleCopyCode = () => {
    if (!activeFile?.content) return;
    playClickSound();
    navigator.clipboard.writeText(activeFile.content);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };



  const codeLines = (activeFile?.content || (selectedRepo.source === 'canonical'
    ? `# ${selectedRepo.owner}/${selectedRepo.name}\n\nCanonical repository metadata is loaded from the control plane.\nFile browsing requires a commissioned GITSMITH object gateway.`
    : `# ${selectedRepo.name}\n\nBundled showcase snapshot; this is not a live forge checkout.`)).split('\n');

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
            <span>{gatewayCheckState === 'ready' ? 'Gateway ready' : gatewayCheckState === 'checking' ? 'Checking gateway' : 'Gateway unavailable'}</span>
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
        <div className="bg-amber-950/80 border-b border-amber-700 px-4 py-2 text-[11px] text-amber-200 font-mono">
          {canonicalLoadState === 'loading' ? 'LOADING CANONICAL FORGE… ' : canonicalLoadState === 'error' ? 'CANONICAL FORGE UNAVAILABLE — ' : 'NO VISIBLE CANONICAL REPOSITORIES — '}
          Showing bundled source examples only. Their files and commit labels are snapshots, not live gateway evidence.
        </div>
      ) : (
        <div className="bg-emerald-950/80 border-b border-emerald-700 px-4 py-2 text-[11px] text-emerald-200 font-mono">
          CANONICAL CONTROL-PLANE RECORDS — Repository status, default refs, and fork totals are loaded from D1. Git objects remain authoritative at the gateway.
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
              <span className="font-bold text-slate-300">{filteredRepos.length} {showingShowcases ? 'Showcase Previews' : 'Repositories'}</span>
              <span className={showingShowcases ? 'text-amber-400 font-bold' : 'text-emerald-400 font-bold'}>{showingShowcases ? 'Bundled snapshots' : 'Canonical D1'}</span>
            </div>
          </div>

          {/* Repo List Items */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-800">
            {filteredRepos.map(repo => {
              const isSelected = selectedRepo.id === repo.id;
              return (
                <div
                  key={repo.id}
                  onClick={() => {
                    playClickSound();
                    setSelectedRepo(repo);
                    setActiveFile(repo.files.find(f => f.type === 'file') || repo.files[0]);
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
                  <span className={`${selectedRepo.source === 'canonical' ? 'bg-emerald-950 text-emerald-300 border-emerald-700' : 'bg-amber-950 text-amber-300 border-amber-700'} text-[11px] font-bold px-2 py-0.5 rounded-full border`}>
                    {selectedRepo.source === 'canonical' ? selectedRepo.status : 'Bundled Showcase'}
                  </span>
                </div>
                <p className="text-xs text-slate-300 max-w-3xl leading-relaxed">
                  {selectedRepo.description}
                </p>
              </div>

              {/* Action Buttons: Live App, Fork, Clone */}
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
                  onClick={() => handleCopyClone(selectedRepo)}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 px-3.5 py-1.5 rounded-md text-xs font-bold flex items-center gap-1.5 transition-colors shadow-sm"
                  title="Copy SLOP install command"
                >
                  {copiedClone ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                  <span>{copiedClone ? 'Install copied!' : 'Install'}</span>
                </button>
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
                <span className="text-slate-400">Bundled snapshot:</span>
                <span className="text-sky-400 font-bold">{selectedRepo.lastCommit.sha}</span>
                <span className="text-white">"{selectedRepo.lastCommit.message}"</span>
                <span className="bg-slate-800 text-slate-300 font-mono text-[10px] px-1.5 py-0.2 rounded font-bold border border-slate-600">
                  Signature not checked
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
                  <span className="text-sky-300">{activeFile?.name || 'README.md'}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-slate-400 text-[11px]">
                    {codeLines.length} lines · {activeFile?.size || 'Raw UTF-8'}
                  </span>
                  <button
                    onClick={handleCopyCode}
                    className="bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-600 px-2 py-1 rounded text-[11px] flex items-center gap-1 font-mono transition-colors"
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
                  {selectedRepo.files.map((file, idx) => {
                    const isFileActive = activeFile?.name === file.name;
                    return (
                      <button
                        key={idx}
                        onClick={() => {
                          playClickSound();
                          if (file.content) setActiveFile(file);
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

                {/* Line-Numbered Code Editor Viewport */}
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
                  <div className="text-slate-400 mb-1 font-bold">70% Direct Maker</div>
                  <div className="text-2xl font-black text-emerald-400">$35.00 / $50.00</div>
                  <div className="text-[11px] text-slate-400 mt-1">Directly paid to @{selectedRepo.owner}</div>
                </div>
                <div className="bg-[#0f172a] p-3 rounded-lg border border-slate-700">
                  <div className="text-slate-400 mb-1 font-bold">20% Ancestor Lineage</div>
                  <div className="text-2xl font-black text-sky-400">$10.00 / $50.00</div>
                  <div className="text-[11px] text-slate-400 mt-1">Distributed across upstream parent makers</div>
                </div>
                <div className="bg-[#0f172a] p-3 rounded-lg border border-slate-700">
                  <div className="text-slate-400 mb-1 font-bold">10% Protocol Pool</div>
                  <div className="text-2xl font-black text-amber-400">$5.00 / $50.00</div>
                  <div className="text-[11px] text-slate-400 mt-1">Platform hosting &amp; compute</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      {/* 1-Click Fork & Code with AI Modal */}
      <ForkWithAiModal
        isOpen={showForkModal}
        onClose={() => setShowForkModal(false)}
        app={{
          id: selectedRepo.id,
          name: selectedRepo.name,
          version: 'v1.0.0',
          author: selectedRepo.owner,
          creator: selectedRepo.owner,
          avatar: selectedRepo.avatar,
          creatorAvatar: selectedRepo.avatar
        }}
      />
    </div>
  );
};
