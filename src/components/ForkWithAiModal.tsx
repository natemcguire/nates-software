import React, { useState } from 'react';
import { Bot, Copy, Check, Sparkles } from 'lucide-react';
import { playClickSound, playSuccessChime } from '../lib/soundEngine';
import { useAuth } from '../context/AuthContext';
import { useAlert } from '../context/AlertContext';

export interface ForkWithAiModalProps {
  isOpen: boolean;
  onClose: () => void;
  app: {
    id: string;
    name: string;
    version: string;
    author?: string;
    creator?: string;
    avatar?: string;
    creatorAvatar?: string;
    authorAvatar?: string;
    price?: string | number;
  };
  onLaunchTerminal?: (cmd: string) => void;
}

const PROMPT_PRESETS: Record<string, string[]> = {
  dronehunter: [
    'Add dual-wield laser shotguns and a new boss wave telemetry table.',
    'Add laughing retro dog animations on missed shots with 8-bit Web Audio synthesis.',
    'Add local multiplayer high-score tournaments with custom player initials.'
  ],
  'certified-mailer': [
    'Add California Tenant Security Deposit statutory demand templates and CSV batch export.',
    'Integrate official 20-digit USPS Certified Mail barcode generation and Electronic Return Receipt (ERR).',
    'Add automated postal dispatch failover with idempotency tokens and PDF receipt archiving.'
  ],
  picfitai: [
    'Add custom streetwear wardrobe racks and high-resolution lookbook PDF exports.',
    'Refactor the outfit synthesis pipeline to call Google Gemini 2.5 Flash Vision API with realistic fabric drape.',
    'Add single-file SQLite user credit ledger in WAL mode with Stripe webhook signature validation.'
  ]
};

export const ForkWithAiModal: React.FC<ForkWithAiModalProps> = ({
  isOpen,
  onClose,
  app,
  onLaunchTerminal
}) => {
  const { user } = useAuth();
  const { showAlert } = useAlert();

  const makerHandle = user?.username || 'josh';
  const suggestedPrompts = PROMPT_PRESETS[app.id] || [
    `Implement new Local-First features and persist data in /data/${app.id}.sqlite (WAL mode).`
  ];

  const [customPrompt, setCustomPrompt] = useState(suggestedPrompts[0]);
  const [activeTool, setActiveTool] = useState<'claude' | 'agy' | 'cursor' | 'terminal'>('claude');
  const [copiedCmd, setCopiedCmd] = useState(false);

  if (!isOpen) return null;

  const getCommandForTool = () => {
    return `slop fork nate/${app.id}`;
  };

  const handleCopyCommand = () => {
    playSuccessChime();
    navigator.clipboard.writeText(getCommandForTool());
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2000);
    showAlert("Install command copied. When the fork is ready, SLOP will ask which LLM or IDE to start—nothing launches automatically.", "Install Command Copied", "success");
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-xs select-none p-4 font-tahoma text-xs">
      <div className="w-full max-w-xl bg-w95-gray border-2 border-t-white border-l-white border-b-black border-r-black shadow-2xl p-1">
        {/* Title Bar */}
        <div className="bg-[#000080] text-white px-2 py-1 flex items-center justify-between font-bold text-xs">
          <div className="flex items-center gap-1.5">
            <Bot size={13} className="text-yellow-300" />
            <span>1-CLICK FORK &amp; CODE WITH AI — {app.name}</span>
          </div>
          <button
            onClick={() => { playClickSound(); onClose(); }}
            className="w-4 h-4 bg-w95-gray border border-t-white border-l-white border-b-black border-r-black text-black font-bold flex items-center justify-center text-[10px] hover:bg-red-700 hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="p-4 bg-w95-gray space-y-3">
          {/* Header Metadata */}
          <div className="bg-white border-2 border-t-black border-l-black border-b-white border-r-white p-3 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="text-3xl bg-gray-50 p-1 rounded border border-gray-300">
                {app.creatorAvatar || app.authorAvatar || '🎯'}
              </span>
              <div>
                <div className="font-bold text-sm text-gray-900">{app.name}</div>
                <div className="text-gray-500 text-[11px] font-mono">
                  Base: @{app.author || app.creator || 'nate'} &rarr; Fork: @{makerHandle}
                </div>
              </div>
            </div>

            <div className="text-right font-mono text-[11px]">
              <div className="text-emerald-800 font-bold">70% Maker Royalty</div>
              <div className="text-gray-500">{app.id === 'dronehunter' ? 'Local-First (Storage Freedom)' : `/data/${app.id}.sqlite (WAL)`}</div>
            </div>
          </div>

          {/* Goal / Prompt Selector */}
          <div>
            <label className="block text-gray-800 font-bold mb-1">Select AI Coding Goal or Prompt:</label>
            <div className="space-y-1">
              {suggestedPrompts.map((p, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    playClickSound();
                    setCustomPrompt(p);
                  }}
                  className={`w-full text-left p-2 border flex items-center gap-2 text-xs transition-colors ${
                    customPrompt === p
                      ? 'bg-blue-50 border-2 border-t-black border-l-black border-b-white border-r-white font-bold text-blue-900 shadow-inner'
                      : 'bg-white border-t-white border-l-white border-b-black border-r-black hover:bg-gray-100 text-gray-800'
                  }`}
                >
                  <Sparkles size={12} className="text-amber-500 shrink-0" />
                  <span className="line-clamp-1">{p}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Tool Tabs */}
          <div className="space-y-1">
            <div className="flex gap-1 border-b border-gray-400 pb-1">
              {[
                { id: 'claude', name: 'Claude Code', icon: '🟣' },
                { id: 'agy', name: 'Antigravity (AGY)', icon: '⚡' },
                { id: 'cursor', name: 'Cursor / VS Code', icon: '🧠' },
                { id: 'terminal', name: 'SLOP CLI', icon: '💻' }
              ].map((t) => (
                <button
                  key={t.id}
                  onClick={() => { playClickSound(); setActiveTool(t.id as any); }}
                  className={`px-2.5 py-1 text-xs font-bold border-t border-l border-r rounded-t flex items-center gap-1 ${
                    activeTool === t.id
                      ? 'bg-slate-900 text-cyan-300 border-slate-700'
                      : 'bg-w95-gray text-gray-700 border-gray-400 hover:bg-gray-200'
                  }`}
                >
                  <span>{t.icon}</span>
                  <span>{t.name}</span>
                </button>
              ))}
            </div>

            {/* Terminal Command Output */}
            <div className="bg-slate-950 text-slate-100 p-2.5 rounded border-2 border-slate-800 font-mono text-xs space-y-2">
              <div className="text-emerald-300 whitespace-pre-wrap break-all leading-relaxed bg-black/60 p-2 rounded border border-slate-800 select-text">
                {getCommandForTool()}
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-slate-500 text-[10px]">
                  Installs first, then prompts to start {activeTool === 'terminal' ? 'an engine later' : activeTool === 'agy' ? 'AGY' : activeTool === 'claude' ? 'Claude Code' : 'Cursor'}.
                </span>
                <button
                  onClick={handleCopyCommand}
                  className="bg-emerald-800 hover:bg-emerald-700 text-white px-3 py-1 rounded text-xs font-bold flex items-center gap-1 shadow-sm"
                >
                  {copiedCmd ? <Check size={12} /> : <Copy size={12} />}
                  <span>{copiedCmd ? 'Copied!' : 'Copy Install Command'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Action Buttons Footer */}
          <div className="flex items-center justify-between pt-2 border-t border-gray-300 flex-wrap gap-2">
            <button
              onClick={() => { playClickSound(); onClose(); }}
              className="btn-w95 px-4 py-1 text-xs"
            >
              Cancel
            </button>

            <div className="flex items-center gap-2">
              {onLaunchTerminal && <span className="text-[10px] text-gray-600 max-w-48">Use a native terminal with Git and Node installed. TERMINAL.EXE is a browser command console, not a host shell.</span>}

              <button
                onClick={handleCopyCommand}
                className="btn-w95 btn-w95-primary px-4 py-1.5 font-bold text-xs flex items-center gap-1.5 shadow"
              >
                <Bot size={13} />
                <span>Install, Then Choose Engine</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
