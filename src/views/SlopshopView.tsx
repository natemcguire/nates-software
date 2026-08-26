import React, { useState } from 'react';
import { INITIAL_APPS, AppListing } from '../data/mockData';
import {
  Wrench,
  Terminal,
  Folder,
  Copy,
  Check,
  Play,
  Sparkles,
  GitFork,
  Bot
} from 'lucide-react';
import { playClickSound, playSuccessChime } from '../lib/soundEngine';
import { useAlert } from '../context/AlertContext';

interface AgentModPreset {
  id: string;
  name: string;
  category: string;
  description: string;
  prompt: string;
}

const APP_MOD_PRESETS: Record<string, AgentModPreset[]> = {
  dronehunter: [
    {
      id: 'dh-radar',
      name: '🎯 AN/MPQ-64 Sentinel Radar Sweep HUD',
      category: 'Combat & Graphics',
      description: 'Add a 360-degree rotating phosphor radar sweep in the corner with tactical target intercepts.',
      prompt: 'Implement an AN/MPQ-64 Sentinel 360-degree rotating phosphor radar sweep HUD in the top-right corner of the canvas. Detect incoming drone vectors and render blinking target blips.'
    },
    {
      id: 'dh-multiplayer',
      name: '🏆 Multi-Player SQLite WAL High Scores',
      category: 'Database & Backend',
      description: 'Add persistent high scores with player initials, streak multipliers, and WAL mode concurrency.',
      prompt: 'Weld a high score leaderboard into the game using local SQLite WAL mode. Add player name input on game over, persist top 10 scores with accuracy percentages, and prevent lock contention.'
    },
    {
      id: 'dh-dog',
      name: '🐶 Classic Laughing Dog & Web Audio Pack',
      category: 'Sound FX & Sprites',
      description: 'Add retro pixel art dog animations holding shot drones and 8-bit shotgun audio synthesizer.',
      prompt: 'Inject retro 8-bit Duck Hunt laughing dog animations when missing shots, and triumphant celebration animations with synthesized 8-bit shotgun blast and reload audio using Web Audio API.'
    }
  ],
  'certified-mailer': [
    {
      id: 'cm-pdf',
      name: '📄 300 DPI High-Res PDF Flattener',
      category: 'Document Engine',
      description: 'Rasterize and flatten DOCX/PDF dispute letters into 300 DPI pixel-perfect pages to prevent postal distortions.',
      prompt: 'Add a PyMuPDF 300 DPI pixel flattening pipeline to rasterize generated DOCX and PDF dispute letters before dispatching to postal print queues.'
    },
    {
      id: 'cm-err',
      name: '📫 USPS Electronic Return Receipt (ERR)',
      category: 'Postal Integration',
      description: 'Generate authentic 20-digit USPS Certified Mail barcodes and digital signature capture hooks.',
      prompt: 'Integrate official 20-digit USPS Certified Mail barcode generation and Electronic Return Receipt (ERR) digital signature tracking hooks.'
    },
    {
      id: 'cm-lob',
      name: '⚡ Lob & LetterStream Dual Dispatch Failover',
      category: 'API Gateway',
      description: 'Multi-provider postal dispatch failover with automatic idempotency tokens and tracking receipts.',
      prompt: 'Implement a dual postal gateway supporting both LetterStream and Lob APIs with automated failover, idempotency tokens, and PDF receipt archiving.'
    }
  ],
  picfitai: [
    {
      id: 'pf-gemini',
      name: '✨ Google Gemini Vision Outfit Drape',
      category: 'AI Pipeline',
      description: 'Generate high-fidelity virtual try-on renders with boundary mask warping and fabric texture realism.',
      prompt: 'Refactor the outfit synthesis pipeline to call Google Gemini 1.5 Flash Vision API with realistic fabric drape, lighting matching, and boundary mask warping.'
    },
    {
      id: 'pf-credits',
      name: '💳 Stripe User Credits Ledger (SQLite WAL)',
      category: 'Monetization',
      description: 'Deduct generation credits in local SQLite database with webhook signature verification.',
      prompt: 'Weld a single-file SQLite user credit ledger in WAL mode with Stripe webhook signature validation and transactional credit deduction on generation.'
    },
    {
      id: 'pf-4k',
      name: '🖼️ 4K Ultra-HD Canvas PNG Exporter',
      category: 'Client Rendering',
      description: 'High-resolution client-side canvas render and lossless PNG export with EXIF metadata.',
      prompt: 'Add high-resolution 4K canvas export with client-side lossless PNG compression and watermark removal for Studio Pro subscribers.'
    }
  ]
};

export const SlopshopView: React.FC = () => {
  const { showAlert } = useAlert();
  const [selectedAppId, setSelectedAppId] = useState<string>('dronehunter');
  const [selectedAgent, setSelectedAgent] = useState<'claude' | 'agy' | 'aider' | 'cursor'>('claude');
  const [activePreset, setActivePreset] = useState<AgentModPreset>(APP_MOD_PRESETS['dronehunter'][0]);
  const [customPrompt, setCustomPrompt] = useState<string>(APP_MOD_PRESETS['dronehunter'][0].prompt);
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [copiedFork, setCopiedFork] = useState(false);

  const selectedApp = INITIAL_APPS.find(a => a.id === selectedAppId) || INITIAL_APPS[0];
  const presets = APP_MOD_PRESETS[selectedAppId] || APP_MOD_PRESETS['dronehunter'];

  const handleSelectApp = (app: AppListing) => {
    playClickSound();
    setSelectedAppId(app.id);
    const appPresets = APP_MOD_PRESETS[app.id] || APP_MOD_PRESETS['dronehunter'];
    setActivePreset(appPresets[0]);
    setCustomPrompt(appPresets[0].prompt);
  };

  const handleSelectPreset = (preset: AgentModPreset) => {
    playClickSound();
    setActivePreset(preset);
    setCustomPrompt(preset.prompt);
  };

  // Generate local agent launch command
  const getAgentCommand = () => {
    const escapedPrompt = customPrompt.replace(/"/g, '\\"');
    switch (selectedAgent) {
      case 'claude':
        return `claude "${escapedPrompt}"`;
      case 'agy':
        return `agy "${escapedPrompt}"`;
      case 'aider':
        return `aider --model sonnet --message "${escapedPrompt}"`;
      case 'cursor':
        return `cursor .`;
    }
  };

  const handleCopyAgentCmd = () => {
    playSuccessChime();
    const cmd = getAgentCommand();
    navigator.clipboard.writeText(cmd);
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2000);
    showAlert(
      `Command copied to clipboard:\n\n$ ${cmd}\n\nPaste into your terminal inside the worktree directory /tmp/slop-${selectedApp.id}!`,
      "Local Agent Launch Command Ready",
      "success"
    );
  };

  const handleCopyForkCmd = () => {
    playClickSound();
    const cmd = `slop fork ${selectedApp.author}/${selectedApp.id}`;
    navigator.clipboard.writeText(cmd);
    setCopiedFork(true);
    setTimeout(() => setCopiedFork(false), 2000);
  };

  return (
    <div className="flex flex-col h-full bg-[#0f172a] text-slate-200 font-sans text-xs overflow-hidden select-none">
      {/* Top Header Bar */}
      <div className="bg-[#1e293b] border-b border-slate-700 px-4 py-2.5 flex items-center justify-between flex-wrap gap-2 shadow-md">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-slate-900 px-3 py-1.5 rounded-md border border-slate-700 shadow-inner">
            <Wrench size={16} className="text-amber-400" />
            <span className="font-bold text-white text-sm tracking-wide font-mono">SLOPSHOP</span>
            <span className="bg-amber-600 text-white text-[10px] font-mono px-1.5 py-0.5 rounded font-bold">AGENT LAUNCHPAD</span>
          </div>
          <span className="text-slate-400 font-mono text-xs hidden sm:inline">
            Zero Hosted AI Models · Fork to Local Worktree &amp; Mod via Headless Claude / AGY / Codex
          </span>
        </div>

        {/* Local Sovereign Guarantee Pill */}
        <div className="flex items-center gap-2 text-xs font-mono">
          <span className="bg-slate-900 text-emerald-400 px-2.5 py-1 rounded border border-slate-700 flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>Local Metal Execution</span>
          </span>
        </div>
      </div>

      {/* Main 3-Column Studio Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Column: Sovereign Project Explorer */}
        <div className="w-72 border-r border-slate-700 bg-[#0f172a] flex flex-col overflow-hidden shrink-0">
          <div className="p-3 border-b border-slate-700 bg-[#1e293b] flex items-center justify-between">
            <span className="font-bold text-white text-xs font-mono flex items-center gap-1.5">
              <Folder size={14} className="text-sky-400" />
              <span>Sovereign Projects</span>
            </span>
            <span className="text-[10px] text-slate-400 font-mono">~/Projects/</span>
          </div>

          {/* Project List */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-800 p-2 space-y-1">
            {INITIAL_APPS.map(app => {
              const isSelected = selectedAppId === app.id;
              return (
                <button
                  key={app.id}
                  onClick={() => handleSelectApp(app)}
                  className={`w-full text-left p-3 rounded-md transition-all ${
                    isSelected
                      ? 'bg-slate-800 text-white border-l-4 border-amber-400 shadow-md'
                      : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-xs font-mono text-sky-300">{app.name}</span>
                    <span className="text-[10px] font-mono text-slate-400 bg-slate-900 px-1.5 py-0.5 rounded">
                      {app.version}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono truncate mb-1">
                    {app.sqliteDatabase}
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-slate-500 font-mono">
                    <span>{app.tags[0]}</span>
                    <span>·</span>
                    <span>{app.forkCount} forks</span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Active Worktree Status Footer */}
          <div className="p-3 border-t border-slate-700 bg-[#1e293b] space-y-1.5 font-mono text-[11px]">
            <div className="text-slate-400 flex items-center justify-between">
              <span>Worktree Path:</span>
              <span className="text-emerald-400 font-bold">Mounted</span>
            </div>
            <div className="bg-slate-900 p-1.5 rounded border border-slate-700 text-sky-300 text-[10px] truncate">
              /tmp/slop-{selectedApp.id}
            </div>
          </div>
        </div>

        {/* Center Column: Headless AI Agent Launchpad & Modding Goal */}
        <div className="flex-1 flex flex-col bg-[#0b1120] overflow-y-auto p-4 space-y-4 min-w-0">
          {/* Step 1: 1-Click Fork Box */}
          <div className="bg-[#1e293b] border border-slate-700 rounded-lg p-4 shadow-sm space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h2 className="text-sm font-bold text-white flex items-center gap-2 font-mono">
                  <GitFork size={15} className="text-sky-400" />
                  <span>Step 1: Fork into Local Worktree with SQLite Volume</span>
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Creates an isolated worktree with single-file SQLite volume mounted in WAL mode.
                </p>
              </div>
              <button
                onClick={handleCopyForkCmd}
                className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 px-3 py-1.5 rounded-md text-xs font-bold font-mono flex items-center gap-1.5 transition-colors shadow-sm"
              >
                {copiedFork ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                <span>{copiedFork ? 'Copied Fork Command!' : 'Copy Fork Command'}</span>
              </button>
            </div>

            <div className="bg-slate-950 p-2.5 rounded-md border border-slate-800 font-mono text-xs text-emerald-400 flex items-center justify-between">
              <code>$ slop fork {selectedApp.author}/{selectedApp.id}</code>
              <span className="text-[10px] text-slate-500 font-sans">Creates /tmp/slop-{selectedApp.id}</span>
            </div>
          </div>

          {/* Step 2: Pick Your Local Headless AI Coding Agent */}
          <div className="bg-[#1e293b] border border-slate-700 rounded-lg p-4 shadow-sm space-y-3">
            <div>
              <h2 className="text-sm font-bold text-white flex items-center gap-2 font-mono">
                <Bot size={15} className="text-amber-400" />
                <span>Step 2: Choose Your Local Headless AI Agent</span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                We do not host models. You run your own agent locally via your CLI of choice.
              </p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <button
                onClick={() => { playClickSound(); setSelectedAgent('claude'); }}
                className={`p-2.5 rounded-lg border text-left font-mono transition-all ${
                  selectedAgent === 'claude'
                    ? 'bg-purple-950/80 border-purple-500 text-white shadow-md'
                    : 'bg-slate-900/80 border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <div className="font-bold text-xs flex items-center gap-1.5 text-purple-300">
                  <span>🟣 Claude Code</span>
                </div>
                <div className="text-[10px] text-slate-400 mt-1">`claude "&lt;prompt&gt;"`</div>
              </button>

              <button
                onClick={() => { playClickSound(); setSelectedAgent('agy'); }}
                className={`p-2.5 rounded-lg border text-left font-mono transition-all ${
                  selectedAgent === 'agy'
                    ? 'bg-sky-950/80 border-sky-500 text-white shadow-md'
                    : 'bg-slate-900/80 border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <div className="font-bold text-xs flex items-center gap-1.5 text-sky-300">
                  <span>⚡ Antigravity (AGY)</span>
                </div>
                <div className="text-[10px] text-slate-400 mt-1">`agy "&lt;prompt&gt;"`</div>
              </button>

              <button
                onClick={() => { playClickSound(); setSelectedAgent('aider'); }}
                className={`p-2.5 rounded-lg border text-left font-mono transition-all ${
                  selectedAgent === 'aider'
                    ? 'bg-emerald-950/80 border-emerald-500 text-white shadow-md'
                    : 'bg-slate-900/80 border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <div className="font-bold text-xs flex items-center gap-1.5 text-emerald-300">
                  <span>🤖 Codex / Aider</span>
                </div>
                <div className="text-[10px] text-slate-400 mt-1">`aider --model sonnet`</div>
              </button>

              <button
                onClick={() => { playClickSound(); setSelectedAgent('cursor'); }}
                className={`p-2.5 rounded-lg border text-left font-mono transition-all ${
                  selectedAgent === 'cursor'
                    ? 'bg-amber-950/80 border-amber-500 text-white shadow-md'
                    : 'bg-slate-900/80 border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <div className="font-bold text-xs flex items-center gap-1.5 text-amber-300">
                  <span>🧠 Cursor / Grok</span>
                </div>
                <div className="text-[10px] text-slate-400 mt-1">`cursor .`</div>
              </button>
            </div>
          </div>

          {/* Step 3: Modding Goal & Agent Instruction Prompt */}
          <div className="bg-[#1e293b] border border-slate-700 rounded-lg p-4 shadow-sm space-y-3 flex-1 flex flex-col">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h2 className="text-sm font-bold text-white flex items-center gap-2 font-mono">
                  <Sparkles size={15} className="text-sky-400" />
                  <span>Step 3: Pick Feature Idea or Write Custom Prompt</span>
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Select a curated mod idea below or customize the exact prompt to send to your agent.
                </p>
              </div>
            </div>

            {/* Curated Preset Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {presets.map(preset => {
                const isPresetActive = activePreset.id === preset.id;
                return (
                  <button
                    key={preset.id}
                    onClick={() => handleSelectPreset(preset)}
                    className={`p-3 rounded-lg border text-left transition-all ${
                      isPresetActive
                        ? 'bg-slate-900 border-sky-400 text-white shadow'
                        : 'bg-slate-900/60 border-slate-700 text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <div className="font-bold text-xs font-mono text-sky-300 mb-1">{preset.name}</div>
                    <div className="text-[11px] text-slate-400 leading-relaxed line-clamp-2">{preset.description}</div>
                  </button>
                );
              })}
            </div>

            {/* Custom Instruction Prompt Textarea */}
            <div className="space-y-1.5 flex-1 flex flex-col">
              <label className="text-xs font-bold text-slate-300 font-mono flex items-center justify-between">
                <span>Agent Prompt Instructions:</span>
                <span className="text-[11px] text-slate-400 font-normal">Edit prompt freely</span>
              </label>
              <textarea
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                rows={3}
                className="w-full bg-slate-950 border border-slate-700 rounded-md p-3 text-xs text-slate-100 font-mono focus:outline-none focus:border-sky-400 shadow-inner resize-none leading-relaxed"
                placeholder="Enter instructions for your local AI coding agent..."
              />
            </div>

            {/* 1-Click Launch Action Bar */}
            <div className="pt-2 flex items-center justify-between flex-wrap gap-2 border-t border-slate-700">
              <div className="text-[11px] font-mono text-slate-400">
                Target: <strong className="text-sky-300">{selectedAgent.toUpperCase()} CLI</strong> on <strong className="text-white">~/Projects/slop-{selectedApp.id}</strong>
              </div>

              <button
                onClick={handleCopyAgentCmd}
                className="bg-amber-600 hover:bg-amber-500 text-white px-5 py-2 rounded-md font-bold text-xs font-mono flex items-center gap-2 transition-colors shadow-md"
              >
                {copiedCmd ? <Check size={14} className="text-white" /> : <Play size={14} fill="currentColor" />}
                <span>{copiedCmd ? 'Command Copied to Clipboard!' : '🚀 Copy Local Agent Launch Command'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Worktree Reflog & Lineage HUD */}
        <div className="w-80 border-l border-slate-700 bg-[#090d16] flex flex-col overflow-hidden shrink-0 font-mono text-xs">
          <div className="p-3 border-b border-slate-800 bg-[#121927] flex items-center justify-between">
            <span className="font-bold text-white text-xs flex items-center gap-1.5">
              <Terminal size={14} className="text-emerald-400" />
              <span>WORKTREE HUD</span>
            </span>
            <span className="text-[10px] text-slate-500">Scale-to-Zero</span>
          </div>

          <div className="flex-1 p-3 space-y-3 overflow-y-auto text-[11px] text-slate-300">
            <div className="bg-[#121927] p-2.5 rounded border border-slate-800 space-y-1">
              <div className="text-slate-400 text-[10px] uppercase font-bold tracking-wider">Local Worktree Directory</div>
              <div className="text-sky-400 truncate">/tmp/slop-{selectedApp.id}</div>
            </div>

            <div className="bg-[#121927] p-2.5 rounded border border-slate-800 space-y-1">
              <div className="text-slate-400 text-[10px] uppercase font-bold tracking-wider">Local SQLite Database</div>
              <div className="text-emerald-400 truncate">{selectedApp.sqliteDatabase}</div>
              <div className="text-[10px] text-slate-500">WAL Mode · Single-file journal</div>
            </div>

            <div className="bg-[#121927] p-2.5 rounded border border-slate-800 space-y-1">
              <div className="text-slate-400 text-[10px] uppercase font-bold tracking-wider">Step 4: Push Fork &amp; Settle Lineage</div>
              <p className="text-[10px] text-slate-400 leading-relaxed">
                When done making edits with your agent, run:
              </p>
              <div className="bg-slate-950 p-2 rounded text-amber-300 text-[10px] select-all">
                $ git push origin my-mod
              </div>
              <p className="text-[9px] text-slate-500 mt-1">
                ✔ 20% lineage royalty automatically settled to @{selectedApp.author}.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
