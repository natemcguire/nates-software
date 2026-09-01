import React, { useState, useEffect, useCallback } from 'react';
import { Sparkles, Terminal, ArrowRight, Check, Copy, ShieldCheck, ExternalLink, Play, Key, RefreshCw, AlertTriangle } from 'lucide-react';
import { playClickSound, playSuccessChime } from '../lib/soundEngine';
import { useAuth } from '../context/AuthContext';
import { useAlert } from '../context/AlertContext';
import { ForkWithAiModal } from '../components/ForkWithAiModal';

interface StarterApp {
  id: string;
  name: string;
  avatar: string;
  tagline: string;
  price: string;
  category: string;
  suggestedPrompt: string;
  hasCanonicalRepo: boolean;
  isRepoActive: boolean;
  repoSlug: string;
  repoName: string;
  repoOwner: string;
  repoDefaultRef?: string;
  repositoryId?: string | null;
}

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
  const { user, openAuthModal } = useAuth();
  const { showAlert } = useAlert();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [starters, setStarters] = useState<StarterApp[]>([]);
  const [isLoadingStarters, setIsLoadingStarters] = useState<boolean>(true);
  const [startersError, setStartersError] = useState<string | null>(null);
  const [selectedStarter, setSelectedStarter] = useState<StarterApp | null>(null);
  const [activeTool, setActiveTool] = useState<'claude' | 'agy' | 'cursor' | 'terminal'>('claude');
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [isForkModalOpen, setIsForkModalOpen] = useState(false);
  const [cliToken, setCliToken] = useState<string | null>(null);
  const [isGeneratingCliToken, setIsGeneratingCliToken] = useState(false);
  const [cliTokenCopied, setCliTokenCopied] = useState(false);

  const fetchStarters = useCallback(async () => {
    setIsLoadingStarters(true);
    setStartersError(null);
    try {
      const res = await fetch('/api/drops?batch=all');
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success || !Array.isArray(data?.drops)) {
        throw new Error(data?.error || `Failed to fetch starters (HTTP ${res.status})`);
      }

      const forkable = data.drops
        .filter((d: any) => {
          const hasRepo = Boolean(d.canonicalRepositoryId || d.repositoryId || (d.repoSlugName && d.repoStatus === 'active'));
          const isRepoActive = d.repoStatus ? d.repoStatus === 'active' : hasRepo;
          return hasRepo && isRepoActive;
        })
        .map((d: any) => {
          const rawPrice = d.price;
          let priceStr = '$0.00';
          if (typeof rawPrice === 'number') {
            priceStr = `$${(rawPrice / 100).toFixed(2)}`;
          } else if (typeof rawPrice === 'string' && rawPrice.startsWith('$')) {
            priceStr = rawPrice;
          } else if (typeof rawPrice === 'string') {
            priceStr = `$${rawPrice}`;
          }

          const category = Array.isArray(d.tags) && d.tags.length > 0
            ? d.tags[0]
            : (typeof d.tags === 'string' ? d.tags : 'Shareware App');

          const repoOwner = d.repoOwnerUsername || d.creator || 'nate';
          const repoSlugName = d.repoSlugName || d.id;

          return {
            id: d.id,
            name: d.name || d.id,
            avatar: d.creatorAvatar || '📦',
            tagline: d.tagline || d.description || '',
            price: priceStr,
            category,
            suggestedPrompt: `Implement a new feature for ${d.name || d.id}.`,
            hasCanonicalRepo: true,
            isRepoActive: true,
            repoSlug: `${repoOwner}/${repoSlugName}`,
            repoName: repoSlugName,
            repoOwner,
            repoDefaultRef: d.repoDefaultRef || 'refs/heads/main',
            repositoryId: d.canonicalRepositoryId || d.repositoryId || null
          } as StarterApp;
        });

      setStarters(forkable);
      if (forkable.length > 0) {
        setSelectedStarter(prev => {
          if (prev && forkable.some((s: StarterApp) => s.id === prev.id)) return prev;
          return forkable[0];
        });
      } else {
        setSelectedStarter(null);
      }
    } catch (err: any) {
      setStarters([]);
      setSelectedStarter(null);
      setStartersError(err?.message || 'Failed to load starters from canonical catalog');
    } finally {
      setIsLoadingStarters(false);
    }
  }, []);

  useEffect(() => {
    fetchStarters();
  }, [fetchStarters]);

  const handleGenerateCliToken = async () => {
    setIsGeneratingCliToken(true);
    playClickSound();
    try {
      const res = await fetch('/api/auth?action=create-cli-token', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Failed to generate CLI token (${res.status})`);
      }
      setCliToken(data.token);
      playSuccessChime();
      showAlert("CLI token generated! Run `slop login` in your terminal to authenticate.", "CLI Token Created", "success");
    } catch (err: any) {
      showAlert(err.message || 'Failed to generate CLI token', "Token Error", "error");
    } finally {
      setIsGeneratingCliToken(false);
    }
  };

  const handleCopyCliToken = () => {
    if (!cliToken) return;
    playSuccessChime();
    navigator.clipboard.writeText(cliToken);
    setCliTokenCopied(true);
    setTimeout(() => setCliTokenCopied(false), 2000);
    showAlert("CLI token copied to clipboard.", "Token Copied", "success");
  };

  const getCommandForTool = () => {
    if (!selectedStarter) return 'slop fork <app>';
    return `slop fork ${selectedStarter.repoOwner}/${selectedStarter.repoName}`;
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
                <span>Step 1: Pick a starter app to fork</span>
              </div>
              <p className="text-gray-600 text-xs">
                Fork one of Nate's apps to make it your own. If you sell your version later, you keep 70% and 20% flows back to the app you forked from.
              </p>
            </div>

            {/* Starters Grid */}
            {isLoadingStarters && (
              <div className="bg-white border-2 border-t-black border-l-black border-b-white border-r-white p-6 text-center text-gray-500 font-mono text-xs flex items-center justify-center gap-2">
                <RefreshCw size={14} className="animate-spin text-blue-900" />
                <span>Loading forkable starters from canonical catalog...</span>
              </div>
            )}

            {!isLoadingStarters && startersError && (
              <div className="bg-red-50 border-2 border-red-400 p-4 rounded text-red-900 text-xs space-y-2 text-center">
                <AlertTriangle size={20} className="mx-auto text-red-600" />
                <div className="font-bold">Failed to load starters from catalog</div>
                <div className="text-gray-600">{startersError}</div>
                <button
                  type="button"
                  onClick={fetchStarters}
                  className="btn-w95 px-3 py-1 font-bold text-xs inline-flex items-center gap-1 mx-auto"
                >
                  <RefreshCw size={12} />
                  <span>Retry</span>
                </button>
              </div>
            )}

            {!isLoadingStarters && !startersError && starters.length === 0 && (
              <div className="bg-gray-50 border-2 border-dashed border-gray-300 p-6 rounded text-center space-y-2">
                <Sparkles size={24} className="mx-auto text-gray-400" />
                <div className="font-bold text-gray-700 text-sm">No Forkable Starters Available</div>
                <p className="text-gray-500 text-xs max-w-sm mx-auto">
                  There are currently no active applications with canonical repositories ready for forking.
                </p>
                <button
                  type="button"
                  onClick={fetchStarters}
                  className="btn-w95 px-3 py-1 font-bold text-xs inline-flex items-center gap-1 mx-auto"
                >
                  <RefreshCw size={12} />
                  <span>Refresh Catalog</span>
                </button>
              </div>
            )}

            {!isLoadingStarters && !startersError && starters.length > 0 && (
              <div className="space-y-2">
                {starters.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => { playClickSound(); setSelectedStarter(s); }}
                    className={`w-full text-left p-3 border-2 flex items-center justify-between transition-all ${
                      selectedStarter?.id === s.id
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
            )}

            {/* Primary 1-Click In-Browser Fork Action */}
            <div className="bg-gradient-to-r from-blue-950 via-slate-900 to-blue-950 p-3 rounded border-2 border-blue-700 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="text-white">
                <div className="font-bold text-xs flex items-center gap-1.5 text-amber-400">
                  <Sparkles size={13} />
                  <span>Primary Launchpad (In-Browser Fork)</span>
                </div>
                <div className="text-blue-200 text-[11px] mt-0.5">
                  Provisions a real Git forge repository with immutable parent lineage and AI prompting.
                </div>
              </div>
              <button
                type="button"
                disabled={!selectedStarter}
                onClick={() => {
                  playClickSound();
                  setIsForkModalOpen(true);
                }}
                className="btn-w95 btn-w95-primary px-4 py-2 font-bold text-xs flex items-center justify-center gap-1.5 shrink-0 shadow disabled:opacity-50"
              >
                <Sparkles size={13} className="text-yellow-300" />
                <span>1-Click Browser Fork</span>
              </button>
            </div>

            {/* Identity boundary */}
            <div className="bg-white border-2 border-t-black border-l-black border-b-white border-r-white p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 font-mono">
              <div className="space-y-0.5">
                <div className="block text-gray-800 font-bold text-xs">Publishing Identity</div>
                <div className="text-gray-500 text-[11px]">Create your maker username to publish and sell — or log in if you already have one.</div>
              </div>
              {user ? (
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 shrink-0 self-start sm:self-auto">
                  <div className="bg-emerald-50 border border-emerald-400 px-2.5 py-1 rounded text-emerald-900 font-bold flex items-center gap-1.5 text-xs">
                    <Check size={13} className="text-emerald-600 shrink-0" />
                    <span>Signed in as @{user.username}</span>
                  </div>
                  {!cliToken ? (
                    <button
                      type="button"
                      onClick={handleGenerateCliToken}
                      disabled={isGeneratingCliToken}
                      className="btn-w95 px-2.5 py-1 font-bold text-xs flex items-center gap-1 text-gray-800"
                      title="Generate a durable personal access token for slop login"
                    >
                      {isGeneratingCliToken ? <RefreshCw size={12} className="animate-spin" /> : <Key size={12} />}
                      <span>Generate CLI Token</span>
                    </button>
                  ) : (
                    <div className="flex items-center gap-1 bg-amber-50 border border-amber-300 px-2 py-0.5 rounded">
                      <input
                        type="text"
                        readOnly
                        value={cliToken}
                        onFocus={(e) => e.target.select()}
                        className="w-24 p-1 border border-gray-400 font-mono text-[10px] bg-white select-all"
                      />
                      <button
                        type="button"
                        onClick={handleCopyCliToken}
                        className="btn-w95 btn-w95-primary px-2 py-0.5 text-[10px] font-bold flex items-center gap-1"
                      >
                        {cliTokenCopied ? <Check size={10} /> : <Copy size={10} />}
                        <span>{cliTokenCopied ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
                  <button
                    type="button"
                    onClick={() => {
                      playClickSound();
                      openAuthModal('register');
                    }}
                    className="btn-w95 btn-w95-primary px-3 py-1 font-bold text-xs"
                  >
                    Create username
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      playClickSound();
                      openAuthModal('login');
                    }}
                    className="btn-w95 px-3 py-1 font-bold text-xs text-gray-800"
                  >
                    Log in
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4 max-w-2xl mx-auto w-full">
            <div className="bg-white border-2 border-t-black border-l-black border-b-white border-r-white p-3 space-y-1">
              <div className="font-bold text-sm text-blue-950 flex items-center gap-1.5">
                <Terminal size={15} className="text-purple-600" />
                <span>Step 2: Local CLI Development &amp; AI Engines (Optional)</span>
              </div>
              <p className="text-gray-600 text-xs">
                To edit locally on your machine, authenticate once via <code className="font-mono bg-gray-200 px-1 py-0.5 rounded text-gray-900">slop login</code> using your CLI token. Then run <code className="font-mono bg-gray-200 px-1 py-0.5 rounded text-gray-900">slop fork</code> to clone <strong>{selectedStarter?.name || 'your selected app'}</strong> into an isolated worktree and launch your AI coding engine.
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
                <span className="text-emerald-400">Runs on your machine</span>
              </div>

              <div className="space-y-1.5 select-text py-1">
                <div className="text-gray-400 text-[10px]"># 1. Authenticate CLI with your token from PROFILE.CFG:</div>
                <div className="text-amber-300 bg-black/50 p-1.5 rounded border border-slate-800 break-all">
                  slop login
                </div>
                <div className="text-gray-400 text-[10px] pt-1"># 2. Fork and clone into local worktree:</div>
                <div className="text-emerald-300 bg-black/50 p-1.5 rounded border border-slate-800 break-all">
                  {getCommandForTool()}
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-slate-500 text-[10px]">
                  Preferred engine: {activeTool === 'agy' ? 'AGY' : activeTool === 'claude' ? 'Claude Code' : activeTool === 'cursor' ? 'Cursor' : 'choose later'} — selected after install
                </span>
                <button
                  onClick={handleCopyCommand}
                  className="bg-emerald-800 hover:bg-emerald-700 text-white px-3 py-1 rounded text-xs font-bold flex items-center gap-1 shadow-sm"
                >
                  {copiedCmd ? <Check size={12} /> : <Copy size={12} />}
                  <span>{copiedCmd ? 'Copied!' : 'Copy Fork Command'}</span>
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
                <span>If you publish and sell your fork:</span>
              </div>
              <div className="flex justify-between border-b border-blue-900 pb-1 text-gray-300">
                <span>⚡ You, the seller:</span>
                <span className="font-bold text-emerald-400">70% of the sale</span>
              </div>
              <div className="flex justify-between border-b border-blue-900 pb-1 text-gray-300">
                <span>💎 The app you forked from:</span>
                <span className="font-bold text-blue-300">20%</span>
              </div>
              <div className="flex justify-between text-gray-300">
                <span>🛡️ The platform:</span>
                <span className="font-bold text-purple-300">10%</span>
              </div>
              <div className="text-[10px] text-blue-300 pt-1">No entitlement or payout is created by this wizard.</div>
            </div>

            {/* Next Steps Quick Action Buttons */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2">
              {onOpenSandbox && (
                <button
                  onClick={() => {
                    playSuccessChime();
                    if (selectedStarter) onOpenSandbox(selectedStarter.id);
                  }}
                  disabled={!selectedStarter}
                  className="btn-w95 btn-w95-primary p-3 font-bold text-xs flex items-center justify-center gap-2 shadow disabled:opacity-50"
                >
                  <Play size={14} />
                  <span>Open Upstream App Preview</span>
                </button>
              )}

              {onOpenForge && (
                <button
                  onClick={() => {
                    playClickSound();
                    if (selectedStarter) onOpenForge(selectedStarter.id);
                  }}
                  disabled={!selectedStarter}
                  className="btn-w95 p-3 font-bold text-xs flex items-center justify-center gap-2 disabled:opacity-50"
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
              disabled={!selectedStarter}
              className="btn-w95 btn-w95-primary px-6 py-1.5 font-bold text-xs flex items-center gap-1.5 disabled:opacity-50"
            >
              <span>Continue</span>
              <ArrowRight size={13} />
            </button>
          ) : (
            <button
              onClick={() => {
                playSuccessChime();
                if (onOpenSandbox && selectedStarter) onOpenSandbox(selectedStarter.id);
              }}
              disabled={!selectedStarter}
              className="btn-w95 btn-w95-primary px-6 py-1.5 font-bold text-xs disabled:opacity-50"
            >
              Open Upstream Preview
            </button>
          )}
        </div>
      </div>

      {/* 1-Click In-Browser Fork Modal */}
      {selectedStarter && (
        <ForkWithAiModal
          isOpen={isForkModalOpen}
          onClose={() => setIsForkModalOpen(false)}
          app={{
            id: selectedStarter.id,
            name: selectedStarter.name,
            avatar: selectedStarter.avatar,
            tagline: selectedStarter.tagline,
            price: parseFloat(String(selectedStarter.price).replace(/[^0-9.]/g, '')) || 15,
            category: selectedStarter.category,
            hasCanonicalRepo: selectedStarter.hasCanonicalRepo,
            isRepoActive: selectedStarter.isRepoActive,
            repoSlug: selectedStarter.repoSlug,
            repoName: selectedStarter.repoName,
            repoOwner: selectedStarter.repoOwner,
            repoDefaultRef: selectedStarter.repoDefaultRef,
            repositoryId: selectedStarter.repositoryId
          }}
          onLaunchTerminal={(cmd) => {
            setIsForkModalOpen(false);
            if (onOpenTerminal) onOpenTerminal(cmd);
          }}
          onForkSuccess={(forkData) => {
            const childSlug = forkData?.repository?.slug || selectedStarter.repoName || selectedStarter.id;
            const owner = user?.username || 'you';
            const nextCmd = `slop fork ${owner}/${childSlug}`;
            showAlert(
              `Forge fork created — clone it locally to build and run: ${nextCmd}`,
              "Forge Fork Created",
              "success"
            );
          }}
        />
      )}
    </div>
  );
};
