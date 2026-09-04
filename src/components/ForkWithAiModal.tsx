import React, { useState } from 'react';
import { Bot, Copy, Check, Sparkles, GitFork, AlertTriangle, Network } from 'lucide-react';
import { playClickSound, playSuccessChime } from '../lib/soundEngine';
import { useAuth } from '../context/AuthContext';
import { useCatalog } from '../context/CatalogContext';
import { useAlert } from '../context/AlertContext';
import { AppListing } from '../data/mockData';

export interface ForkWithAiModalProps {
  isOpen: boolean;
  onClose: () => void;
  app: Partial<AppListing> & {
    id: string;
    name: string;
    version?: string;
    author?: string;
    creator?: string;
    avatar?: string;
    creatorAvatar?: string;
    authorAvatar?: string;
    price?: string | number;
    repositoryId?: string | null;
    hasCanonicalRepo?: boolean;
    isRepoActive?: boolean;
    repoSlug?: string | null;
    repoName?: string | null;
    repoOwner?: string | null;
    repoHeadCommitOid?: string | null;
    repoVisibility?: 'public' | 'unlisted' | 'private' | null;
    repoStatus?: string | null;
    repoDefaultRef?: string | null;
    [key: string]: any;
  };
  onLaunchTerminal?: (cmd: string) => void;
  onForkSuccess?: (forkData: any) => void;
  onOpenApp?: (appId: string) => void;
  onOpenSandbox?: (appId: string) => void;
}

export type ForkPromptTool = 'claude' | 'agy' | 'cursor' | 'terminal';

const FORK_TOOL_NAMES: Record<ForkPromptTool, string> = {
  claude: 'Claude Code',
  agy: 'Antigravity',
  cursor: 'Cursor',
  terminal: 'SLOP CLI'
};

export function formatForkPrompt(tool: ForkPromptTool, repository: string, prompt: string): string {
  return `Target repository: ${repository}\nTool: ${FORK_TOOL_NAMES[tool]}\n\nGoal:\n${prompt.trim()}`;
}

const PROMPT_PRESETS: Record<string, string[]> = {
  dronehunter: [
    'Add dual-wield laser shotguns and a new boss wave telemetry table.',
    'Add laughing retro dog animations on missed shots with 8-bit Web Audio synthesis.',
    'Add local multiplayer high-score tournaments with custom player initials.'
  ],
  'certified-mailer': [
    'Add user-attached receipt photos with local file-size and type validation.',
    'Add a printable evidence timeline that labels every observation as user-entered and unverified.',
    'Add encrypted local export and import for correspondence journals.'
  ],
  wallart: [
    'Add a new art treatment while preserving tenant isolation and durable queue behavior.',
    'Add an inspectable print manifest without exposing private source photographs.',
    'Add a tenant-scoped gallery filter with accessibility and keyboard navigation tests.'
  ],
  'american-gardener': [
    'Add weather-aware planting recommendations using the repository-owned observation model.',
    'Add a crop maturity forecast using growing-degree-day targets and local sensor history.',
    'Add a portable private backup for garden plans without exporting household purchasing data.'
  ]
};

export const ForkWithAiModal: React.FC<ForkWithAiModalProps> = ({
  isOpen,
  onClose,
  app,
  onLaunchTerminal,
  onForkSuccess,
  onOpenApp,
  onOpenSandbox
}) => {
  const { user, openAuthModal } = useAuth();
  const { refreshCatalog } = useCatalog();
  const { showAlert } = useAlert();

  const [isForking, setIsForking] = useState(false);
  const [forkError, setForkError] = useState<string | null>(null);
  const [forkResult, setForkResult] = useState<any | null>(null);
  const [activeTool, setActiveTool] = useState<ForkPromptTool>('claude');
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [copiedWorktreeCmd, setCopiedWorktreeCmd] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  const suggestedPrompts = PROMPT_PRESETS[app.id] || [
    `Implement a new local-first feature for ${app.name}; keep the storage adapter configurable and document its persistence boundary.`
  ];
  const [customPrompt, setCustomPrompt] = useState(suggestedPrompts[0]);

  if (!isOpen) return null;

  const hasCanonicalRepo = Boolean(app.hasCanonicalRepo || app.repositoryId || (app.repoSlug && app.isRepoActive));
  const isRepoActive = app.isRepoActive ?? (app.repoStatus === 'active' || hasCanonicalRepo);
  const canPerformRealFork = hasCanonicalRepo && isRepoActive;

  const resolvedRepoSlug = app.repoSlug || (app.repoName ? `${app.author || app.creator || 'nate'}/${app.repoName}` : null);
  const parentRoyaltyBps = app.royaltyBps ?? app.royalty_bps;
  const parentRoyaltyPercent = typeof parentRoyaltyBps === 'number' ? parentRoyaltyBps / 100 : null;
  const inheritedLiens = Array.isArray(app.inheritedLiens) ? app.inheritedLiens : [];
  const totalRoyaltyBps = inheritedLiens.reduce((sum, lien) => sum + lien.bps, 0) + (parentRoyaltyBps || 0);
  const cliForkTarget = resolvedRepoSlug || `${app.author || app.creator || 'nate'}/${app.id}`;

  const getCliCommand = () => {
    return `slop fork ${cliForkTarget}`;
  };

  const forkedRepository = `${user?.username || 'you'}/${forkResult?.repository?.slug || app.repoName || app.id}`;

  const handleCopyPrompt = () => {
    playSuccessChime();
    navigator.clipboard.writeText(formatForkPrompt(activeTool, forkedRepository, customPrompt));
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 2000);
  };

  const handleCopyCommand = () => {
    playSuccessChime();
    navigator.clipboard.writeText(getCliCommand());
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2000);
    showAlert(`CLI command copied: ${getCliCommand()}`, "Command Copied", "success");
  };

  const handleRealFork = async () => {
    if (!user) {
      playClickSound();
      showAlert("You must be signed in to fork this project onto the GITSMITH forge.", "Sign In Required", "warning");
      openAuthModal('login');
      return;
    }

    if (!canPerformRealFork) {
      playClickSound();
      showAlert(
        "This app hasn't published its source yet, so it can't be forked.",
        "Cannot Fork",
        "warning"
      );
      return;
    }

    setIsForking(true);
    setForkError(null);
    playClickSound();

    try {
      const parentIdentifier = app.repositoryId || app.repoSlug || app.id;
      const res = await fetch('/api/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'fork',
          parentRepositoryId: parentIdentifier,
          appId: app.id,
          childSlug: app.repoName || app.id,
          parentRefName: app.repoDefaultRef || 'refs/heads/main'
        })
      });

      const data = await res.json().catch(() => null);

      if (res.ok && data?.success) {
        setForkResult(data);
        await refreshCatalog();
        playSuccessChime();
        if (onForkSuccess) {
          onForkSuccess(data);
        }
      } else {
        const errorMsg = data?.error || `Fork failed (HTTP ${res.status})`;
        setForkError(errorMsg);
        showAlert(errorMsg, "Fork Failed", "error");
      }
    } catch (err: any) {
      const errorMsg = err?.message || 'Network error during fork creation.';
      setForkError(errorMsg);
      showAlert(errorMsg, "Fork Error", "error");
    } finally {
      setIsForking(false);
    }
  };

  const handleClose = () => {
    playClickSound();
    setForkResult(null);
    setForkError(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-xs select-none p-4 font-tahoma text-xs">
      <div className="w-full max-w-xl bg-w95-gray border-2 border-t-white border-l-white border-b-black border-r-black shadow-2xl p-1">
        <div className="bg-[#000080] text-white px-2 py-1 flex items-center justify-between font-bold text-xs">
          <div className="flex items-center gap-1.5">
            <Bot size={13} className="text-yellow-300" />
            <span>CREATE FORK — {app.name}</span>
          </div>
          <button
            onClick={handleClose}
            className="w-4 h-4 bg-w95-gray border border-t-white border-l-white border-b-black border-r-black text-black font-bold flex items-center justify-center text-[10px] hover:bg-red-700 hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="p-4 bg-w95-gray space-y-3">
          {forkResult ? (
            <div className="bg-white border-2 border-t-black border-l-black border-b-white border-r-white p-4 space-y-3">
              <div className="flex items-center gap-2 text-emerald-800 font-bold text-sm">
                <Check size={18} className="text-emerald-600 shrink-0" />
                <span>Nice — you forked {app.name}.</span>
              </div>

              <p className="text-gray-700 text-xs">
                Your repository fork is ready. No AI editing session has started.
              </p>

              <div className="bg-slate-950 text-slate-100 p-3 rounded font-mono text-xs space-y-2 border border-slate-800">
                <div className="flex items-center justify-between text-[11px] border-b border-slate-800 pb-1">
                  <span className="text-slate-400">Child Repository:</span>
                  <span className="text-emerald-400 font-bold">
                    @{user?.username || 'you'}/{forkResult.repository?.slug || app.repoName || app.id}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] border-b border-slate-800 pb-1">
                  <span className="text-slate-400">Fork Status:</span>
                  <span className="text-amber-400 uppercase font-bold">
                    {forkResult.repository?.status || 'provisioning'}
                  </span>
                </div>
                {forkResult.forkRequest?.parentCommitOid && (
                  <div className="flex items-center justify-between text-[11px] border-b border-slate-800 pb-1">
                    <span className="text-slate-400">Lineage Snapshot:</span>
                    <span className="text-sky-300">
                      #{forkResult.forkRequest.parentCommitOid.slice(0, 8)} (Depth {forkResult.forkRequest.depth || 1})
                    </span>
                  </div>
                )}
                <div className="pt-1">
                  <div className="text-slate-400 text-[10px] mb-1">Clone &amp; Worktree Command:</div>
                  <div className="bg-black/60 p-2 rounded text-emerald-300 text-[11px] flex items-center justify-between">
                    <code>slop fork {user?.username || 'nate'}/{forkResult.repository?.slug || app.repoName || app.id}</code>
                    <button
                      onClick={() => {
                        playSuccessChime();
                        navigator.clipboard.writeText(`slop fork ${user?.username || 'nate'}/${forkResult.repository?.slug || app.repoName || app.id}`);
                        setCopiedWorktreeCmd(true);
                        setTimeout(() => setCopiedWorktreeCmd(false), 2000);
                      }}
                      className="bg-emerald-800 hover:bg-emerald-700 text-white px-2 py-0.5 rounded text-[10px] ml-2 font-bold shrink-0"
                    >
                      {copiedWorktreeCmd ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-300 p-3 space-y-2">
                <div className="font-bold text-blue-950 text-xs">Next step for {FORK_TOOL_NAMES[activeTool]}</div>
                <div className="text-gray-700 text-xs">Copy the goal you selected, then paste it into {FORK_TOOL_NAMES[activeTool]} after opening your fork.</div>
                <button
                  onClick={handleCopyPrompt}
                  className="btn-w95 btn-w95-primary px-3 py-1.5 font-bold text-xs flex items-center gap-1.5"
                >
                  {copiedPrompt ? <Check size={13} /> : <Copy size={13} />}
                  <span>{copiedPrompt ? 'Prompt copied' : `Copy prompt for ${FORK_TOOL_NAMES[activeTool]}`}</span>
                </button>
              </div>

              <div className="flex items-center justify-between pt-2">
                <button
                  onClick={() => {
                    handleClose();
                    if (onOpenApp) {
                      onOpenApp(app.id);
                    } else if (onOpenSandbox) {
                      onOpenSandbox(app.id);
                    }
                  }}
                  className="btn-w95 btn-w95-primary px-4 py-1.5 font-bold text-xs flex items-center gap-1"
                >
                  <span>Open {app.name} in the browser &rarr;</span>
                </button>
                <button
                  onClick={handleClose}
                  className="btn-w95 px-5 py-1.5 font-bold text-xs"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="bg-blue-50 border border-blue-200 text-blue-950 p-2.5 rounded text-xs leading-relaxed">
                Forking gives you your own private copy of this app's code to change with AI — and if you sell it later, the platform takes a flat 10%, the maker you forked from earns their frozen royalty, and you keep the rest.
              </div>

              <div className="bg-white border-2 border-t-black border-l-black border-b-white border-r-white p-3 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="text-3xl bg-gray-50 p-1 rounded border border-gray-300">
                    {app.creatorAvatar || app.authorAvatar || '🎯'}
                  </span>
                  <div>
                    <div className="font-bold text-sm text-gray-900">{app.name}</div>
                    <div className="text-gray-500 text-[11px] font-mono flex items-center gap-1 flex-wrap">
                      <span>Base: @{app.author || app.creator || 'nate'} &rarr; {user ? `Fork: @${user.username}` : 'Fork: (your account)'}</span>
                      {!user && (
                        <span className="text-amber-800 font-sans text-[10px]">
                          (Sign in to keep your fork)
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="text-right font-mono text-[11px]">
                  <div className="text-emerald-800 font-bold">
                    {parentRoyaltyPercent !== null
                      ? `Frozen royalty total: ${(totalRoyaltyBps / 100).toFixed(2)}%`
                      : 'Frozen Maker Royalty'}
                  </div>
                  {resolvedRepoSlug ? (
                    <div className="text-blue-800 font-bold flex items-center gap-1 justify-end">
                      <Network size={11} className="text-blue-600" />
                      <span>{resolvedRepoSlug}</span>
                    </div>
                  ) : (
                    <div className="text-gray-500">Storage declared by app</div>
                  )}
                </div>
              </div>

              {parentRoyaltyPercent !== null && (
                <div className="bg-[#e4f0f7] border border-[#7ea6c4] p-2.5 text-[11px] font-mono text-[#1c4a6b] space-y-1">
                  {inheritedLiens.map((lien, index) => (
                    <div key={`${lien.maker}-${index}`} className="flex justify-between gap-3">
                      <span>@{lien.maker}</span>
                      <span>{(lien.bps / 100).toFixed(2)}%</span>
                    </div>
                  ))}
                  <div className="flex justify-between gap-3">
                    <span>@{app.author || app.creator || 'nate'}</span>
                    <span>{parentRoyaltyPercent.toFixed(2)}%</span>
                  </div>
                  <div className="flex justify-between gap-3 border-t border-[#7ea6c4] pt-1 font-bold">
                    <span>Total owed forever</span>
                    <span>{(totalRoyaltyBps / 100).toFixed(2)}%</span>
                  </div>
                </div>
              )}

              {!canPerformRealFork ? (
                <div className="bg-amber-50 border-2 border-amber-300 p-3 rounded text-xs space-y-1 text-amber-900">
                  <div className="font-bold flex items-center gap-1.5 text-amber-950">
                    <AlertTriangle size={14} className="text-amber-600 shrink-0" />
                    <span>Source Not Published Yet</span>
                  </div>
                  <p className="text-amber-950 text-[11px] leading-relaxed">
                    This app hasn't published its source yet, so it can't be forked.
                  </p>
                </div>
              ) : (
                <div className="bg-blue-50 border border-blue-200 p-2.5 rounded text-xs flex items-center justify-between text-blue-900">
                  <div className="flex items-center gap-2">
                    <GitFork size={14} className="text-blue-700 shrink-0" />
                    <div>
                      <span className="font-bold">Canonical Forge Repo:</span>{' '}
                      <span className="font-mono">{resolvedRepoSlug}</span>
                      {app.repoHeadCommitOid && (
                        <span className="text-blue-600 font-mono text-[10px] ml-1.5">
                          (#{app.repoHeadCommitOid.slice(0, 7)})
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="bg-emerald-100 text-emerald-800 border border-emerald-300 px-1.5 py-0.5 rounded font-mono text-[10px] font-bold">
                    READY TO FORK
                  </span>
                </div>
              )}

              {forkError && (
                <div className="bg-red-50 border border-red-300 p-2 text-red-800 text-xs font-mono rounded">
                  ⚠️ Error: {forkError}
                </div>
              )}

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
                        className={`px-2 py-0.5 text-[11px] font-bold border-t border-l border-r rounded-t flex items-center gap-1 ${
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

                  <div className="bg-slate-950 text-slate-100 p-2.5 rounded border-2 border-slate-800 font-mono text-xs space-y-2">
                    <div className="text-emerald-300 whitespace-pre-wrap break-all leading-relaxed bg-black/60 p-2 rounded border border-slate-800 select-text">
                      {getCliCommand()}
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <span className="text-slate-500 text-[10px]">
                        {resolvedRepoSlug
                          ? `Target: @${resolvedRepoSlug} · Engine: ${activeTool === 'terminal' ? 'SLOP' : activeTool === 'agy' ? 'AGY' : activeTool === 'claude' ? 'Claude Code' : 'Cursor'}`
                          : `Offline demo target (@${app.author || 'nate'}/${app.id})`}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {onLaunchTerminal && (
                          <button
                            onClick={() => {
                              playClickSound();
                              onLaunchTerminal(getCliCommand());
                            }}
                            className="bg-slate-700 hover:bg-slate-600 text-cyan-200 border border-slate-500 px-2 py-1 rounded text-[11px] font-bold flex items-center gap-1 shadow-sm"
                            title="Launch in embedded terminal"
                          >
                            <span>Run</span>
                          </button>
                        )}
                        <button
                          onClick={handleCopyCommand}
                          className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 px-2.5 py-1 rounded text-xs font-bold flex items-center gap-1 shadow-sm"
                        >
                          {copiedCmd ? <Check size={12} /> : <Copy size={12} />}
                          <span>{copiedCmd ? 'Copied!' : 'Copy CLI Command'}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

              <div className="flex items-center justify-between pt-2 border-t border-gray-300 flex-wrap gap-2">
                <button
                  onClick={handleClose}
                  className="btn-w95 px-4 py-1 text-xs"
                >
                  Cancel
                </button>

                <div className="flex items-center gap-2">
                  {canPerformRealFork ? (
                    <button
                      onClick={handleRealFork}
                      disabled={isForking}
                      className="btn-w95 btn-w95-primary px-4 py-1.5 font-bold text-xs flex items-center gap-1.5 shadow"
                    >
                      <GitFork size={13} />
                      <span>{isForking ? 'Creating fork...' : 'Create fork'}</span>
                    </button>
                  ) : (
                    <button
                      disabled
                      title="This app hasn't published its source yet, so it can't be forked."
                      className="btn-w95 opacity-60 cursor-not-allowed px-4 py-1.5 font-bold text-xs flex items-center gap-1.5 text-gray-500"
                    >
                      <AlertTriangle size={13} />
                      <span>Fork Unavailable (Source Not Published)</span>
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
