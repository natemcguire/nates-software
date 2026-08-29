import React, { useEffect, useState } from 'react';
import {
  Wrench,
  Folder,
  Copy,
  Check,
  Sparkles,
  Bot,
  FileCode,
  Terminal,
  ShieldCheck,
  Download,
  AlertTriangle,
  ArrowRight,
  Database,
  Layers,
  RefreshCw,
  GitBranch,
  Code
} from 'lucide-react';
import { playClickSound, playSuccessChime } from '../lib/soundEngine';
import { useAlert } from '../context/AlertContext';
import {
  getAppCoordinates,
  getAppCoordinate,
  getFeaturePresets,
  getAgentTools,
  generateLocalAgentPlan,
  getEvidenceChecklist,
  evaluateGatewayLandingStatus,
  AgentToolId,
  FeaturePreset,
  RepoCoordinate
} from '../lib/slopshopDomain';

export const SlopshopView: React.FC = () => {
  const { showAlert } = useAlert();

  // Selected state
  const [selectedAppId, setSelectedAppId] = useState<string>('dronehunter');
  const [selectedAgent, setSelectedAgent] = useState<AgentToolId>('agy');
  const [activeTab, setActiveTab] = useState<'spec' | 'command' | 'evidence' | 'gateway'>('spec');
  const [makerHandle, setMakerHandle] = useState<string>('@nate');

  // Active coordinate & presets
  const coordinate: RepoCoordinate = getAppCoordinate(selectedAppId);
  const presets: FeaturePreset[] = getFeaturePresets(selectedAppId);
  const [activePreset, setActivePreset] = useState<FeaturePreset>(presets[0]);
  const [customPrompt, setCustomPrompt] = useState<string>(presets[0].prompt);

  // Copy feedback indicators
  const [copiedMainCmd, setCopiedMainCmd] = useState(false);
  const [copiedForkCmd, setCopiedForkCmd] = useState(false);
  const [copiedManifest, setCopiedManifest] = useState(false);
  const [copiedStepIndex, setCopiedStepIndex] = useState<number | null>(null);
  const [gatewayState, setGatewayState] = useState<'checking' | 'ready' | 'unavailable'>('checking');

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/git?action=gateway-readiness', { cache: 'no-store', signal: controller.signal })
      .then(async response => ({ response, body: await response.json() }))
      .then(({ response, body }) => setGatewayState(response.ok && body?.ready === true ? 'ready' : 'unavailable'))
      .catch(error => { if (error?.name !== 'AbortError') setGatewayState('unavailable'); });
    return () => controller.abort();
  }, []);

  // Generate the deterministic local agent execution plan
  const plan = generateLocalAgentPlan({
    coordinate,
    feature: activePreset,
    agent: selectedAgent,
    makerHandle,
    customPrompt
  });

  const evidenceChecklist = getEvidenceChecklist(activePreset);
  const gatewayPrerequisites = evaluateGatewayLandingStatus({ coordinate, feature: activePreset });
  const allCoordinates = getAppCoordinates();
  const allAgentTools = getAgentTools();

  const handleSelectApp = (app: RepoCoordinate) => {
    playClickSound();
    setSelectedAppId(app.appId);
    const newPresets = getFeaturePresets(app.appId);
    setActivePreset(newPresets[0]);
    setCustomPrompt(newPresets[0].prompt);
  };

  const handleSelectPreset = (preset: FeaturePreset) => {
    playClickSound();
    setActivePreset(preset);
    setCustomPrompt(preset.prompt);
  };

  const handleCopySingleLineCmd = () => {
    playSuccessChime();
    navigator.clipboard.writeText(plan.singleLineCommand);
    setCopiedMainCmd(true);
    setTimeout(() => setCopiedMainCmd(false), 2000);
    showAlert(
      `Verified install command copied!\n\n$ ${plan.singleLineCommand}\n\nSLOP completes the install first and only then asks which engine to start.`,
      "Install Command Copied",
      "success"
    );
  };

  const handleCopyForkCmd = () => {
    playClickSound();
    const cmd = `slop fork ${coordinate.slug}`;
    navigator.clipboard.writeText(cmd);
    setCopiedForkCmd(true);
    setTimeout(() => setCopiedForkCmd(false), 2000);
  };

  const handleCopyStep = (stepIndex: number, cmd: string) => {
    playClickSound();
    navigator.clipboard.writeText(cmd);
    setCopiedStepIndex(stepIndex);
    setTimeout(() => setCopiedStepIndex(null), 2000);
  };

  const handleCopyManifest = () => {
    playSuccessChime();
    navigator.clipboard.writeText(plan.manifestJson);
    setCopiedManifest(true);
    setTimeout(() => setCopiedManifest(false), 2000);
    showAlert(
      "Feature Manifest (slop-feature.json) copied to clipboard!\n\nSave this file inside your local worktree root to provide structured feature context to autonomous coding agents.",
      "Manifest Copied",
      "success"
    );
  };

  const handleDownloadManifest = () => {
    playSuccessChime();
    try {
      const blob = new Blob([plan.manifestJson], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `slop-manifest-${activePreset.id}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      handleCopyManifest();
    }
  };

  const handleTruthfulLandAttempt = () => {
    playClickSound();
    showAlert(
      `[VERIFIED LANDING STEPS]\n\n` +
      `Gateway status: ${gatewayState === 'ready' ? 'ready for authenticated Git operations' : gatewayState}. Direct in-browser CAS merges remain disabled because no local feature ref or execution proof has been supplied.\n\n` +
      `To land this feature truthfully:\n` +
      `1. Run the local agent command in your workstation terminal.\n` +
      `2. Verify that npm test and tsc -b pass locally.\n` +
      `3. Execute "slop push" or "git push origin ${plan.branchName}" with your cryptographic evidence digest.\n\n` +
      `Zero fake commits or unverified merges are fabricated.`,
      "Local Agent Ref Required to Land",
      "info"
    );
  };

  const handleTruthfulRevertAttempt = () => {
    playClickSound();
    showAlert(
      `[ROLLBACK PREPARATION]\n\n` +
      `Rollback requires an existing commit SHA recorded in the git repository.\n\n` +
      `Once your local feature commit is published, you can generate a clean rollback patch locally by running:\n\n` +
      `$ git revert <commit-sha>\n` +
      `$ slop revert <commit-sha>`,
      "Rollback Contract",
      "info"
    );
  };

  return (
    <div className="flex flex-col h-full bg-[#0b1120] text-slate-200 font-sans text-xs overflow-hidden select-none">
      {/* Top Header Bar */}
      <div className="bg-[#131d31] border-b border-slate-700/80 px-4 py-2.5 flex items-center justify-between flex-wrap gap-2 shadow-md">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-slate-950 px-3 py-1.5 rounded-md border border-slate-700 shadow-inner">
            <Wrench size={16} className="text-amber-400" />
            <span className="font-bold text-white text-sm tracking-wide font-mono">SLOPSHOP</span>
            <span className="bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-mono px-1.5 py-0.5 rounded font-bold">
              SPEC FORGE &amp; LOCAL AGENT LAUNCHPAD
            </span>
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center bg-slate-950 p-0.5 rounded-lg border border-slate-800 font-mono text-[11px]">
            <button
              onClick={() => { playClickSound(); setActiveTab('spec'); }}
              className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-1.5 ${
                activeTab === 'spec'
                  ? 'bg-amber-500 text-slate-950 font-bold shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Sparkles size={12} />
              <span>1. Target &amp; Spec Forge</span>
            </button>
            <button
              onClick={() => { playClickSound(); setActiveTab('command'); }}
              className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-1.5 ${
                activeTab === 'command'
                  ? 'bg-amber-500 text-slate-950 font-bold shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Terminal size={12} />
              <span>2. Local Agent Command &amp; Manifest</span>
            </button>
            <button
              onClick={() => { playClickSound(); setActiveTab('evidence'); }}
              className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-1.5 ${
                activeTab === 'evidence'
                  ? 'bg-amber-500 text-slate-950 font-bold shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <ShieldCheck size={12} />
              <span>3. Checkout &amp; Evidence Guide</span>
            </button>
            <button
              onClick={() => { playClickSound(); setActiveTab('gateway'); }}
              className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-1.5 ${
                activeTab === 'gateway'
                  ? 'bg-amber-500 text-slate-950 font-bold shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <GitBranch size={12} />
              <span>4. CAS Gateway &amp; Landing State</span>
            </button>
          </div>
        </div>

        {/* Honest Local-First Status Indicator */}
        <div className="flex items-center gap-2 text-xs font-mono">
          <span className="bg-slate-950 text-cyan-300 px-3 py-1 rounded-md border border-cyan-800/50 flex items-center gap-1.5 shadow-sm">
            <span className="inline-block w-2 h-2 rounded-full bg-cyan-400"></span>
            <span>Local-First Dev Loop · Browser Sandbox Mode</span>
          </span>
        </div>
      </div>

      {/* Main Studio Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Column: Repository Coordinates */}
        <div className="w-72 border-r border-slate-800 bg-[#0c1424] flex flex-col overflow-hidden shrink-0">
          <div className="p-3 border-b border-slate-800 bg-[#131d31] flex items-center justify-between">
            <span className="font-bold text-white text-xs font-mono flex items-center gap-1.5">
              <Folder size={14} className="text-sky-400" />
              <span>Target Repositories</span>
            </span>
            <span className="text-[10px] text-slate-400 font-mono">~/Projects/</span>
          </div>

          {/* Repository List */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60 p-2 space-y-1">
            {allCoordinates.map(app => {
              const isSelected = selectedAppId === app.appId;
              return (
                <button
                  key={app.appId}
                  onClick={() => handleSelectApp(app)}
                  className={`w-full text-left p-3 rounded-lg transition-all ${
                    isSelected
                      ? 'bg-slate-800/90 text-white border-l-4 border-amber-400 shadow-md ring-1 ring-slate-700'
                      : 'text-slate-300 hover:bg-slate-800/50 hover:text-white'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-xs font-mono text-sky-300 flex items-center gap-1.5">
                      <span>{app.icon}</span>
                      <span>{app.name}</span>
                    </span>
                    <span className="text-[10px] font-mono text-slate-400 bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800">
                      {app.version}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono truncate mb-1">
                    {app.sqliteDatabase || 'Persistence declared by repository'}
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-slate-400 font-mono">
                    <span className="text-emerald-400">Port {app.defaultPort}</span>
                    <span>·</span>
                    <span>{app.price}</span>
                    <span>·</span>
                    <span className="text-amber-400/90">70% Royalty</span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Quick Fork Box */}
          <div className="p-3 bg-slate-950 border-t border-slate-800">
            <div className="text-[10px] text-slate-400 font-mono mb-1.5 flex items-center justify-between">
              <span>WORKTREE FORK COMMAND:</span>
              <button
                onClick={handleCopyForkCmd}
                className="text-sky-400 hover:text-sky-300 flex items-center gap-1 font-bold"
              >
                {copiedForkCmd ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                <span>{copiedForkCmd ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <div className="bg-black/90 px-2.5 py-1.5 rounded border border-slate-800 font-mono text-[10px] text-amber-300 truncate select-all">
              slop fork {coordinate.slug}
            </div>
          </div>
        </div>

        {/* Right / Center Area */}
        <div className="flex-1 flex flex-col overflow-hidden bg-slate-950/40">
          {/* TAB 1: TARGET & SPEC FORGE */}
          {activeTab === 'spec' && (
            <div className="flex-1 flex flex-col overflow-y-auto p-4 space-y-4">
              {/* Presets Selection */}
              <div>
                <div className="text-xs font-mono text-slate-300 mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 font-bold">
                    <Sparkles size={13} className="text-amber-400" />
                    <span>SELECT FEATURE SPECIFICATION BLUEPRINT ({coordinate.name.toUpperCase()}):</span>
                  </span>
                  <span className="text-[11px] text-slate-400">
                    Target repo: <code className="text-sky-300">{coordinate.slug}</code>
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {presets.map(p => {
                    const isAct = activePreset.id === p.id;
                    return (
                      <button
                        key={p.id}
                        onClick={() => handleSelectPreset(p)}
                        className={`p-3.5 rounded-lg border text-left transition-all flex flex-col justify-between ${
                          isAct
                            ? 'bg-slate-800 border-amber-500 text-white shadow-lg ring-1 ring-amber-500/30'
                            : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[10px] font-mono font-bold text-amber-400 bg-amber-950/60 border border-amber-800/60 px-1.5 py-0.5 rounded">
                              {p.category}
                            </span>
                            {p.migrationSql && (
                              <span className="text-[9px] font-mono text-sky-400 bg-sky-950/60 border border-sky-800/60 px-1 py-0.5 rounded flex items-center gap-0.5">
                                <Database size={9} />
                                <span>SQL</span>
                              </span>
                            )}
                          </div>
                          <div className="font-bold text-xs mb-1 font-mono text-slate-100">{p.name}</div>
                          <div className="text-[11px] text-slate-400 leading-snug line-clamp-2">{p.description}</div>
                        </div>

                        <div className="mt-2 pt-2 border-t border-slate-700/60 text-[10px] text-slate-400 font-mono flex items-center justify-between">
                          <span>{p.targetFiles.length} Target Files</span>
                          <span className="text-amber-300">Select &rarr;</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Agent Tool Selector & Spec Editor */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-4 shadow-lg">
                <div className="flex items-center justify-between flex-wrap gap-2 border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <Bot size={16} className="text-sky-400" />
                    <span className="font-bold font-mono text-xs text-white">Target AI Agent &amp; Developer Tool</span>
                  </div>

                  {/* Agent Select Buttons */}
                  <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-lg border border-slate-800 text-[11px] font-mono">
                    {allAgentTools.map(tool => {
                      const isSel = selectedAgent === tool.id;
                      return (
                        <button
                          key={tool.id}
                          onClick={() => { playClickSound(); setSelectedAgent(tool.id); }}
                          className={`px-2.5 py-1 rounded-md transition-all flex items-center gap-1.5 ${
                            isSel
                              ? 'bg-amber-500 text-slate-950 font-bold shadow'
                              : 'text-slate-400 hover:text-white hover:bg-slate-900'
                          }`}
                        >
                          <span>{tool.icon}</span>
                          <span>{tool.shortName}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Selected Agent Tool Context Banner */}
                <div className="bg-slate-950/80 border border-slate-800/80 p-3 rounded-lg flex items-center justify-between gap-3 text-xs font-mono">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{plan.agent.icon}</span>
                    <div>
                      <div className="font-bold text-slate-100 flex items-center gap-2">
                        <span>{plan.agent.name}</span>
                        <span className="text-[10px] text-amber-400 bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-800/50">
                          {plan.agent.badge}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">{plan.agent.description}</div>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[10px] text-slate-500">Recommended Model</div>
                    <div className="text-emerald-400 font-bold">{plan.agent.recommendedModel}</div>
                  </div>
                </div>

                {/* Prompt Editor */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-mono text-slate-400">
                    <span>Feature Modification Prompt Specification:</span>
                    <span>{customPrompt.length} characters</span>
                  </div>
                  <textarea
                    value={customPrompt}
                    onChange={e => setCustomPrompt(e.target.value)}
                    rows={4}
                    className="w-full bg-slate-950 text-slate-100 font-mono text-xs p-3.5 rounded-lg border border-slate-800 focus:border-amber-500 focus:outline-none resize-none leading-relaxed select-text"
                    placeholder="Enter instructions for the AI coding agent..."
                  />
                </div>

                {/* Target Files & Schema Metadata */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-1.5">
                    <div className="text-slate-400 font-bold flex items-center gap-1.5">
                      <FileCode size={13} className="text-sky-400" />
                      <span>Target Files to Modify:</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {activePreset.targetFiles.map((file, idx) => (
                        <span
                          key={idx}
                          className="bg-slate-900 text-sky-300 border border-slate-700 px-2 py-0.5 rounded text-[11px]"
                        >
                          {file}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-1.5">
                    <div className="text-slate-400 font-bold flex items-center gap-1.5">
                      <Database size={13} className="text-amber-400" />
                      <span>Repository Persistence Contract:</span>
                    </div>
                    <div className="text-[11px] text-slate-300 truncate">
                      Target: <code className="text-amber-300">{coordinate.sqliteDatabase || 'Defined by repository manifest'}</code>
                    </div>
                    {activePreset.migrationSql ? (
                      <div className="bg-black/60 p-1.5 rounded border border-slate-800 text-[10px] text-slate-400 font-mono truncate select-text">
                        {activePreset.migrationSql}
                      </div>
                    ) : (
                      <div className="text-[10px] text-slate-500 italic">No schema migration required for this feature.</div>
                    )}
                  </div>
                </div>

                {/* Draft attribution and conditional sale policy */}
                <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 flex items-center justify-between flex-wrap gap-3 font-mono text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400">Draft Maker Attribution:</span>
                    <input
                      type="text"
                      value={makerHandle}
                      onChange={e => setMakerHandle(e.target.value)}
                      className="bg-slate-900 border border-slate-700 px-2 py-1 rounded text-amber-300 font-bold outline-none w-28 text-xs"
                      placeholder="@handle"
                    />
                  </div>
                  <div className="text-slate-400 text-[11px] flex items-center gap-2">
                    <span>Proposed Sale Policy (verified only on publication + sale):</span>
                    <span className="text-emerald-400 font-bold">70% Maker</span>
                    <span>·</span>
                    <span className="text-sky-400">20% Root Ancestor</span>
                    <span>·</span>
                    <span className="text-purple-400">10% Protocol Pool</span>
                  </div>
                </div>

                {/* Bottom Action Controls */}
                <div className="flex items-center justify-between pt-2 border-t border-slate-800 flex-wrap gap-3">
                  <button
                    onClick={handleCopySingleLineCmd}
                    className="bg-slate-800 hover:bg-slate-700 text-slate-100 px-4 py-2 rounded-lg font-mono font-bold flex items-center gap-2 border border-slate-700 transition-colors shadow"
                  >
                    {copiedMainCmd ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                    <span>Copy Verified Install Command</span>
                  </button>

                  <button
                    onClick={() => {
                      playSuccessChime();
                      setActiveTab('command');
                    }}
                    className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold font-mono px-5 py-2 rounded-lg shadow-lg flex items-center gap-2 transition-all"
                  >
                    <span>Review Post-Install Agent Plan &amp; Manifest</span>
                    <ArrowRight size={14} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: LOCAL AGENT COMMAND & MANIFEST */}
          {activeTab === 'command' && (
            <div className="flex-1 flex flex-col overflow-y-auto p-4 space-y-4">
              {/* Context Summary Header */}
              <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl flex items-center justify-between flex-wrap gap-3 shadow-md">
                <div>
                  <div className="font-bold text-white font-mono text-xs flex items-center gap-2">
                    <Terminal size={15} className="text-amber-400" />
                    <span>Install-First Execution Blueprint: {activePreset.name}</span>
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                    Target: <span className="text-sky-300">{coordinate.name}</span> · Agent: <span className="text-amber-300">{plan.agent.name}</span> · Worktree: <code className="text-slate-300">{plan.worktreeDir}</code>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopySingleLineCmd}
                    className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold font-mono px-4 py-1.5 rounded-md text-xs flex items-center gap-1.5 shadow transition-colors"
                  >
                    {copiedMainCmd ? <Check size={13} /> : <Copy size={13} />}
                    <span>{copiedMainCmd ? 'Install Command Copied!' : 'Copy Install Command'}</span>
                  </button>
                </div>
              </div>

              {/* Single Line Terminal Execution Box */}
              <div className="bg-slate-950 border-2 border-slate-800 rounded-xl p-4 space-y-2 shadow-inner">
                <div className="flex items-center justify-between text-slate-400 text-[11px] font-mono border-b border-slate-800/80 pb-2">
                  <span className="flex items-center gap-1.5 text-slate-300 font-bold">
                    <Terminal size={12} className="text-emerald-400" />
                    <span>WORKSTATION INSTALL COMMAND:</span>
                  </span>
                  <span className="text-emerald-400">Runs locally on your host shell</span>
                </div>

                <div className="bg-black/90 p-3 rounded-lg border border-slate-800/80 font-mono text-xs text-emerald-300 select-all overflow-x-auto leading-relaxed whitespace-pre-wrap break-all">
                  {plan.singleLineCommand}
                </div>

                <div className="text-[10px] text-slate-500 font-mono flex items-center justify-between pt-1">
                  <span>SLOP prints the verified working directory after install</span>
                  <span>Branch: {plan.branchName}</span>
                </div>
              </div>

              {/* Step-by-Step Execution Sequence */}
              <div className="space-y-2.5">
                <div className="text-xs font-mono font-bold text-slate-300 flex items-center gap-1.5">
                  <Layers size={14} className="text-sky-400" />
                  <span>STEP-BY-STEP LOCAL EXECUTION WORKFLOW:</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 font-mono text-xs">
                  {plan.steps.map((step, idx) => (
                    <div
                      key={step.stepNumber}
                      className="bg-slate-900 border border-slate-800 rounded-lg p-3.5 space-y-2 flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="font-bold text-amber-300 text-xs flex items-center gap-1.5">
                            <span className="w-5 h-5 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-[10px] text-amber-300 font-bold">
                              {step.stepNumber}
                            </span>
                            <span>{step.title}</span>
                          </span>
                          <button
                            onClick={() => handleCopyStep(idx, step.command)}
                            className="text-sky-400 hover:text-sky-300 text-[10px] flex items-center gap-1 bg-slate-950 px-2 py-0.5 rounded border border-slate-800"
                          >
                            {copiedStepIndex === idx ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
                            <span>{copiedStepIndex === idx ? 'Copied' : 'Copy'}</span>
                          </button>
                        </div>
                        <p className="text-slate-400 text-[11px] leading-snug">{step.description}</p>
                      </div>

                      <div className="bg-black/80 p-2 rounded border border-slate-800 text-[11px] text-emerald-400 font-mono select-all truncate mt-1">
                        $ {step.command}
                      </div>

                      {step.requiredEvidence && (
                        <div className="text-[10px] text-slate-500 pt-1 border-t border-slate-800/60">
                          Proof: <span className="text-slate-400">{step.requiredEvidence}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Concrete Feature Manifest File Section */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3 shadow-lg">
                <div className="flex items-center justify-between flex-wrap gap-2 border-b border-slate-800 pb-2.5">
                  <div>
                    <div className="font-bold font-mono text-xs text-white flex items-center gap-2">
                      <Code size={14} className="text-amber-400" />
                      <span>Feature Specification Manifest (slop-feature.json)</span>
                    </div>
                    <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                      Standardized JSON manifest describing repository coordinates, prompts, target files, schema migrations, and evidence contracts.
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleCopyManifest}
                      className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1 rounded text-xs font-mono font-bold flex items-center gap-1 border border-slate-700 transition-colors"
                    >
                      {copiedManifest ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                      <span>{copiedManifest ? 'Copied JSON!' : 'Copy Manifest'}</span>
                    </button>
                    <button
                      onClick={handleDownloadManifest}
                      className="bg-sky-600 hover:bg-sky-500 text-white px-3 py-1 rounded text-xs font-mono font-bold flex items-center gap-1 transition-colors"
                    >
                      <Download size={12} />
                      <span>Download JSON</span>
                    </button>
                  </div>
                </div>

                <div className="bg-black/90 p-3.5 rounded-lg border border-slate-800/90 font-mono text-[11px] text-slate-300 overflow-x-auto max-h-64 overflow-y-auto leading-relaxed select-all">
                  <pre>{plan.manifestJson}</pre>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: CHECKOUT & EVIDENCE GUIDE */}
          {activeTab === 'evidence' && (
            <div className="flex-1 flex flex-col overflow-y-auto p-4 space-y-4">
              {/* Isolation Explanation Banner */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2 shadow-md">
                <div className="font-bold text-white font-mono text-xs flex items-center gap-2">
                  <ShieldCheck size={16} className="text-emerald-400" />
                  <span>Why Isolated Local Worktrees &amp; Verified Evidence Are Required</span>
                </div>
                <p className="text-slate-400 text-xs leading-relaxed">
                  In production agentic development, AI coding models edit multiple files simultaneously. An isolated worktree ensures:
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1 text-xs font-mono">
                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-1">
                    <div className="font-bold text-sky-400">1. Branch Hygiene</div>
                    <div className="text-[11px] text-slate-400">
                      Your master and production branches remain untouched until test evidence is 100% green.
                    </div>
                  </div>
                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-1">
                    <div className="font-bold text-amber-400">2. Runtime State Isolation</div>
                    <div className="text-[11px] text-slate-400">
                      App-owned files, services, and persistence remain isolated from running production revisions.
                    </div>
                  </div>
                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-1">
                    <div className="font-bold text-emerald-400">3. CAS Merge Protection</div>
                    <div className="text-[11px] text-slate-400">
                      Atomic Compare-and-Swap merges require immutable parent commit SHAs and verified diff hashes.
                    </div>
                  </div>
                </div>
              </div>

              {/* 5-Point Evidence Verification Checklist */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3 shadow-md">
                <div className="font-bold font-mono text-xs text-white flex items-center gap-2">
                  <FileCode size={15} className="text-amber-400" />
                  <span>The 5-Point Evidence Verification Contract</span>
                </div>
                <div className="text-[11px] text-slate-400 font-mono">
                  Before publishing or landing feature refs, the following proofs must be verified locally:
                </div>

                <div className="space-y-2 font-mono text-xs">
                  {evidenceChecklist.map(item => (
                    <div
                      key={item.id}
                      className="bg-slate-950 p-3 rounded-lg border border-slate-800/80 flex items-start justify-between gap-3"
                    >
                      <div className="space-y-1">
                        <div className="font-bold text-slate-200">{item.title}</div>
                        <div className="text-[11px] text-slate-400 leading-snug">{item.description}</div>
                        <div className="text-[10px] text-emerald-400">
                          Expected Evidence: <span className="text-slate-300">{item.evidenceProduced}</span>
                        </div>
                      </div>
                      <div className="bg-black/80 px-2.5 py-1 rounded border border-slate-800 text-[10px] text-amber-300 font-mono shrink-0 select-all">
                        $ {item.command}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Blueprint Preview */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3 shadow-md">
                <div className="flex items-center justify-between">
                  <div className="font-bold font-mono text-xs text-white flex items-center gap-2">
                    <FileCode size={14} className="text-sky-400" />
                    <span>Feature Blueprint Specification (Expected Local Output)</span>
                  </div>
                  <span className="text-[10px] text-amber-400 font-mono bg-amber-950/60 px-2 py-0.5 rounded border border-amber-800/50">
                    Synthesized locally on your machine
                  </span>
                </div>

                <div className="bg-black/95 rounded-lg border border-slate-800 p-4 font-mono text-xs overflow-x-auto shadow-inner leading-relaxed select-all max-h-64 overflow-y-auto">
                  <pre className="text-slate-300 whitespace-pre-wrap">{activePreset.blueprintDiffPreview}</pre>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: CAS GATEWAY & LANDING STATE */}
          {activeTab === 'gateway' && (
            <div className="flex-1 flex flex-col overflow-y-auto p-4 space-y-4">
              {/* Truthful Offline Gateway Warning */}
              <div className="bg-amber-950/30 border border-amber-500/40 rounded-xl p-4 space-y-2 shadow-lg">
                <div className="flex items-center gap-2 text-amber-400 font-mono font-bold text-xs">
                  <AlertTriangle size={16} />
                  <span>STANDALONE WEB SANDBOX · {gatewayState === 'ready' ? 'CAS GATEWAY READY · AWAITING LOCAL AGENT REF' : gatewayState === 'checking' ? 'CHECKING CAS GATEWAY' : 'CAS GATEWAY UNAVAILABLE'}</span>
                </div>
                <p className="text-slate-300 text-xs leading-relaxed">
                  Because Nate's Software Web OS runs client-side in the browser, it <strong>does not invoke local host shells</strong> or fabricate fake git commits. Feature code generation, test assertions, and git commits must take place locally on your workstation.
                </p>
                <div className="text-[11px] text-amber-300/80 font-mono pt-1">
                  Status: <code className="bg-slate-950 px-2 py-0.5 rounded border border-amber-900/50">{gatewayState === 'ready' ? 'Gateway Ready · Awaiting Local Execution Proof' : gatewayState === 'checking' ? 'Checking Gateway Readiness' : 'Gateway Unavailable'}</code>
                </div>
              </div>

              {/* CAS Landing Contract Inspector */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3 shadow-md font-mono text-xs">
                <div className="font-bold text-white flex items-center justify-between border-b border-slate-800 pb-2">
                  <span className="flex items-center gap-2">
                    <GitBranch size={15} className="text-sky-400" />
                    <span>Compare-And-Swap (CAS) Landing Contract</span>
                  </span>
                  <span className="text-slate-500 text-[10px]">GITSMITH CAS ENGINE</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-2">
                    <div className="text-slate-400 font-bold">CAS Parameters:</div>
                    <div className="space-y-1 text-[11px]">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Target Branch:</span>
                        <span className="text-sky-300 font-bold">refs/heads/main</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Feature Ref Format:</span>
                        <span className="text-amber-300">refs/features/{activePreset.id}/&lt;sha&gt;</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Evidence Digest Header:</span>
                        <span className="text-emerald-400">X-Slop-Evidence-Digest</span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-2">
                    <div className="text-slate-400 font-bold">Required Artifacts Before Landing:</div>
                    <div className="space-y-1 text-[11px] text-slate-300">
                      {gatewayPrerequisites.requiredArtifacts.map((req, idx) => (
                        <div key={idx} className="flex items-center gap-1.5">
                          <span className="text-amber-400 font-bold">▫</span>
                          <span>{req}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Truthful Action Control Panel */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3 shadow-md">
                <div className="font-bold font-mono text-xs text-white">
                  CAS Landing &amp; Rollback Controls
                </div>

                <div className="flex items-center gap-3 flex-wrap pt-1">
                  <button
                    onClick={handleTruthfulLandAttempt}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold font-mono px-4 py-2 rounded-lg flex items-center gap-2 shadow transition-colors"
                  >
                    <GitBranch size={14} />
                    <span>Review Verified Landing Steps</span>
                  </button>

                  <button
                    onClick={handleTruthfulRevertAttempt}
                    className="bg-rose-950/70 hover:bg-rose-900 text-rose-300 border border-rose-800 font-bold font-mono px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
                  >
                    <RefreshCw size={13} />
                    <span>Revert / Rollback Ref</span>
                  </button>

                  <button
                    onClick={() => {
                      playClickSound();
                      setActiveTab('command');
                    }}
                    className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold font-mono px-4 py-2 rounded-lg flex items-center gap-2 transition-colors ml-auto"
                  >
                    <Terminal size={13} />
                    <span>View Local Command &rarr;</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
