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
    tagline: 'Retro Duck Hunt arcade shooter with private, browser-local high scores and synthesized audio.',
    price: '$15.00',
    category: 'Arcade WASM Game',
    suggestedPrompt: 'Add dual-wield laser shotguns and a new boss wave telemetry table in SQLite.'
  },
  {
    id: 'certified-mailer',
    name: 'Certified Mailer',
    avatar: '📫',
    tagline: 'Local letter preparation and user-recorded mailing evidence journal.',
    price: '$25.00',
    category: 'Legal / SaaS Utility',
    suggestedPrompt: 'Add California Tenant Security Deposit statutory demand templates and CSV batch export.'
  },
  {
    id: 'wallart',
    name: 'WallArt Studio',
    avatar: '🖼️',
    tagline: 'Private multi-tenant photo-to-art studio with durable generation and print workflows.',
    price: '$59.00',
    category: 'Creative Studio',
    suggestedPrompt: 'Add a new art treatment while preserving tenant isolation and durable job semantics.'
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
  const [activeTool, setActiveTool] = useState<'claude' | 'agy' | 'cursor' | 'terminal'>('claude');
  const [copiedCmd, setCopiedCmd] = useState(false);

  const getCommandForTool = () => {
    return `slop fork nate/${selectedStarter.id}`;
  };

  const handleCopyCommand = () => {
    playSuccessChime();
    navigator.clipboard.writeText(getCommandForTool());
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2000);
    showAlert("Install command copied. SLOP installs the fork first, then asks which LLM or IDE to start.", "Install Command Copied", "success");
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
            3. Verify
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
                Pick one of Nate's 3 flagship shareware apps. Built with modular, runtime- and storage-independent architectures with automated 70/20/10 royalty lineage.
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
                    <div className="text-[10px] text-gray-500">Fork policy: 70% if sold</div>
                  </div>
                </button>
              ))}
            </div>

            {/* Identity boundary */}
            <div className="bg-white border-2 border-t-black border-l-black border-b-white border-r-white p-3 flex items-center justify-between gap-3 font-mono">
              <div>
                <div className="block text-gray-800 font-bold text-xs">Publishing Identity</div>
                <div className="text-gray-500 text-[11px]">The local CLI confirms your authenticated maker with <code>slop login</code> before anything can be published or sold.</div>
              </div>
              <div className="bg-gray-100 border border-gray-400 px-2 py-1 rounded text-blue-900 font-bold">
                {user ? `Web session: @${user.username}` : 'CLI login required'}
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4 max-w-2xl mx-auto w-full">
            <div className="bg-white border-2 border-t-black border-l-black border-b-white border-r-white p-3 space-y-1">
              <div className="font-bold text-sm text-blue-950 flex items-center gap-1.5">
                <Bot size={15} className="text-purple-600" />
                <span>Step 2: Install, Then Start Your Engines</span>
              </div>
              <p className="text-gray-600 text-xs">
                Copy the install command into a native terminal. After <strong>{selectedStarter.name}</strong> is fully installed, SLOP asks which LLM or IDE to launch. Choosing nothing leaves the ready fork untouched.
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
                  <span>Native Terminal Install</span>
                <span className="text-emerald-400">Runtime &amp; Storage Independent</span>
              </div>

              <div className="text-emerald-300 whitespace-pre-wrap break-all leading-relaxed py-1 bg-black/50 p-2 rounded border border-slate-800 select-text">
                {getCommandForTool()}
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-slate-500 text-[10px]">
                  Preferred engine: {activeTool === 'agy' ? 'AGY' : activeTool === 'claude' ? 'Claude Code' : activeTool === 'cursor' ? 'Cursor' : 'choose later'} — selected only after install
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

            {/* Browser terminal boundary */}
            {onOpenTerminal && (
              <div className="bg-amber-50 border border-amber-300 p-3 rounded flex items-center justify-between">
                <div>
                  <div className="font-bold text-amber-950 text-xs">Persistent or Disposable?</div>
                  <div className="text-gray-600 text-[11px]">Use your native terminal to keep the fork. TERMINAL.EXE can run the same command in a real ephemeral VM when commissioned, but its entire workspace is deleted when the session ends.</div>
                </div>
                <button
                  onClick={() => {
                    playClickSound();
                    onOpenTerminal();
                  }}
                  className="btn-w95 px-4 py-1.5 font-bold text-xs flex items-center gap-1.5"
                >
                  <Terminal size={13} />
                  <span>Try Ephemeral Terminal</span>
                </button>
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4 max-w-2xl mx-auto w-full">
            <div className="bg-white border-2 border-t-black border-l-black border-b-white border-r-white p-3 space-y-1 text-center">
              <div className="text-3xl">✅</div>
              <div className="font-bold text-base text-gray-900">Verify the Native Install</div>
              <p className="text-gray-600 text-xs">
                This website cannot inspect your native filesystem. Your fork exists only after SLOP prints a successful worktree path and its install checks pass.
              </p>
            </div>

            <div className="bg-black text-green-300 border-2 border-gray-700 rounded p-3 font-mono text-xs space-y-1 select-text">
              <div>$ {getCommandForTool()}</div>
              <div className="text-gray-400">Expected proof: created directory, Git repository, dependency install, and test result.</div>
              <div className="text-cyan-300">Only after that proof does SLOP ask: Start your engines?</div>
            </div>

            {/* Conditional economic policy */}
            <div className="bg-gradient-to-r from-blue-950 via-slate-900 to-blue-950 text-white p-4 rounded border border-blue-700 shadow font-mono text-xs space-y-2">
              <div className="font-bold text-amber-400 flex items-center gap-1.5 text-xs">
                <ShieldCheck size={14} />
                <span>If You Later Publish and Complete a Sale:</span>
              </div>
              <div className="flex justify-between border-b border-blue-900 pb-1 text-gray-300">
                <span>⚡ Immediate fork maker:</span>
                <span className="font-bold text-emerald-400">70% of distributable revenue</span>
              </div>
              <div className="flex justify-between border-b border-blue-900 pb-1 text-gray-300">
                <span>💎 Eligible upstream lineage:</span>
                <span className="font-bold text-blue-300">20% under frozen sale policy</span>
              </div>
              <div className="flex justify-between text-gray-300">
                <span>🛡️ Protocol Liquidity Pool:</span>
                <span className="font-bold text-purple-300">10% under frozen sale policy</span>
              </div>
              <div className="text-[10px] text-blue-300 pt-1">No entitlement or payout is created by this wizard.</div>
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
                  <span>Open Upstream App Preview</span>
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
                  <span>Inspect Upstream on GITSMITH</span>
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
              Open Upstream Preview
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
