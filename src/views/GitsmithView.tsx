import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  GitBranch,
  GitFork,
  Star,
  Search,
  ExternalLink,
  Code,
  FileCode,
  Copy,
  Check,
  Sparkles,
  Play,
  Clock,
  CircleDot,
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  FileText,
  GripVertical,
  Globe,
  Plus,
  X,
  RefreshCw
} from 'lucide-react';
import { playClickSound, playSuccessChime } from '../lib/soundEngine';
import { useAuth } from '../context/AuthContext';
import { useAlert } from '../context/AlertContext';

import { ForkWithAiModal } from '../components/ForkWithAiModal';
import { Win95Scroll } from '../components/Win95Scroll';
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

interface FileTreeItem {
  name: string;
  type: 'file' | 'dir';
  size?: string;
  content?: string;
}

interface TreeNode {
  path: string;
  name: string;
  type: 'file' | 'dir';
  size?: string;
  content?: string;
  children: TreeNode[];
}

function buildFileTree(files: FileTreeItem[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const item of files) {
    const parts = item.name.split('/').filter(Boolean);
    if (parts.length === 0) continue;

    let currentLevel = root;
    let currentPath = '';

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isLeaf = i === parts.length - 1;

      let existing = currentLevel.find(n => n.name === part);
      if (!existing) {
        existing = {
          path: currentPath,
          name: part,
          type: isLeaf ? item.type : 'dir',
          size: isLeaf ? item.size : undefined,
          content: isLeaf ? item.content : undefined,
          children: []
        };
        currentLevel.push(existing);
      } else if (isLeaf) {
        existing.type = item.type;
        if (item.size) existing.size = item.size;
        if (item.content) existing.content = item.content;
      }
      currentLevel = existing.children;
    }
  }

  function sortNodes(nodes: TreeNode[]) {
    nodes.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'dir' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) {
      if (node.children.length > 0) {
        sortNodes(node.children);
      }
    }
  }

  sortNodes(root);
  return root;
}

function findFirstFile(nodes: TreeNode[]): TreeNode | null {
  for (const node of nodes) {
    if (node.type === 'file') {
      if (node.name.toLowerCase() === 'readme.md') return node;
    }
  }
  for (const node of nodes) {
    if (node.type === 'file') return node;
    if (node.children.length > 0) {
      const found = findFirstFile(node.children);
      if (found) return found;
    }
  }
  return null;
}

export interface GitsmithViewProps {
  initialRepoSlug?: string | null;
}

export const GitsmithView: React.FC<GitsmithViewProps> = ({ initialRepoSlug }) => {
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
  const [canonicalRepositories, setCanonicalRepositories] = useState<GitsmithRepo[]>([]);
  const [canonicalLoadState, setCanonicalLoadState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [showBundledExamples, setShowBundledExamples] = useState(false);
  const [gatewayReady, setGatewayReady] = useState(false);
  const [transportReady, setTransportReady] = useState(false);
  const [transportEndpoint, setTransportEndpoint] = useState<{ host: string; port: number } | null>(null);
  const [filterMine, setFilterMine] = useState(false);
  const [showCreateRepo, setShowCreateRepo] = useState(false);
  const [newRepoSlug, setNewRepoSlug] = useState('');
  const [newRepoVisibility, setNewRepoVisibility] = useState<'public' | 'unlisted' | 'private'>('public');
  const [isCreatingRepo, setIsCreatingRepo] = useState(false);
  const [repoTreeFiles, setRepoTreeFiles] = useState<{ name: string; type: 'file' | 'dir'; size?: string; content?: string }[]>([]);
  const [repoTreeLoading, setRepoTreeLoading] = useState(false);
  const [repoTreeError, setRepoTreeError] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});

  const refreshCanonicalRepositories = async () => {
    try {
      const response = await fetch('/api/git?list=1', { credentials: 'same-origin' });
      const payload = await response.json();
      if (response.ok && payload.success && Array.isArray(payload.repositories)) {
        const mapped: GitsmithRepo[] = payload.repositories.map((repo: CanonicalRepositoryProjection) => mapCanonicalRepository(repo));
        setCanonicalRepositories(mapped);
        setCanonicalLoadState('loaded');
        if (mapped.length > 0) {
          setSelectedRepo(current => {
            if (initialRepoSlug) {
              const targetSlug = initialRepoSlug.toLowerCase();
              const targetMatch = mapped.find(
                r => r.name.toLowerCase() === targetSlug || r.id.toLowerCase() === targetSlug || `${r.owner}/${r.name}`.toLowerCase() === targetSlug
              );
              if (targetMatch) return targetMatch;
            }
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
      setCanonicalLoadState('error');
      setSelectedRepo(current => (showBundledExamples && current?.source === 'showcase' ? current : null));
    }
  };

  useEffect(() => {
    if (!initialRepoSlug) return;
    const targetSlug = initialRepoSlug.toLowerCase();
    const canonicalMatch = canonicalRepositories.find(
      r => r.name.toLowerCase() === targetSlug || r.id.toLowerCase() === targetSlug || `${r.owner}/${r.name}`.toLowerCase() === targetSlug
    );
    if (canonicalMatch) {
      setSelectedRepo(canonicalMatch);
      setActiveFile(null);
      return;
    }
    const showcaseMatch = GITSMITH_REPOS.find(
      r => r.name.toLowerCase() === targetSlug || r.id.toLowerCase() === targetSlug || `${r.owner}/${r.name}`.toLowerCase() === targetSlug
    );
    if (showcaseMatch) {
      setShowBundledExamples(true);
      setSelectedRepo(showcaseMatch);
      setActiveFile(showcaseMatch.files.find(f => f.type === 'file') || showcaseMatch.files[0] || null);
    }
  }, [initialRepoSlug, canonicalRepositories]);

  const refreshGatewayReadiness = async () => {
    try {
      const response = await fetch('/api/git?action=gateway-readiness', { credentials: 'same-origin', cache: 'no-store' });
      const payload = await response.json();
      const ready = response.ok && payload?.success === true && payload?.ready === true;
      setGatewayReady(ready);
      setTransportReady(payload?.transport?.active === true);
      setTransportEndpoint(payload?.transport?.active === true && payload?.transport?.host
        ? { host: payload.transport.host, port: Number(payload.transport.port || 22) }
        : null);
    } catch {
      setGatewayReady(false);
      setTransportReady(false);
      setTransportEndpoint(null);
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

  const displayedFiles = selectedRepo
    ? (selectedRepo.source === 'showcase' ? selectedRepo.files : repoTreeFiles)
    : [];

  const fileTree = useMemo(() => buildFileTree(displayedFiles), [displayedFiles]);

  useEffect(() => {
    if (fileTree.length > 0 && (!activeFile || !displayedFiles.some(f => f.name === activeFile.name))) {
      const first = findFirstFile(fileTree);
      if (first) {
        setActiveFile({ name: first.path, type: 'file', size: first.size, content: first.content });
      }
    }
  }, [fileTree, activeFile, displayedFiles]);

  useEffect(() => {
    let isCancelled = false;

    if (!selectedRepo || selectedRepo.source === 'showcase') {
      setRepoTreeFiles([]);
      setRepoTreeError(null);
      setRepoTreeLoading(false);
      return;
    }

    if (selectedRepo.status === 'provisioning' || !selectedRepo.lastCommit.sha || selectedRepo.lastCommit.sha === 'No projected ref') {
      setRepoTreeFiles([]);
      setRepoTreeError(null);
      setRepoTreeLoading(false);
      return;
    }

    if (selectedRepo.visibility === 'private' || selectedRepo.visibility === 'unlisted') {
      setRepoTreeFiles([]);
      setRepoTreeError('File tree listing is restricted to public repositories. Use SSH clone to inspect private repository files.');
      setRepoTreeLoading(false);
      return;
    }

    setRepoTreeLoading(true);
    setRepoTreeError(null);
    setRepoTreeFiles([]);

    const query = selectedRepo.id
      ? `repoId=${encodeURIComponent(selectedRepo.id)}`
      : `owner=${encodeURIComponent(selectedRepo.owner)}&slug=${encodeURIComponent(selectedRepo.name)}`;
    const url = `/api/repo-tree?${query}`;

    fetch(url, { credentials: 'same-origin' })
      .then(async res => {
        if (isCancelled) return;
        if (res.ok) {
          const payload = await res.json();
          if (payload?.success && Array.isArray(payload.files)) {
            const mapped = (payload.files as string[])
              .filter((f): f is string => typeof f === 'string' && f.length > 0)
              .sort()
              .map(name => ({ name, type: 'file' as const }));
            setRepoTreeFiles(mapped);
            setRepoTreeError(mapped.length === 0 ? 'Repository tree is empty at the current commit.' : null);
          } else {
            setRepoTreeFiles([]);
            setRepoTreeError('Repository gateway returned an invalid tree payload.');
          }
        } else if (res.status === 404) {
          setRepoTreeFiles([]);
          setRepoTreeError('Repository tree not found at the current commit (HTTP 404).');
        } else if (res.status === 502) {
          setRepoTreeFiles([]);
          setRepoTreeError('Repository gateway unreachable (HTTP 502). File browsing requires an active GITSMITH object gateway.');
        } else {
          setRepoTreeFiles([]);
          setRepoTreeError(`Failed to list repository files (HTTP ${res.status}).`);
        }
      })
      .catch(err => {
        if (isCancelled) return;
        setRepoTreeFiles([]);
        setRepoTreeError(`Transport error: ${err?.message || 'Network request failed'}`);
      })
      .finally(() => {
        if (!isCancelled) {
          setRepoTreeLoading(false);
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
    selectedRepo?.lastCommit?.sha
  ]);

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

  const renderTreeNodes = (nodes: TreeNode[], depth = 0): React.ReactNode => {
    return nodes.map(node => {
      if (node.type === 'dir') {
        const isExpanded = expandedFolders[node.path] !== false;
        return (
          <div key={node.path} className="space-y-0.5">
            <button
              type="button"
              onClick={() => {
                playClickSound();
                setExpandedFolders(prev => ({
                  ...prev,
                  [node.path]: prev[node.path] === undefined ? false : !prev[node.path]
                }));
              }}
              style={{ paddingLeft: `${depth * 12 + 6}px` }}
              className="w-full text-left py-1 pr-2 flex items-center justify-between text-xs font-mono text-black hover:bg-[#ece9d8] transition-colors"
            >
              <span className="flex items-center gap-1.5 truncate">
                {isExpanded ? <ChevronDown size={12} className="text-gray-600 shrink-0" /> : <ChevronRight size={12} className="text-gray-600 shrink-0" />}
                {isExpanded ? <FolderOpen size={14} className="text-yellow-600 shrink-0" /> : <Folder size={14} className="text-yellow-600 shrink-0" />}
                <span className="truncate font-bold">{node.name}</span>
              </span>
            </button>
            {isExpanded && node.children.length > 0 && (
              <div>
                {renderTreeNodes(node.children, depth + 1)}
              </div>
            )}
          </div>
        );
      }

      const isFileActive = activeFile?.name === node.path;
      return (
        <button
          key={node.path}
          type="button"
          onClick={() => {
            playClickSound();
            setActiveFile({ name: node.path, type: 'file', size: node.size, content: node.content });
          }}
          style={{ paddingLeft: `${depth * 12 + 18}px` }}
          className={`w-full text-left py-1 pr-2 flex items-center justify-between text-xs font-mono transition-colors ${
            isFileActive
              ? 'bg-[#000080] text-white font-bold'
              : 'text-black hover:bg-[#ece9d8]'
          }`}
        >
          <span className="flex items-center gap-1.5 truncate">
            <FileText size={14} className={isFileActive ? 'text-white shrink-0' : 'text-gray-600 shrink-0'} />
            <span className="truncate">{node.name}</span>
          </span>
          {node.size && <span className="text-[10px] opacity-75 shrink-0 ml-1">{node.size}</span>}
        </button>
      );
    });
  };

  return (
    <div className="flex flex-col h-full bg-[#c0c0c0] text-black font-tahoma text-xs overflow-hidden select-none">
      <div className="bg-[#c0c0c0] border-b border-[#808080] px-3 py-2 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <div 
            onClick={() => { playClickSound(); setSearchQuery(''); }}
            className="win95-btn px-2.5 py-1 flex items-center gap-1.5 font-bold cursor-pointer bg-[#dfdfdf] hover:bg-white text-black"
          >
            <Code size={16} className="text-blue-800" />
            <span className="font-bold text-black text-sm tracking-wide font-mono">GITSMITH</span>
            <span className="bg-blue-800 text-white text-[10px] font-mono px-1.5 py-0.5 rounded font-bold">FORGE</span>
          </div>
          <span className="text-gray-600 font-mono text-[11px] hidden sm:inline flex items-center gap-1.5">
            <Globe size={13} className="text-blue-700" />
            <span>Git repositories · Push &amp; clone over SSH</span>
          </span>
        </div>

        <div className="flex items-center gap-2.5 text-xs font-mono">
          <button
            onClick={() => {
              if (!user) return openAuthModal('login');
              if (!gatewayReady) return showAlert('Repository creation is unavailable while the forge is offline.', 'Forge Unavailable', 'error');
              setShowCreateRepo(true);
            }}
            disabled={Boolean(user) && !gatewayReady}
            className="win95-btn px-2.5 py-1 text-black font-bold flex items-center gap-1 text-[11px] bg-[#dfdfdf] hover:bg-white disabled:opacity-50"
          >
            <Plus size={14} /> New Repository
          </button>
        </div>
      </div>

      {showCreateRepo && (
        <form onSubmit={handleCreateRepository} className="bg-[#ece9d8] border-b border-[#808080] p-3 flex items-end gap-3 flex-wrap">
          <div className="flex-1 min-w-[220px]">
            <label htmlFor="gitsmith-repo-slug" className="block text-[11px] text-gray-800 font-bold mb-1">Repository slug</label>
            <input
              id="gitsmith-repo-slug"
              value={newRepoSlug}
              onChange={event => setNewRepoSlug(event.target.value.toLowerCase())}
              placeholder="my-shareware-app"
              pattern="[a-z0-9][a-z0-9._-]*"
              maxLength={100}
              required
              className="win95-field bg-white text-black px-2 py-1 text-xs font-mono w-full focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="gitsmith-repo-visibility" className="block text-[11px] text-gray-800 font-bold mb-1">Visibility</label>
            <select
              id="gitsmith-repo-visibility"
              value={newRepoVisibility}
              onChange={event => setNewRepoVisibility(event.target.value as typeof newRepoVisibility)}
              className="win95-field bg-white text-black px-2 py-1 text-xs"
            >
              <option value="public">Public</option>
              <option value="unlisted">Unlisted</option>
              <option value="private">Private</option>
            </select>
          </div>
          <button disabled={isCreatingRepo} className="win95-btn bg-[#dfdfdf] hover:bg-white text-black font-bold px-3 py-1.5 text-xs disabled:opacity-50">
            {isCreatingRepo ? 'Queuing…' : 'Create & Provision'}
          </button>
          <button type="button" onClick={() => setShowCreateRepo(false)} className="win95-btn p-1 text-black hover:bg-[#dfdfdf]" aria-label="Close repository form">
            <X size={16} />
          </button>
          <p className="basis-full text-[11px] text-gray-600">Repositories are created immediately. Git objects and refs become active as soon as you push your first commit.</p>
        </form>
      )}

      {showingShowcases ? (
        <div className="bg-[#fff3cd] border-b border-[#ffeeba] text-[#856404] px-3 py-1.5 text-[11px] flex items-center justify-between font-mono">
          <span>SHOWCASE MODE — Viewing bundled offline repositories. Real push/pull operations require live forge repositories.</span>
          <button
            type="button"
            onClick={() => {
              setShowBundledExamples(false);
              setSelectedRepo(canonicalRepositories.length > 0 ? canonicalRepositories[0] : null);
            }}
            className="win95-btn px-2 py-0.5 text-[10px] text-black underline ml-3 shrink-0"
          >
            Close Demo Gallery
          </button>
        </div>
      ) : canonicalRepositories.length > 0 ? null : (
        canonicalLoadState === 'loading' ? (
          <div className="bg-[#ece9d8] border-b border-[#808080] text-gray-700 px-3 py-1 text-[11px] font-mono">
            LOADING FORGE…
          </div>
        ) : null
      )}
      <div className="flex-1 flex overflow-hidden">
        <div 
          style={{ width: `${sidebarWidth}px`, minWidth: '220px', maxWidth: '520px' }}
          className="border-r border-[#808080] bg-[#ece9d8] flex flex-col overflow-hidden shrink-0"
        >
          <div className="p-2 border-b border-[#808080] bg-[#c0c0c0]">
            <div className="relative">
              <Search size={14} className="absolute left-2 top-2 text-gray-500" />
              <input
                type="text"
                placeholder="Find a repository or maker..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="win95-field bg-white text-black w-full px-2 py-1 pl-7 text-xs placeholder-gray-500 focus:outline-none"
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-gray-700 mt-2 px-1 font-mono">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => { playClickSound(); setFilterMine(false); }}
                  className={`px-2 py-0.5 text-[10px] font-bold transition-colors win95-btn ${
                    !filterMine
                      ? 'bg-white text-blue-900 border-2'
                      : 'bg-[#c0c0c0] text-gray-700 hover:bg-[#dfdfdf]'
                  }`}
                >
                  All ({repositoryCatalog.length})
                </button>
                {user?.username && (
                  <button
                    type="button"
                    onClick={() => { playClickSound(); setFilterMine(true); }}
                    className={`px-2 py-0.5 text-[10px] font-bold transition-colors win95-btn ${
                      filterMine
                        ? 'bg-white text-emerald-800 border-2'
                        : 'bg-[#c0c0c0] text-gray-700 hover:bg-[#dfdfdf]'
                    }`}
                  >
                    Mine ({repositoryCatalog.filter(r => r.owner === user.username).length})
                  </button>
                )}
              </div>
              <span className={showingShowcases ? 'text-amber-800 font-bold' : canonicalLoadState === 'error' ? 'text-red-800 font-bold' : 'text-emerald-800 font-bold'}>
                {showingShowcases ? 'Demo Gallery' : canonicalLoadState === 'error' ? 'Offline' : 'Live'}
              </span>
            </div>
          </div>

          <Win95Scroll className="flex-1 divide-y divide-[#d0d0d0] bg-white win95-field">
            {repositoryCatalog.length === 0 && canonicalLoadState !== 'loading' && (
              <div className="p-4 space-y-3 text-gray-700">
                <p className="font-bold text-black text-xs">No repositories to show.</p>
                <button
                  type="button"
                  onClick={() => {
                    setShowBundledExamples(true);
                    setSelectedRepo(GITSMITH_REPOS[0]);
                    setActiveFile(GITSMITH_REPOS[0].files.find(file => file.type === 'file') || GITSMITH_REPOS[0].files[0]);
                  }}
                  className="win95-btn w-full bg-[#dfdfdf] hover:bg-white text-black px-2 py-2 text-[11px] font-bold whitespace-normal break-words"
                >
                  Open Demo Gallery
                </button>
              </div>
            )}
            {filterMine && user?.username && filteredRepos.length === 0 && repositoryCatalog.length > 0 && (
              <div className="p-4 text-center space-y-2 text-gray-600">
                <p className="font-bold text-black text-xs">No repositories owned by @{user.username}</p>
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
                    setActiveFile(repo.source === 'showcase' ? (repo.files.find(f => f.type === 'file') || repo.files[0] || null) : null);
                  }}
                  className={`p-3 cursor-pointer transition-all ${
                    isSelected
                      ? 'bg-[#000080] text-white'
                      : 'hover:bg-[#f0f0f0] text-black'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2 font-bold text-sm">
                      <span className="text-base">{repo.avatar}</span>
                      <span className={isSelected ? 'text-white' : 'text-blue-900'}>{repo.owner}/{repo.name}</span>
                      {isOwner && (
                        <span className={`text-[10px] font-mono px-1.5 py-0.5 border font-bold ${
                          isSelected ? 'bg-emerald-900 text-emerald-100 border-emerald-400' : 'bg-emerald-100 text-emerald-800 border-emerald-600'
                        }`}>
                          you
                        </span>
                      )}
                    </div>
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                      isSelected ? 'bg-[#000060] text-white border-blue-400' : 'bg-[#ece9d8] text-gray-700 border-[#808080]'
                    }`}>
                      {repo.branch}
                    </span>
                  </div>

                  <p className={`text-xs line-clamp-2 mb-2 leading-relaxed ${isSelected ? 'text-gray-200' : 'text-gray-600'}`}>
                    {repo.description}
                  </p>

                  <div className={`flex items-center gap-3 text-[11px] font-mono ${isSelected ? 'text-gray-200' : 'text-gray-500'}`}>
                    <span className="flex items-center gap-1"><CircleDot size={11} className={isSelected ? 'text-amber-300' : 'text-amber-600'} /> {repo.language ? repo.language.split('/')[0] : 'unknown'}</span>
                    <span className="flex items-center gap-1"><Star size={11} className={isSelected ? 'text-yellow-300' : 'text-yellow-600'} /> {repo.stars ?? 'not tracked'}</span>
                    <span className="flex items-center gap-1"><GitFork size={11} className={isSelected ? 'text-blue-200' : 'text-blue-700'} /> {repo.forks ?? 'not synced'}</span>
                  </div>
                </div>
              );
            })}
          </Win95Scroll>
        </div>

        <div
          onMouseDown={startResizeSidebar}
          className="w-1.5 hover:w-2 bg-[#808080] hover:bg-[#000080] cursor-col-resize flex items-center justify-center transition-all z-20 select-none group"
          title="Drag to resize repository sidebar"
        >
          <GripVertical size={10} className="text-white group-hover:text-yellow-200" />
        </div>

        <div className="flex-1 flex flex-col bg-[#ece9d8] overflow-y-auto p-3 space-y-3 min-w-0">
          {!selectedRepo || repositoryCatalog.length === 0 ? (
            <div className="m-auto max-w-xl border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] bg-[#c0c0c0] p-6 text-center shadow">
              <Code size={36} className="mx-auto mb-3 text-blue-800" />
              <h1 className="text-lg font-bold text-black">
                {canonicalLoadState === 'loading'
                  ? 'Loading the forge…'
                  : canonicalLoadState === 'error'
                    ? 'Forge Unavailable'
                    : 'Start with a repository'}
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-gray-700">
                {canonicalLoadState === 'error'
                  ? "Couldn't reach the forge. Retry before creating, cloning, or forking anything."
                  : canonicalLoadState === 'loading'
                    ? 'Connecting to the forge before enabling repository actions.'
                    : 'Create a repository to start hosting your code, then push from your local checkout.'}
              </p>
              {canonicalLoadState === 'error' && (
                <div className="mt-4 flex items-center justify-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => {
                      playClickSound();
                      void refreshCanonicalRepositories();
                    }}
                    className="win95-btn btn-w95-primary px-4 py-1.5 text-xs font-bold flex items-center gap-1.5"
                  >
                    <RefreshCw size={12} />
                    <span>Retry</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      playClickSound();
                      setShowBundledExamples(true);
                      setSelectedRepo(GITSMITH_REPOS[0]);
                      setActiveFile(GITSMITH_REPOS[0].files.find(file => file.type === 'file') || GITSMITH_REPOS[0].files[0]);
                    }}
                    className="win95-btn px-4 py-1.5 text-xs font-bold bg-[#dfdfdf] hover:bg-white text-black"
                  >
                    Open Demo Gallery
                  </button>
                </div>
              )}
            </div>
          ) : (<>
          <div className="bg-[#c0c0c0] border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] p-3 shadow-sm">
            <div className="flex items-start justify-between flex-wrap gap-3 mb-3">
              <div>
                <div className="flex items-center gap-2.5 mb-1.5 flex-wrap">
                  <span className="text-2xl">{selectedRepo.avatar}</span>
                  <h1 className="text-xl font-bold text-black flex items-center gap-1.5 font-mono">
                    <span className="text-gray-700 font-normal">{selectedRepo.owner}</span>
                    <span className="text-gray-400">/</span>
                    <span className="text-blue-900 font-black">{selectedRepo.name}</span>
                  </h1>
                  <span className="win95-field bg-white text-gray-800 text-[10px] font-bold px-2 py-0.5">
                    {selectedRepo.visibility}
                  </span>
                  {user?.username && selectedRepo.owner === user.username && (
                    <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 border border-emerald-600">
                      Owned by you
                    </span>
                  )}
                  <span className={`${
                    selectedRepo.source === 'showcase'
                      ? 'bg-amber-100 text-amber-800 border-amber-600'
                      : selectedRepo.status === 'active' && selectedRepo.lastCommit.sha !== 'No projected ref'
                        ? 'bg-emerald-100 text-emerald-800 border-emerald-600'
                        : 'bg-amber-100 text-amber-800 border-amber-600'
                  } text-[10px] font-bold px-2 py-0.5 border`}>
                    {selectedRepo.source === 'canonical'
                      ? (selectedRepo.status === 'provisioning'
                          ? 'Provisioning'
                          : selectedRepo.lastCommit.sha === 'No projected ref'
                            ? 'Source not pushed'
                            : 'Active')
                      : 'Demo Showcase'}
                  </span>
                </div>
                <p className="text-xs text-gray-800 max-w-3xl leading-relaxed">
                  {selectedRepo.description}
                </p>
              </div>

              <div className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-2 flex-wrap">
                  {selectedRepo.liveUrl && <a
                    href={selectedRepo.liveUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => playClickSound()}
                    className="win95-btn bg-[#dfdfdf] hover:bg-white text-black px-3 py-1 font-bold text-xs flex items-center gap-1.5"
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
                    className="win95-btn bg-[#dfdfdf] hover:bg-white text-black font-bold px-3 py-1 text-xs flex items-center gap-1.5"
                    title="Fork into isolated worktree with Claude Code / AGY / Cursor"
                  >
                    <Bot size={14} className="text-blue-900" />
                    <span>⚡ Fork with AI</span>
                    <span className="win95-field bg-white px-1.5 py-0.5 text-[10px] text-gray-800 font-mono">{selectedRepo.forks ?? 'local'}</span>
                  </button>

                  <button
                    onClick={() => {
                      handleCopyClone(selectedRepo);
                    }}
                    className="win95-btn bg-[#dfdfdf] hover:bg-white text-black px-3 py-1 text-xs font-bold flex items-center gap-1.5"
                    title="Copy SLOP install command"
                  >
                    {copiedClone ? <Check size={13} className="text-emerald-700" /> : <Copy size={13} />}
                    <span>{copiedClone ? 'Install copied!' : 'Install'}</span>
                  </button>
                </div>
                <div className="text-[11px] font-mono text-gray-600 flex items-center gap-1">
                  <span>your fork &rarr;</span>
                  <span className="text-emerald-800 font-bold">
                    @{user?.username || 'you'}/{selectedRepo.name}
                  </span>
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-[#808080] flex items-center justify-between text-xs text-gray-800 flex-wrap gap-2 font-mono">
              <div className="flex items-center gap-4">
                <span className="win95-field bg-white px-2 py-0.5 text-blue-900 font-bold flex items-center gap-1.5">
                  <GitBranch size={13} /> {selectedRepo.branch}
                </span>
                <span>Storage: <strong className="text-emerald-800 font-semibold">{selectedRepo.sqlitePath}</strong></span>
                <span>License: <strong className="text-black">{selectedRepo.license}</strong></span>
              </div>

              <div className="win95-field bg-white px-2 py-0.5 text-gray-700 flex items-center gap-2">
                <Clock size={13} className="text-gray-500" />
                <span className="text-gray-600">
                  {selectedRepo.source === 'canonical' ? 'Authoritative ref:' : 'Bundled snapshot:'}
                </span>
                <span className="text-blue-900 font-bold">{selectedRepo.lastCommit.sha}</span>
                <span className="text-black">"{selectedRepo.lastCommit.message}"</span>
                <span className="bg-[#ece9d8] text-gray-700 font-mono text-[10px] px-1.5 py-0.5 font-bold border border-[#808080]">
                  {selectedRepo.source === 'canonical'
                    ? (selectedRepo.lastCommit.sha === 'No projected ref' ? 'NO REF PROJECTED' : 'D1 PROJECTION')
                    : 'DEMO ONLY'}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 border-b border-[#808080] select-none pt-1">
            <button
              onClick={() => { playClickSound(); setActiveTab('code'); }}
              className={`win95-btn px-3 py-1 font-bold text-xs flex items-center gap-1.5 ${
                activeTab === 'code'
                  ? 'bg-white text-blue-900 border-2'
                  : 'bg-[#c0c0c0] text-gray-700 hover:bg-[#dfdfdf]'
              }`}
            >
              <Code size={14} /> Code &amp; Files
            </button>
            <button
              onClick={() => { playClickSound(); setActiveTab('commits'); }}
              className={`win95-btn px-3 py-1 font-bold text-xs flex items-center gap-1.5 ${
                activeTab === 'commits'
                  ? 'bg-white text-blue-900 border-2'
                  : 'bg-[#c0c0c0] text-gray-700 hover:bg-[#dfdfdf]'
              }`}
            >
              <Clock size={14} /> Commit Log &amp; CAS Reflog
            </button>
            <button
              onClick={() => { playClickSound(); setActiveTab('lineage'); }}
              className={`win95-btn px-3 py-1 font-bold text-xs flex items-center gap-1.5 ${
                activeTab === 'lineage'
                  ? 'bg-white text-blue-900 border-2'
                  : 'bg-[#c0c0c0] text-gray-700 hover:bg-[#dfdfdf]'
              }`}
            >
              <Sparkles size={14} /> Royalty Settlement
            </button>
          </div>

          {activeTab === 'code' && (
            <div className="border-2 border-t-[#808080] border-l-[#808080] border-b-white border-r-white bg-[#c0c0c0] flex flex-col flex-1 min-h-[420px]">
              <div className="bg-[#c0c0c0] border-b border-[#808080] px-3 py-1.5 flex items-center justify-between font-mono text-xs text-black">
                <div className="flex items-center gap-2 text-black font-bold">
                  <FileCode size={15} className="text-blue-800" />
                  <span>{selectedRepo.name}</span>
                  <span className="text-gray-400">/</span>
                  <span className="text-blue-900">{activeFile?.name || (displayedFiles[0]?.name || 'README.md')}</span>
                </div>
                <div className="flex items-center gap-3">
                  {fileContent !== null && (
                    <span className="text-gray-600 text-[11px]">
                      {codeLines.length} lines · {activeFile?.size || 'Raw UTF-8'}
                    </span>
                  )}
                  <button
                    onClick={handleCopyCode}
                    disabled={!fileContent}
                    className="win95-btn px-2 py-0.5 text-[11px] bg-[#dfdfdf] hover:bg-white text-black flex items-center gap-1 font-mono disabled:opacity-40"
                  >
                    {copiedCode ? <Check size={11} className="text-emerald-700" /> : <Copy size={11} />}
                    <span>{copiedCode ? 'Copied' : 'Copy Code'}</span>
                  </button>
                </div>
              </div>

              <div className="flex flex-1 overflow-hidden">
                <Win95Scroll
                  style={{ width: `${fileTreeWidth}px`, minWidth: '160px', maxWidth: '460px' }}
                  className="bg-white win95-field p-2 space-y-0.5 shrink-0"
                >
                  <div className="text-[10px] font-bold text-gray-600 uppercase px-2 py-1 tracking-wider font-mono">
                    Repository Files
                  </div>
                  {selectedRepo?.source !== 'showcase' && repoTreeLoading && (
                    <div className="px-2 py-1.5 text-[11px] text-gray-600 font-mono">Loading tree…</div>
                  )}
                  {selectedRepo?.source !== 'showcase' && !repoTreeLoading && repoTreeError && (
                    <div className="px-2 py-1.5 text-[11px] text-red-700 font-mono leading-relaxed">{repoTreeError}</div>
                  )}
                  {renderTreeNodes(fileTree)}
                </Win95Scroll>

                <div
                  onMouseDown={startResizeFileTree}
                  className="w-1.5 hover:w-2 bg-[#808080] hover:bg-[#000080] cursor-col-resize flex items-center justify-center transition-all z-20 select-none group"
                  title="Drag to resize file tree panel"
                >
                  <GripVertical size={10} className="text-white group-hover:text-yellow-200" />
                </div>

                {fileLoading ? (
                  <div className="flex-1 bg-white win95-field p-6 font-mono text-xs text-gray-600 flex items-center justify-center">
                    <div className="flex items-center gap-2">
                      <Clock size={16} className="animate-spin text-blue-800" />
                      <span>Loading file from repository…</span>
                    </div>
                  </div>
                ) : fileError ? (
                  <div className="flex-1 bg-white win95-field p-6 font-mono text-xs overflow-auto flex items-start">
                    <div className="max-w-xl p-4 bg-[#f8d7da] border border-[#f5c6cb] rounded text-[#721c24] space-y-2">
                      <div className="font-bold flex items-center gap-2 text-[#721c24] text-sm">
                        <X size={16} className="text-[#721c24]" />
                        <span>File Read Unavailable</span>
                      </div>
                      <p className="text-xs leading-relaxed text-[#721c24]">{fileError}</p>
                      <p className="text-[11px] text-red-900/80">Authoritative Git storage is queried via /api/repo-file. No synthetic fallback is generated.</p>
                    </div>
                  </div>
                ) : fileContent !== null ? (
                  <div className="flex-1 bg-white win95-field p-3 font-mono text-xs overflow-auto text-black flex min-w-0">
                    <div className="select-none text-gray-400 text-right pr-3 border-r border-[#d0d0d0] font-mono space-y-0.5 shrink-0 bg-[#f8f8f8]">
                      {codeLines.map((_: string, i: number) => (
                        <div key={i} className="leading-relaxed">{i + 1}</div>
                      ))}
                    </div>

                    <div className="pl-3 flex-1 space-y-0.5 overflow-x-auto select-text font-mono text-black">
                      {codeLines.map((line: string, i: number) => (
                        <div key={i} className="leading-relaxed whitespace-pre font-mono">
                          {line || ' '}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 bg-white win95-field p-6 font-mono text-xs text-gray-500 flex items-center justify-center">
                    <span>Select a file from the repository to view its contents.</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'commits' && (
            <div className="border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] bg-[#c0c0c0] p-3 space-y-2 shadow-sm">
              <div className="font-mono text-xs font-bold text-black mb-2 flex items-center justify-between">
                <span>{selectedRepo.source === 'canonical' ? 'Canonical Default-Ref Projection' : 'Bundled Commit Snapshot'}</span>
                <span className={`text-xs font-normal ${selectedRepo.source === 'canonical' ? 'text-emerald-800 font-bold' : 'text-amber-800 font-bold'}`}>
                  {selectedRepo.source === 'canonical' ? selectedRepo.branch : 'Not a canonical gateway reflog'}
                </span>
              </div>

              <div className="space-y-2 font-mono text-xs">
                <div className="win95-field bg-white p-3 flex items-center justify-between">
                  <div>
                    <div className="text-black font-bold text-sm">{selectedRepo.lastCommit.message}</div>
                    <div className="text-gray-600 text-xs mt-1">
                      Authored by <strong className="text-blue-900">@{selectedRepo.lastCommit.author}</strong> ({selectedRepo.lastCommit.time})
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="win95-btn px-2 py-0.5 text-blue-900 font-mono font-bold text-xs bg-[#dfdfdf]">
                      {selectedRepo.lastCommit.sha}
                    </span>
                    <span className="bg-[#ece9d8] text-gray-700 px-2 py-0.5 rounded border border-[#808080] font-bold text-[10px]">
                      {selectedRepo.source === 'canonical' ? 'D1 PROJECTION' : 'UNVERIFIED SNAPSHOT'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'lineage' && (
            <div className="border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] bg-[#c0c0c0] p-3 space-y-3 shadow-sm">
              <div className="flex items-center justify-between border-b border-[#808080] pb-2 text-black">
                <div>
                  <h3 className="font-bold text-sm text-black">Platform Fee / Frozen Ancestor Royalty Settlement</h3>
                  <p className="text-xs text-gray-600">Mathematical splits automatically credited upon license purchase or fork fee.</p>
                </div>
                <span className="bg-[#ece9d8] text-gray-800 border border-[#808080] px-2 py-0.5 text-xs font-mono font-bold">
                  Immutable Protocol Rule
                </span>
              </div>

              <div className="grid grid-cols-3 gap-3 font-mono text-xs">
                <div className="win95-field bg-white p-3">
                  <div className="text-gray-600 mb-1 font-bold text-xs">Root Release</div>
                  <div className="text-xl font-black text-emerald-800">90% / 10%</div>
                  <div className="text-[11px] text-gray-600 mt-1">No ancestor claim: maker keeps 90%, platform takes 10%.</div>
                </div>
                <div className="win95-field bg-white p-3">
                  <div className="text-gray-600 mb-1 font-bold text-xs">Downstream Release</div>
                  <div className="text-xl font-black text-blue-900">10% + royalty + rest</div>
                  <div className="text-[11px] text-gray-600 mt-1">Platform's flat 10% / each upstream maker's frozen royalty / seller keeps the rest.</div>
                </div>
                <div className="win95-field bg-white p-3">
                  <div className="text-gray-600 mb-1 font-bold text-xs">Selected Repository</div>
                  <div className="text-lg font-black text-amber-800">No sale projection loaded</div>
                  <div className="text-[11px] text-gray-600 mt-1">A purchase-time lineage snapshot is required before showing exact allocations.</div>
                </div>
              </div>
            </div>
          )}
          </>)}
        </div>
      </div>
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
