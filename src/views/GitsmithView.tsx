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
  liveAppUrl?: string;
  files: { name: string; type: 'file' | 'dir'; size?: string; content?: string }[];
}

export const GITSMITH_REPOS: GitsmithRepo[] = [
  {
    id: 'dronehunter',
    name: 'dronehunter',
    owner: 'nate',
    avatar: '🎯',
    description: 'Fast-paced retro browser shooter inspired by Duck Hunt. Double-barrel shotgun, laughing dog animations, drone explosions, and local SQLite high score telemetry in WAL mode.',
    stars: 420,
    forks: 88,
    language: 'TypeScript / Pixel Art Engine',
    license: 'MIT Sovereign Shareware',
    sqlitePath: '/data/dronehunter.sqlite (WAL mode)',
    branch: 'main',
    lastCommit: {
      sha: '5cdee6f',
      message: 'feat(arcade): Duck Hunt style shotgun shooter with SQLite WAL high scores',
      author: 'nate',
      time: '12 mins ago',
      verified: true
    },
    tags: ['Arcade', 'Retro', 'Duck Hunt', 'SQLite WAL', 'Web Audio'],
    liveUrl: 'https://dronehunter.pages.dev',
    liveAppUrl: 'https://dronehunter.pages.dev',
    files: [
      { name: 'assets', type: 'dir' },
      { name: 'migrations', type: 'dir' },
      { name: 'migrations/001_initial_scores.sql', type: 'file', size: '580 B', content: `CREATE TABLE IF NOT EXISTS high_scores (\n  id TEXT PRIMARY KEY,\n  player_name TEXT NOT NULL,\n  score INTEGER NOT NULL,\n  drones_shot INTEGER NOT NULL,\n  recorded_at INTEGER NOT NULL\n);` },
      { name: 'index.html', type: 'file', size: '42.3 KB', content: `<!doctype html>\n<html>...Duck Hunt Arcade Engine...</html>` },
      { name: 'package.json', type: 'file', size: '740 B', content: `{\n  "name": "dronehunter",\n  "version": "1.0.0"\n}` },
      { name: 'slop.config.json', type: 'file', size: '410 B', content: `{\n  "appId": "dronehunter",\n  "sqlite": "/data/dronehunter.sqlite",\n  "memoryCapMb": 256\n}` },
      { name: 'README.md', type: 'file', size: '2.8 KB', content: `# DroneHunter 95\n\nRetro Duck Hunt arcade shooter.` }
    ]
  },
  {
    id: 'certified-mailer',
    name: 'certified-mailer',
    owner: 'nate',
    avatar: '📫',
    description: 'Private legal dispute and operational correspondence engine. Renders manifests to flattened high-DPI PDFs, tracks Electronic Return Receipts (ERR), and connects to LetterStream / Lob APIs.',
    stars: 312,
    forks: 46,
    language: 'Python 3.12 / CLI',
    license: 'MIT Sovereign Legal Tool',
    sqlitePath: '/data/certified-mailer.sqlite (WAL mode)',
    branch: 'main',
    lastCommit: {
      sha: '9f0412b',
      message: 'feat(mail): PDF flattening and Electronic Return Receipt (ERR) pipeline',
      author: 'nate',
      time: '35 mins ago',
      verified: true
    },
    tags: ['Legal', 'USPS', 'Postal', 'Dispute', 'SQLite WAL'],
    liveUrl: 'https://certified-mailer.pages.dev',
    liveAppUrl: 'https://certified-mailer.pages.dev',
    files: [
      { name: 'src', type: 'dir' },
      { name: 'tools', type: 'dir' },
      { name: 'tools/flatten_pdf.py', type: 'file', size: '1.8 KB', content: `import fitz\n# Flatten verified PDF pages to 300 DPI pixels` },
      { name: 'pyproject.toml', type: 'file', size: '590 B', content: `[project]\nname = "certified-mailer"` },
      { name: 'slop.config.json', type: 'file', size: '480 B', content: `{\n  "appId": "certified-mailer",\n  "sqlite": "/data/certified-mailer.sqlite"\n}` },
      { name: 'README.md', type: 'file', size: '3.1 KB', content: `# Certified Mailer\n\nPrivate operational-mail tooling.` }
    ]
  },
  {
    id: 'picfitai',
    name: 'picfitai',
    owner: 'nate',
    avatar: '✨',
    description: 'AI Virtual Try-On Studio & Outfit Synthesis Engine powered by Google Gemini Vision with sovereign single-file SQLite user credits ledger.',
    stars: 284,
    forks: 62,
    language: 'Google Gemini Vision / PHP',
    license: 'MIT AI Studio Tool',
    sqlitePath: '/data/picfitai.sqlite (WAL mode)',
    branch: 'main',
    lastCommit: {
      sha: '4d88e01',
      message: 'feat(gemini): 4K virtual try-on neural diffusion rendering pipeline',
      author: 'nate',
      time: '1h ago',
      verified: true
    },
    tags: ['AI', 'Fashion', 'Gemini', 'Try-On', 'SQLite WAL'],
    liveUrl: 'https://picfitai.pages.dev',
    liveAppUrl: 'https://picfitai.pages.dev',
    files: [
      { name: 'images', type: 'dir' },
      { name: 'includes', type: 'dir' },
      { name: 'includes/AIService.php', type: 'file', size: '14.2 KB', content: `<?php\nclass AIService { ... }` },
      { name: 'slop.config.json', type: 'file', size: '490 B', content: `{\n  "appId": "picfitai",\n  "sqlite": "/data/picfitai.sqlite"\n}` },
      { name: 'README.md', type: 'file', size: '5.5 KB', content: `# PicFit.ai\n\nAI Virtual Try-On Studio.` }
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
    const url = `git clone ssh://git@git.nates-software.com:2222/${repo.owner}/${repo.name}.git`;
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
