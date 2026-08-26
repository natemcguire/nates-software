import React, { useState } from 'react';
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
  FileText
} from 'lucide-react';
import { playClickSound } from '../lib/soundEngine';

export interface GitsmithRepo {
  id: string;
  name: string;
  owner: string;
  avatar: string;
  description: string;
  stars: number;
  forks: number;
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
  liveUrl: string;
  files: { name: string; type: 'file' | 'dir'; size?: string; content?: string }[];
}

export const GITSMITH_REPOS: GitsmithRepo[] = [
  {
    id: 'wallart',
    name: 'wallart',
    owner: 'nate',
    avatar: '⚡',
    description: 'AI photo-to-canvas rendering engine, multi-panel gallery wall previewer, and custom print layout studio (300 DPI export).',
    stars: 384,
    forks: 112,
    language: 'TypeScript / React 19',
    license: 'MIT (Sovereign Shareware)',
    sqlitePath: '/data/wallart.sqlite (WAL mode)',
    branch: 'main',
    lastCommit: {
      sha: '5c030af',
      message: 'feat(canvas): optimize 3D matrix triptych splitter & color profiles',
      author: 'nate',
      time: '12 mins ago',
      verified: true
    },
    tags: ['Photo Studio', 'Canvas Prints', 'Gallery Wall', 'Next.js 16', 'SQLite WAL'],
    liveUrl: 'https://nates-software.pages.dev/?app=wallart',
    files: [
      { name: 'src', type: 'dir' },
      { name: 'migrations', type: 'dir' },
      { name: 'package.json', type: 'file', size: '1.2 KB', content: `{\n  "name": "wallart-canvas-pro",\n  "version": "2.4.0",\n  "private": true,\n  "dependencies": {\n    "react": "^19.0.0",\n    "canvas": "^2.11.2",\n    "better-sqlite3": "^11.8.1"\n  }\n}` },
      { name: 'slop.config.json', type: 'file', size: '420 B', content: `{\n  "appId": "wallart",\n  "name": "WallArt Canvas Pro",\n  "sqlite": "/data/wallart.sqlite",\n  "memoryCapMb": 256\n}` },
      { name: 'README.md', type: 'file', size: '2.8 KB', content: `# WallArt Canvas Pro\n\nSovereign 3D wall art studio with local SQLite persistence.\n\n## Clone\n\`\`\`bash\nslop fork nate/wallart\n\`\`\`` }
    ]
  },
  {
    id: 'dronehunter',
    name: 'dronehunter',
    owner: 'nate',
    avatar: '🎯',
    description: 'Tactical 360° radar sweep HUD & anti-drone battery with real-time intercept telemetry logging to SQLite in WAL mode.',
    stars: 128,
    forks: 34,
    language: 'TypeScript / HTML5 Canvas',
    license: 'MIT (Sovereign Shareware)',
    sqlitePath: '/data/dronehunter.sqlite (WAL mode)',
    branch: 'main',
    lastCommit: {
      sha: '9f4a10c',
      message: 'feat(radar): add AN/MPQ-64 Sentinel sweep HUD and EMP fire controls',
      author: 'nate',
      time: '3 mins ago',
      verified: true
    },
    tags: ['Arcade', 'Radar', 'Defense', 'SQLite WAL', 'Metal Shaders'],
    liveUrl: 'https://nates-software.pages.dev/?app=dronehunter',
    files: [
      { name: 'src', type: 'dir' },
      { name: 'migrations', type: 'dir' },
      { name: 'migrations/001_initial_scores.sql', type: 'file', size: '580 B', content: `CREATE TABLE IF NOT EXISTS radar_intercepts (\n  id TEXT PRIMARY KEY,\n  target_type TEXT NOT NULL,\n  azimuth REAL NOT NULL,\n  range_meters REAL NOT NULL,\n  confirmed_kill INTEGER NOT NULL DEFAULT 1,\n  intercept_timestamp INTEGER NOT NULL\n);` },
      { name: 'package.json', type: 'file', size: '890 B', content: `{\n  "name": "dronehunter-95",\n  "version": "1.0.0",\n  "scripts": {\n    "dev": "vite",\n    "build": "tsc && vite build"\n  }\n}` },
      { name: 'slop.config.json', type: 'file', size: '380 B', content: `{\n  "appId": "dronehunter",\n  "name": "DroneHunter 95",\n  "sqlite": "/data/dronehunter.sqlite",\n  "memoryCapMb": 256\n}` },
      { name: 'README.md', type: 'file', size: '1.9 KB', content: `# DroneHunter 95\n\nTactical Radar Interceptor & Anti-Drone Battery with SQLite Telemetry.\n\n## Play\n\`\`\`bash\nslop fork nate/dronehunter\n\`\`\`` }
    ]
  },
  {
    id: 'retro-calc',
    name: 'retro-calc',
    owner: 'sam',
    avatar: '👨‍💻',
    description: 'Local-first green-phosphor accounting calculator with double-entry compound ledgers and OCR receipt scanning.',
    stars: 248,
    forks: 84,
    language: 'React 19 / WASM',
    license: 'MIT (Sovereign Shareware)',
    sqlitePath: '/data/app.sqlite (WAL mode)',
    branch: 'main',
    lastCommit: {
      sha: '4a19e2b',
      message: 'feat(ocr): splice optical character recognition receipt parser into ledger',
      author: 'sam',
      time: '45 mins ago',
      verified: true
    },
    tags: ['Finance', 'SQLite', 'Local-First', 'React 19', 'Accounting'],
    liveUrl: 'https://nates-software.pages.dev/?app=retro-calc',
    files: [
      { name: 'src', type: 'dir' },
      { name: 'package.json', type: 'file', size: '940 B', content: `{\n  "name": "retro-calc",\n  "version": "1.2.0",\n  "dependencies": { "react": "^19.0.0" }\n}` },
      { name: 'README.md', type: 'file', size: '1.4 KB', content: `# RetroCalc Pro\n\nLocal-first compound accounting ledger.` }
    ]
  },
  {
    id: 'sailtrack',
    name: 'sailtrack',
    owner: 'nate',
    avatar: '⛵',
    description: 'Offline marine navigation, tactical regatta polar velocity solver, and race telemetry logger.',
    stars: 192,
    forks: 46,
    language: 'React 19 / NMEA 0183',
    license: 'Apache-2.0',
    sqlitePath: '/data/telemetry.sqlite (WAL mode)',
    branch: 'main',
    lastCommit: {
      sha: '3d81b90',
      message: 'feat(polar): optimize true wind speed angle curves and target VMG',
      author: 'nate',
      time: '2 hours ago',
      verified: true
    },
    tags: ['Marine', 'GPS', 'Mapping', 'Offline', 'Regatta'],
    liveUrl: 'https://nates-software.pages.dev/?app=sailtrack',
    files: [
      { name: 'src', type: 'dir' },
      { name: 'package.json', type: 'file', size: '1.1 KB', content: `{\n  "name": "sailtrack-gps",\n  "version": "2.1.0"\n}` },
      { name: 'README.md', type: 'file', size: '1.6 KB', content: `# SailTrack GPS\n\nTactical Regatta Telemetry HUD & Polar Speed Optimization.` }
    ]
  }
];

export const GitsmithView: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRepo, setSelectedRepo] = useState<GitsmithRepo>(GITSMITH_REPOS[0]);
  const [activeFile, setActiveFile] = useState<any>(GITSMITH_REPOS[0].files[2]);
  const [copiedClone, setCopiedClone] = useState(false);
  const [activeTab, setActiveTab] = useState<'repos' | 'code' | 'commits'>('repos');

  const filteredRepos = GITSMITH_REPOS.filter(repo => {
    const q = searchQuery.toLowerCase();
    const matchName = repo.name.toLowerCase().includes(q) || repo.owner.toLowerCase().includes(q);
    const matchDesc = repo.description.toLowerCase().includes(q);
    const matchTag = repo.tags.some(t => t.toLowerCase().includes(q));
    const matchLang = repo.language.toLowerCase().includes(q);
    return matchName || matchDesc || matchTag || matchLang;
  });

  const handleCopyClone = (repo: GitsmithRepo) => {
    playClickSound();
    const url = `git clone ssh://git@gitsmith.dev:2222/${repo.owner}/${repo.name}.git`;
    navigator.clipboard.writeText(url);
    setCopiedClone(true);
    setTimeout(() => setCopiedClone(false), 2000);
  };

  return (
    <div className="flex flex-col h-full bg-[#0d1117] text-[#c9d1d9] font-sans text-xs overflow-hidden">
      {/* GitHub / Gitsmith Top Forge Navigation Bar */}
      <div className="bg-[#161b22] border-b border-[#30363d] px-4 py-2.5 flex items-center justify-between flex-wrap gap-2 select-none">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-[#21262d] px-2.5 py-1 rounded-md border border-[#30363d]">
            <Code size={16} className="text-[#58a6ff]" />
            <span className="font-bold text-white text-sm tracking-wide">GITSMITH</span>
            <span className="bg-[#1f6feb] text-white text-[10px] font-mono px-1.5 py-0.2 rounded font-bold">FORGE</span>
          </div>
          <span className="text-[#8b949e] font-mono text-[11px] hidden sm:inline">
            ssh://git@gitsmith.dev · Ed25519 CAS Verification Active
          </span>
        </div>

        {/* Global Stats Banner */}
        <div className="flex items-center gap-3 text-[11px]">
          <div className="flex items-center gap-1.5 bg-[#21262d] px-2.5 py-1 rounded border border-[#30363d]">
            <ShieldCheck size={13} className="text-[#3fb950]" />
            <span className="text-white font-mono">SSH Verified (@nate)</span>
          </div>
          <div className="flex items-center gap-1.5 bg-[#21262d] px-2.5 py-1 rounded border border-[#30363d]">
            <Sparkles size={13} className="text-[#f0883e]" />
            <span className="text-white font-mono">70/20/10 Lineage Pool</span>
          </div>
        </div>
      </div>

      {/* Main Forge Body Grid */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Column: Repository Sidebar / List */}
        <div className="w-80 border-r border-[#30363d] bg-[#0d1117] flex flex-col overflow-hidden">
          {/* Search Header */}
          <div className="p-3 border-b border-[#30363d] bg-[#161b22]">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-2 text-[#8b949e]" />
              <input
                type="text"
                placeholder="Find a repository, tag, or maker..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#0d1117] border border-[#30363d] rounded px-2.5 py-1.5 pl-8 text-xs text-white placeholder-[#8b949e] focus:outline-none focus:border-[#58a6ff]"
              />
            </div>
            <div className="flex items-center justify-between text-[10px] text-[#8b949e] mt-2 px-0.5">
              <span>{filteredRepos.length} Repositories</span>
              <span className="text-[#58a6ff]">All Sovereign Bare Repos</span>
            </div>
          </div>

          {/* Repo List Items */}
          <div className="flex-1 overflow-y-auto divide-y divide-[#21262d]">
            {filteredRepos.map(repo => {
              const isSelected = selectedRepo.id === repo.id;
              return (
                <div
                  key={repo.id}
                  onClick={() => {
                    playClickSound();
                    setSelectedRepo(repo);
                    setActiveFile(repo.files[2] || repo.files[0]);
                  }}
                  className={`p-3 cursor-pointer transition-colors ${
                    isSelected ? 'bg-[#161b22] border-l-2 border-[#58a6ff]' : 'hover:bg-[#161b22]/50'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5 font-semibold text-sm">
                      <span>{repo.avatar}</span>
                      <span className="text-[#58a6ff] hover:underline">{repo.owner}/{repo.name}</span>
                    </div>
                    <span className="text-[10px] font-mono text-[#8b949e] bg-[#21262d] px-1.5 py-0.5 rounded border border-[#30363d]">
                      {repo.branch}
                    </span>
                  </div>

                  <p className="text-[#8b949e] text-[11px] line-clamp-2 mb-2 leading-relaxed">
                    {repo.description}
                  </p>

                  <div className="flex items-center gap-3 text-[10px] text-[#8b949e]">
                    <span className="flex items-center gap-1"><CircleDot size={10} className="text-[#f1e05a]" /> {repo.language.split('/')[0]}</span>
                    <span className="flex items-center gap-1"><Star size={10} /> {repo.stars}</span>
                    <span className="flex items-center gap-1"><GitFork size={10} /> {repo.forks}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Selected Repo Detail View (GitHub Style) */}
        <div className="flex-1 flex flex-col bg-[#0d1117] overflow-y-auto p-4">
          {/* Repo Title Header */}
          <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4 mb-4">
            <div className="flex items-start justify-between flex-wrap gap-3 mb-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-2xl">{selectedRepo.avatar}</span>
                  <h1 className="text-xl font-bold text-white flex items-center gap-1.5 font-mono">
                    <span className="text-[#8b949e] font-normal">{selectedRepo.owner}</span>
                    <span className="text-[#8b949e]">/</span>
                    <span className="text-[#58a6ff]">{selectedRepo.name}</span>
                  </h1>
                  <span className="bg-[#21262d] text-[#8b949e] text-[10px] font-bold px-2 py-0.5 rounded-full border border-[#30363d]">
                    Public
                  </span>
                  <span className="bg-[#238636]/20 text-[#3fb950] text-[10px] font-bold px-2 py-0.5 rounded-full border border-[#238636]/40">
                    Shareware Title
                  </span>
                </div>
                <p className="text-sm text-[#8b949e] max-w-3xl leading-relaxed">
                  {selectedRepo.description}
                </p>
              </div>

              {/* Action Buttons: Live App, Fork, Clone */}
              <div className="flex items-center gap-2 flex-wrap">
                <a
                  href={selectedRepo.liveUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => playClickSound()}
                  className="bg-[#238636] hover:bg-[#2ea043] text-white px-3 py-1.5 rounded-md font-semibold text-xs flex items-center gap-1.5 transition-colors shadow-sm"
                >
                  <Play size={13} fill="currentColor" />
                  <span>View Live App</span>
                  <ExternalLink size={11} />
                </a>

                <button
                  onClick={() => {
                    playClickSound();
                    window.open(`/?app=${selectedRepo.id}`, '_blank');
                  }}
                  className="bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9] border border-[#30363d] px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors"
                >
                  <GitFork size={13} className="text-[#58a6ff]" />
                  <span>Fork with SLOP</span>
                  <span className="bg-[#30363d] px-1.5 py-0.2 rounded text-[10px] text-[#8b949e]">{selectedRepo.forks}</span>
                </button>

                <button
                  onClick={() => handleCopyClone(selectedRepo)}
                  className="bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9] border border-[#30363d] px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors"
                  title="Copy git clone SSH command"
                >
                  {copiedClone ? <Check size={13} className="text-[#3fb950]" /> : <Copy size={13} />}
                  <span>{copiedClone ? 'Copied!' : 'Clone'}</span>
                </button>
              </div>
            </div>

            {/* Quick Meta Stats Bar */}
            <div className="pt-3 border-t border-[#30363d] flex items-center justify-between text-xs text-[#8b949e] flex-wrap gap-2">
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1 text-white font-mono">
                  <GitBranch size={13} className="text-[#58a6ff]" /> {selectedRepo.branch}
                </span>
                <span>Storage: <strong className="text-white font-mono">{selectedRepo.sqlitePath}</strong></span>
                <span>License: <strong className="text-white font-mono">{selectedRepo.license}</strong></span>
              </div>

              {/* Verified Commit Badge */}
              <div className="flex items-center gap-2 bg-[#21262d] px-2.5 py-1 rounded border border-[#30363d]">
                <Clock size={12} />
                <span>Latest Commit:</span>
                <span className="text-[#58a6ff] font-mono">{selectedRepo.lastCommit.sha}</span>
                <span className="text-white">"{selectedRepo.lastCommit.message}"</span>
                <span className="bg-[#238636]/20 text-[#3fb950] font-mono text-[9px] px-1.5 py-0.2 rounded font-bold border border-[#238636]/40">
                  Ed25519 Verified
                </span>
              </div>
            </div>
          </div>

          {/* Repo Navigation Tabs (Code, Commits) */}
          <div className="flex items-center gap-2 border-b border-[#30363d] mb-3 select-none">
            <button
              onClick={() => { playClickSound(); setActiveTab('repos'); }}
              className={`px-3 py-1.5 border-b-2 font-semibold text-xs flex items-center gap-1.5 ${
                activeTab === 'repos' ? 'border-[#f78166] text-white' : 'border-transparent text-[#8b949e] hover:text-[#c9d1d9]'
              }`}
            >
              <Code size={13} /> Code & Files
            </button>
            <button
              onClick={() => { playClickSound(); setActiveTab('commits'); }}
              className={`px-3 py-1.5 border-b-2 font-semibold text-xs flex items-center gap-1.5 ${
                activeTab === 'commits' ? 'border-[#f78166] text-white' : 'border-transparent text-[#8b949e] hover:text-[#c9d1d9]'
              }`}
            >
              <Clock size={13} /> Commit Log & CAS Reflog
            </button>
          </div>

          {/* Code Viewer Container */}
          {activeTab === 'repos' && (
            <div className="border border-[#30363d] rounded-lg overflow-hidden bg-[#161b22]">
              {/* File Tree Bar & File Name */}
              <div className="bg-[#21262d] px-3 py-2 border-b border-[#30363d] flex items-center justify-between">
                <div className="flex items-center gap-2 font-mono text-xs text-white">
                  <FileCode size={14} className="text-[#58a6ff]" />
                  <span>{selectedRepo.name} / {activeFile?.name || 'README.md'}</span>
                </div>
                <div className="text-[11px] text-[#8b949e] font-mono">
                  {activeFile?.size || 'Raw UTF-8'} · Lineage Depth 0
                </div>
              </div>

              <div className="flex flex-col md:flex-row">
                {/* File List */}
                <div className="w-full md:w-60 border-b md:border-b-0 md:border-r border-[#30363d] bg-[#0d1117] p-2 space-y-1">
                  <div className="text-[10px] font-bold text-[#8b949e] uppercase px-2 py-1 tracking-wider">Repository Files</div>
                  {selectedRepo.files.map((file, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        playClickSound();
                        if (file.content) setActiveFile(file);
                      }}
                      className={`w-full text-left px-2.5 py-1.5 rounded flex items-center justify-between text-xs font-mono transition-colors ${
                        activeFile?.name === file.name ? 'bg-[#1f6feb] text-white' : 'text-[#8b949e] hover:bg-[#161b22] hover:text-white'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        {file.type === 'dir' ? <Folder size={13} className="text-[#58a6ff]" /> : <FileText size={13} />}
                        {file.name}
                      </span>
                      {file.size && <span className="text-[10px] opacity-70">{file.size}</span>}
                    </button>
                  ))}
                </div>

                {/* Code Content View */}
                <div className="flex-1 p-4 font-mono text-xs bg-[#0d1117] text-[#c9d1d9] overflow-x-auto">
                  <pre className="leading-relaxed">
                    <code>{activeFile?.content || `# ${selectedRepo.name}\n\nSovereign repository running on GITSMITH bare forge.`}</code>
                  </pre>
                </div>
              </div>
            </div>
          )}

          {/* Commit Log Tab */}
          {activeTab === 'commits' && (
            <div className="border border-[#30363d] rounded-lg overflow-hidden bg-[#161b22] p-4 space-y-3">
              <div className="font-mono text-sm font-bold text-white mb-2">Immutable CAS Commit Ledger</div>
              <div className="space-y-2 font-mono text-xs">
                <div className="bg-[#0d1117] p-3 rounded border border-[#30363d] flex items-center justify-between">
                  <div>
                    <div className="text-white font-semibold">{selectedRepo.lastCommit.message}</div>
                    <div className="text-[#8b949e] text-[11px] mt-0.5">
                      Committed by @{selectedRepo.lastCommit.author} ({selectedRepo.lastCommit.time})
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="bg-[#21262d] text-[#58a6ff] px-2 py-1 rounded border border-[#30363d]">
                      commit {selectedRepo.lastCommit.sha}
                    </span>
                    <span className="bg-[#238636]/20 text-[#3fb950] px-2 py-1 rounded border border-[#238636]/40 font-bold text-[10px]">
                      VERIFIED
                    </span>
                  </div>
                </div>

                <div className="bg-[#0d1117] p-3 rounded border border-[#30363d] flex items-center justify-between opacity-80">
                  <div>
                    <div className="text-white font-semibold">chore(genesis): initial commit and single-file SQLite schema initialization</div>
                    <div className="text-[#8b949e] text-[11px] mt-0.5">
                      Committed by @{selectedRepo.owner} (Aug 24, 2026)
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="bg-[#21262d] text-[#8b949e] px-2 py-1 rounded border border-[#30363d]">
                      commit 1a04b8e
                    </span>
                    <span className="bg-[#238636]/20 text-[#3fb950] px-2 py-1 rounded border border-[#238636]/40 font-bold text-[10px]">
                      VERIFIED
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
