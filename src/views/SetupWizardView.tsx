import React, { useState } from 'react';
import { Sparkles, Terminal, ArrowRight, Check, Copy, ShieldCheck, ExternalLink, Play, Bot } from 'lucide-react';
import { playClickSound, playSuccessChime } from '../lib/soundEngine';
import { useAuth } from '../context/AuthContext';
import { useAlert } from '../context/AlertContext';

interface StarterApp {
  id: string;
  name: string;
  avatar: string;
  tagline: string;
  price: string;
  category: string;
  suggestedPrompt: string;
}

const STARTERS: StarterApp[] = [
  {
    id: 'dronehunter',
    name: 'DroneHunter 95',
    avatar: '🎯',
    tagline: 'Retro Duck Hunt Arcade Shooter with WebAssembly SQLite High Scores & Audio Synthesis.',
    price: '$15.00',
    category: 'Arcade WASM Game',
    suggestedPrompt: 'Add dual-wield laser shotguns and a new boss wave telemetry table in SQLite.'
  },
  {
    id: 'certified-mailer',
    name: 'Certified Mailer',
    avatar: '📫',
    tagline: 'USPS Certified Mail, Electronic Return Receipt (ERR) & 300 DPI Legal Dispute Engine.',
    price: '$25.00',
    category: 'Legal / SaaS Utility',
    suggestedPrompt: 'Add California Tenant Security Deposit statutory demand templates and CSV batch export.'
  },
  {
    id: 'picfitai',
    name: 'PicFit.ai',
    avatar: '✨',
    tagline: 'AI Virtual Try-On Studio & Outfit Synthesis Engine with Gemini Vision 2.5.',
    price: '$20.00',
    category: 'AI Vision Studio',
    suggestedPrompt: 'Add custom streetwear wardrobe racks and high-resolution lookbook PDF exports.'
  }
];

export interface SetupWizardViewProps {
  onOpenSandbox?: (appId: string) => void;
  onOpenTerminal?: (initialCmd?: string) => void;
  onOpenForge?: (repoId: string) => void;
}

export const SetupWizardView: React.FC<SetupWizardViewProps> = ({
  onOpenSandbox,
  onOpenTerminal,
  onOpenForge
}) => {
  const { user } = useAuth();
  const { showAlert } = useAlert();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedStarter, setSelectedStarter] = useState<StarterApp>(STARTERS[0]);
  const [makerHandle, setMakerHandle] = useState<string>(user?.username || 'josh');
  const [activeTool, setActiveTool] = useState<'claude' | 'agy' | 'cursor' | 'terminal'>('claude');
  const [copiedCmd, setCopiedCmd] = useState(false);

  const worktreeId = `slop-${selectedStarter.id}-${makerHandle}`;
  const repoUrl = `https://github.com/natemcguire/${selectedStarter.id}.git`;

  const getCommandForTool = () => {
    switch (activeTool) {
      case 'claude':
        return `git clone ${repoUrl} /tmp/${worktreeId} && cd /tmp/${worktreeId} && claude "${selectedStarter.suggestedPrompt}"`;
      case 'agy':
        return `git clone ${repoUrl} /tmp/${worktreeId} && cd /tmp/${worktreeId} && agy "${selectedStarter.suggestedPrompt}"`;
      case 'cursor':
        return `git clone ${repoUrl} /tmp/${worktreeId} && cd /tmp/${worktreeId} && cursor .`;
      case 'terminal':
        return `slop fork nate/${selectedStarter.id}`;
    }
  };

  const handleCopyCommand = () => {
    playSuccessChime();
    navigator.clipboard.writeText(getCommandForTool());
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2000);
    showAlert("Agent 1-Liner command copied to clipboard! Paste into your terminal to start coding immediately.", "Command Copied", "success");
  };

  return (
    <div className="h-full flex flex-col bg-[#ece9d8] font-tahoma text-xs overflow-hidden select-none">
      {/* Wizard Header Banner */}
      <div className="bg-gradient-to-r from-blue-900 via-indigo-900 to-blue-950 text-white p-3 border-b-2 border-gray-600 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-white/10 rounded flex items-center justify-center border border-white/20 text-base">
            🚀
          </div>
          <div>
            <div className="font-bold text-sm">NATE'S SOFTWARE SETUP WIZARD — QUICKSTART 95</div>
            <div className="text-[11px] text-blue-200 font-mono">1-Click Fork &amp; Shareware Launchpad</div>
          </div>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center gap-1 font-mono text-[11px]">
          <span className={`px-2 py-0.5 rounded border ${step === 1 ? 'bg-amber-400 text-black font-bold border-amber-500' : 'bg-blue-950 text-gray-400 border-blue-800'}`}>
            1. Starter
          </span>
          <span className="text-gray-500">&rarr;</span>
          <span className={`px-2 py-0.5 rounded border ${step === 2 ? 'bg-amber-400 text-black font-bold border-amber-500' : 'bg-blue-950 text-gray-400 border-blue-800'}`}>
            2. Launch Agent
          </span>
          <span className="text-gray-500">&rarr;</span>
          <span className={`px-2 py-0.5 rounded border ${step === 3 ? 'bg-amber-400 text-black font-bold border-amber-500' : 'bg-blue-950 text-gray-400 border-blue-800'}`}>
            3. Earn &amp; Deploy
          </span>
        </div>
      </div>

      {/* Main Content Body */}
      <div className="flex-1 p-4 overflow-y-auto bg-w95-gray flex flex-col justify-between">
        {step === 1 && (
          <div className="space-y-4 max-w-2xl mx-auto w-full">
            <div className="bg-white border-2 border-t-black border-l-black border-b-white border-r-white p-3 space-y-1">
              <div className="font-bold text-sm text-blue-950 flex items-center gap-1.5">
                <Sparkles size={14} className="text-amber-500" />
                <span>Step 1: Choose a Local-First Starter App to Fork</span>
              </div>
              <p className="text-gray-600 text-xs">
                Pick one of Nate's 3 flagship shareware apps. Each comes with single-file SQLite storage (WAL mode) and automated 70/20/10 royalty lineage.
              </p>
            </div>

            {/* Starters Grid */}
            <div className="space-y-2">
              {STARTERS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => { playClickSound(); setSelectedStarter(s); }}
                  className={`w-full text-left p-3 border-2 flex items-center justify-between transition-all ${
                    selectedStarter.id === s.id
                      ? 'bg-blue-50 border-t-black border-l-black border-b-white border-r-white shadow-inner font-bold'
                      : 'bg-white border-t-white border-l-white border-b-black border-r-black hover:bg-gray-100'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-3xl bg-white p-1 rounded border border-gray-300">{s.avatar}</span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-gray-900">{s.name}</span>
                        <span className="bg-blue-100 text-blue-800 text-[10px] font-mono px-1.5 py-0.5 rounded font-bold">
                          {s.category}
                        </span>
                      </div>
                      <div className="text-gray-600 text-xs mt-0.5 line-clamp-1">{s.tagline}</div>
                    </div>
                  </div>

                  <div className="text-right font-mono shrink-0 pl-2">
                    <div className="text-xs font-bold text-green-800">{s.price}</div>
                    <div className="text-[10px] text-gray-500">70% to you on sale</div>
                  </div>
                </button>
              ))}
            </div>

            {/* Maker Handle Input */}
            <div className="bg-white border-2 border-t-black border-l-black border-b-white border-r-white p-3 flex items-center justify-between gap-3 font-mono">
              <div>
                <label className="block text-gray-800 font-bold text-xs">Your Maker Handle:</label>
                <div className="text-gray-500 text-[11px]">Identifies your fork in the Lineage DAG and directs your 70% payouts.</div>
              </div>
              <div className="flex items-center bg-gray-100 border border-gray-400 px-2 py-1 rounded">
                <span className="text-gray-500 font-bold">@</span>
                <input
                  type="text"
                  value={makerHandle}
                  onChange={(e) => setMakerHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                  className="bg-transparent font-bold text-blue-900 text-xs outline-none w-28"
                  placeholder="yourname"
                />
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4 max-w-2xl mx-auto w-full">
            <div className="bg-white border-2 border-t-black border-l-black border-b-white border-r-white p-3 space-y-1">
              <div className="font-bold text-sm text-blue-950 flex items-center gap-1.5">
                <Bot size={15} className="text-purple-600" />
                <span>Step 2: Launch Your AI Agent or IDE</span>
              </div>
              <p className="text-gray-600 text-xs">
                Select your preferred developer tool. Copy the 1-liner to clone <strong>{selectedStarter.name}</strong> into an isolated worktree and start building with your AI agent immediately.
              </p>
            </div>

            {/* Tool Tabs */}
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
                  className={`px-3 py-1 text-xs font-bold border-t border-l border-r rounded-t flex items-center gap-1 ${
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

            {/* Command Box */}
            <div className="bg-slate-950 text-slate-100 p-3 rounded border-2 border-slate-800 font-mono text-xs space-y-2">
              <div className="flex items-center justify-between text-slate-400 text-[11px] border-b border-slate-800 pb-1">
                <span>Terminal 1-Liner ({worktreeId})</span>
                <span className="text-emerald-400">Single-file SQLite WAL</span>
              </div>

              <div className="text-emerald-300 whitespace-pre-wrap break-all leading-relaxed py-1 bg-black/50 p-2 rounded border border-slate-800 select-text">
                {getCommandForTool()}
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-slate-500 text-[10px]">
                  Suggested goal: "{selectedStarter.suggestedPrompt}"
                </span>
                <button
                  onClick={handleCopyCommand}
                  className="bg-emerald-800 hover:bg-emerald-700 text-white px-3 py-1 rounded text-xs font-bold flex items-center gap-1 shadow-sm"
                >
                  {copiedCmd ? <Check size={12} /> : <Copy size={12} />}
                  <span>{copiedCmd ? 'Copied!' : 'Copy 1-Liner'}</span>
                </button>
              </div>
            </div>

            {/* In-Browser Web Terminal Direct Button */}
            {onOpenTerminal && (
              <div className="bg-green-50 border border-green-300 p-3 rounded flex items-center justify-between">
                <div>
                  <div className="font-bold text-green-950 text-xs">Run inside Web OS right now?</div>
                  <div className="text-gray-600 text-[11px]">Open TERMINAL.EXE and run <code className="text-blue-900 font-bold">slop fork nate/{selectedStarter.id}</code> automatically.</div>
                </div>
                <button
                  onClick={() => {
                    playSuccessChime();
                    onOpenTerminal(`slop fork nate/${selectedStarter.id}`);
                  }}
                  className="btn-w95 btn-w95-primary px-4 py-1.5 font-bold text-xs flex items-center gap-1.5"
                >
                  <Terminal size={13} />
                  <span>Launch in Web Terminal</span>
                </button>
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4 max-w-2xl mx-auto w-full">
            <div className="bg-white border-2 border-t-black border-l-black border-b-white border-r-white p-3 space-y-1 text-center">
              <div className="text-3xl">🎉</div>
              <div className="font-bold text-base text-gray-900">Your Local-First Fork is Ready!</div>
              <p className="text-gray-600 text-xs">
                You now have an isolated development worktree for <strong>{selectedStarter.name}</strong> under <strong>@{makerHandle}</strong>.
              </p>
            </div>

            {/* Economic Split Card */}
            <div className="bg-gradient-to-r from-blue-950 via-slate-900 to-blue-950 text-white p-4 rounded border border-blue-700 shadow font-mono text-xs space-y-2">
              <div className="font-bold text-amber-400 flex items-center gap-1.5 text-xs">
                <ShieldCheck size={14} />
                <span>Your Guaranteed Lineage Royalty Contract:</span>
              </div>
              <div className="flex justify-between border-b border-blue-900 pb-1 text-gray-300">
                <span>⚡ Fork Maker (@{makerHandle}):</span>
                <span className="font-bold text-emerald-400">70% ($10.50 / $15 sale)</span>
              </div>
              <div className="flex justify-between border-b border-blue-900 pb-1 text-gray-300">
                <span>💎 Root Ancestor (@nate):</span>
                <span className="font-bold text-blue-300">20% ($3.00 / $15 sale)</span>
              </div>
              <div className="flex justify-between text-gray-300">
                <span>🛡️ Protocol Liquidity Pool:</span>
                <span className="font-bold text-purple-300">10% ($1.50 / $15 sale)</span>
              </div>
            </div>

            {/* Next Steps Quick Action Buttons */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2">
              {onOpenSandbox && (
                <button
                  onClick={() => {
                    playSuccessChime();
                    onOpenSandbox(selectedStarter.id);
                  }}
                  className="btn-w95 btn-w95-primary p-3 font-bold text-xs flex items-center justify-center gap-2 shadow"
                >
                  <Play size={14} />
                  <span>Play / Test in Live Sandbox</span>
                </button>
              )}

              {onOpenForge && (
                <button
                  onClick={() => {
                    playClickSound();
                    onOpenForge(selectedStarter.id);
                  }}
                  className="btn-w95 p-3 font-bold text-xs flex items-center justify-center gap-2"
                >
                  <ExternalLink size={13} />
                  <span>Inspect Code on GITSMITH Forge</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Bottom Wizard Navigation Footer */}
        <div className="flex items-center justify-between border-t border-gray-400 pt-3 mt-4">
          {step > 1 ? (
            <button
              onClick={() => { playClickSound(); setStep((prev) => (prev - 1) as any); }}
              className="btn-w95 px-4 py-1 font-bold text-xs"
            >
              &larr; Back
            </button>
          ) : (
            <div />
          )}

          {step < 3 ? (
            <button
              onClick={() => {
                playClickSound();
                setStep((prev) => (prev + 1) as any);
              }}
              className="btn-w95 btn-w95-primary px-6 py-1.5 font-bold text-xs flex items-center gap-1.5"
            >
              <span>Continue</span>
              <ArrowRight size={13} />
            </button>
          ) : (
            <button
              onClick={() => {
                playSuccessChime();
                if (onOpenSandbox) onOpenSandbox(selectedStarter.id);
              }}
              className="btn-w95 btn-w95-primary px-6 py-1.5 font-bold text-xs"
            >
              Finish &amp; Start Building
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
