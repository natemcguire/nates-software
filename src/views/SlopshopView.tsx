import React, { useState, useEffect, useRef } from 'react';
import { PRESET_FEATURES, ASTFeaturePackage, validateAstFeature } from '../lib/slopshopDomain';
import { Wrench, Sparkles, Terminal, CheckCircle2, Layers, GitBranch, ShieldCheck, Play } from 'lucide-react';

export const SlopshopView: React.FC = () => {
  const [selectedFeature, setSelectedFeature] = useState<ASTFeaturePackage>(PRESET_FEATURES[0]);
  const [customPrompt, setCustomPrompt] = useState('Add 3-piece triptych canvas slicing with 2-inch walnut frame borders');
  const [status, setStatus] = useState<'idle' | 'analyzing' | 'splicing' | 'ready'>('idle');
  const [terminalLogs, setTerminalLogs] = useState<string[]>([
    "$ slop status --worktree",
    "[SLOPSHOP] Worktree initialized at /tmp/slop-worktree-8910",
    "[AST] Base TypeScript AST loaded: 148 nodes parsed",
    "[STORAGE] Local SQLite snapshot mounted: /data/app.sqlite (WAL active)"
  ]);

  const activeOpId = useRef<number>(0);
  const timersRef = useRef<NodeJS.Timeout[]>([]);

  const clearAllTimers = () => {
    timersRef.current.forEach(t => clearTimeout(t));
    timersRef.current = [];
  };

  useEffect(() => {
    return () => clearAllTimers();
  }, []);

  const handleSelectFeature = (feat: ASTFeaturePackage) => {
    if (status === 'analyzing' || status === 'splicing') return;
    clearAllTimers();
    setSelectedFeature(feat);
    setStatus('idle');
  };

  const handleRunWeld = () => {
    clearAllTimers();
    const opId = Date.now();
    activeOpId.current = opId;

    const validation = validateAstFeature(selectedFeature);
    if (!validation.valid) {
      setTerminalLogs(prev => [...prev, `[ERROR] Invalid feature package: ${validation.errors.join('; ')}`]);
      return;
    }

    setStatus('analyzing');
    setTerminalLogs(prev => [
      ...prev,
      `$ slop weld ${selectedFeature.ref} --prompt="${customPrompt}"`,
      `[ANALYZER] Scanning AST collision boundaries for ${selectedFeature.name}...`
    ]);

    const t1 = setTimeout(() => {
      if (activeOpId.current !== opId) return;
      setStatus('splicing');
      setTerminalLogs(prev => [
        ...prev,
        `[SPLICER] Spliced ${selectedFeature.astNodesAdded} AST nodes into Component tree`,
        `[MIGRATION] Prepared tables: ${selectedFeature.tablesCreated.join(', ')}`,
        `[EVIDENCE] Running 4/4 automated AST & SQLite test assertions...`
      ]);

      const t2 = setTimeout(() => {
        if (activeOpId.current !== opId) return;
        setStatus('ready');
        setTerminalLogs(prev => [
          ...prev,
          `[EVIDENCE] 100% test assertions passed in 0.04s`,
          `[GITSMITH] CAS target ref updated: refs/heads/mod-${selectedFeature.id} -> 4e10bc9`,
          `[RIG.EXE] Ephemeral portal bound on port 3002. Ready to launch!`
        ]);
      }, 1200);
      timersRef.current.push(t2);
    }, 800);
    timersRef.current.push(t1);
  };

  return (
    <div className="grid grid-cols-12 gap-3 h-full overflow-hidden font-tahoma text-xs">
      {/* Left AI Modding Bay */}
      <div className="col-span-6 bg-white border-2 border-gray-800 p-3 flex flex-col justify-between overflow-y-auto">
        <div className="space-y-3">
          <div className="border-b pb-2 flex items-center justify-between">
            <span className="font-bold text-sm text-w95-blue flex items-center gap-1.5">
              <Wrench size={16} className="text-blue-700" /> SLOPSHOP AST Feature Speed Shop
            </span>
            <span className="bg-purple-100 text-purple-900 text-[10px] px-2 py-0.5 rounded font-mono font-bold border border-purple-300">
              ● WORKTREE ISOLATED
            </span>
          </div>

          {/* Feature Preset Catalog */}
          <div>
            <label className="font-bold text-gray-800 block mb-1">Select AST Feature Package:</label>
            <div className="space-y-1.5">
              {PRESET_FEATURES.map((feat) => (
                <div
                  key={feat.id}
                  onClick={() => handleSelectFeature(feat)}
                  className={`p-2 border-2 rounded cursor-pointer transition-all ${
                    selectedFeature.id === feat.id
                      ? 'bg-blue-50 border-w95-blue shadow-sm'
                      : 'bg-gray-50 border-gray-300 hover:border-gray-500'
                  } ${status === 'analyzing' || status === 'splicing' ? 'opacity-70 cursor-not-allowed' : ''}`}
                >
                  <div className="flex justify-between items-center mb-0.5">
                    <span className="font-bold text-gray-900 flex items-center gap-1">
                      <GitBranch size={12} className="text-purple-700" /> {feat.name}
                    </span>
                    <span className="font-mono text-[10px] bg-green-100 text-green-800 px-1.5 py-0.2 rounded font-bold">
                      {feat.cleanlinessScore}% Clean
                    </span>
                  </div>
                  <p className="text-gray-600 text-[11px]">{feat.description}</p>
                  <div className="flex gap-2 mt-1 text-[10px] text-gray-500 font-mono">
                    <span>Ref: {feat.ref}</span>
                    <span>&middot;</span>
                    <span>+{feat.astNodesAdded} AST Nodes</span>
                    <span>&middot;</span>
                    <span>Tables: {feat.tablesCreated.join(', ')}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Custom Instruction Box */}
          <div className="bg-gray-50 border-2 border-gray-600 p-2.5 rounded space-y-1.5">
            <label className="font-bold text-gray-800 block text-xs">Custom AI Mechanic Prompt:</label>
            <textarea
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              rows={2}
              disabled={status === 'analyzing' || status === 'splicing'}
              className="w-full p-2 border border-gray-400 font-mono text-xs bg-white resize-none"
            />
            <div className="flex justify-between items-center text-[11px] text-gray-500">
              <span className="flex items-center gap-1 font-bold text-green-800">
                <ShieldCheck size={13} /> Zero Local Port Collisions Guaranteed
              </span>
              <button
                onClick={handleRunWeld}
                disabled={status === 'analyzing' || status === 'splicing'}
                className="btn-w95 btn-w95-primary px-3 py-1.5 flex items-center gap-1 font-bold"
              >
                <Sparkles size={12} /> {status === 'idle' ? 'Weld Feature & Mod →' : status === 'ready' ? 'Re-Weld Feature' : 'Splicing AST...'}
              </button>
            </div>
          </div>

          {/* Modding Pipeline Progress */}
          {status !== 'idle' && (
            <div className="bg-blue-50 border-2 border-w95-blue p-3 space-y-2 rounded">
              <div className="font-bold text-w95-blue flex items-center gap-1.5">
                <Layers size={14} /> AST Splicing Pipeline Verification
              </div>
              <div className="space-y-1 text-[11px] font-mono">
                <div className="flex items-center gap-1.5 text-green-700">
                  <CheckCircle2 size={12} /> [1/4] Parsed TypeScript AST ({selectedFeature.astNodesAdded} nodes injected, 0 collisions)
                </div>
                <div className={`flex items-center gap-1.5 ${status !== 'analyzing' ? 'text-green-700' : 'text-blue-700 animate-pulse'}`}>
                  <CheckCircle2 size={12} /> [2/4] Spliced {selectedFeature.ref}
                </div>
                <div className={`flex items-center gap-1.5 ${status === 'ready' ? 'text-green-700' : 'text-gray-400'}`}>
                  <CheckCircle2 size={12} /> [3/4] Applied SQLite schema ({selectedFeature.tablesCreated.join(', ')})
                </div>
                <div className={`flex items-center gap-1.5 ${status === 'ready' ? 'text-green-700' : 'text-gray-400'}`}>
                  <CheckCircle2 size={12} /> [4/4] Automated tests passed (4/4 assertions green)
                </div>
              </div>

              {status === 'ready' && (
                <div className="pt-2 border-t border-blue-200 flex justify-between items-center">
                  <span className="text-green-800 font-bold">✔ Welded Build Verified &amp; Ready</span>
                  <button
                    onClick={() => alert(`Launching ephemeral RIG for ${selectedFeature.name} on port 3002!`)}
                    className="btn-w95 btn-w95-primary px-3 py-1 font-bold flex items-center gap-1 shadow-md"
                  >
                    <Play size={12} /> Launch Welded Rig &rarr;
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right Terminal & AST Worktree Log */}
      <div className="col-span-6 bg-black text-green-400 border-2 border-gray-800 p-3 font-mono text-xs flex flex-col justify-between overflow-y-auto">
        <div>
          <div className="text-gray-500 border-b border-gray-800 pb-1.5 mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-yellow-400">
              <Terminal size={14} /> SLOPSHOP ISOLATED WORKTREE TERMINAL
            </span>
            <span className="text-[10px] text-gray-500 font-sans">AST Engine v4.2</span>
          </div>
          <div className="space-y-1 overflow-y-auto max-h-[380px] pr-1 leading-relaxed">
            {terminalLogs.map((log, idx) => (
              <div
                key={idx}
                className={`${
                  log.includes('[EVIDENCE]') || log.includes('[RIG.EXE]')
                    ? 'text-yellow-300 font-bold'
                    : log.includes('$')
                    ? 'text-white font-bold'
                    : ''
                }`}
              >
                {log}
              </div>
            ))}
          </div>
        </div>

        <div className="pt-2 border-t border-gray-800 flex justify-between items-center text-[10px] text-gray-500 font-sans">
          <span>✔ Isolated Worktree &middot; Zero Lock Contentions</span>
          <span className="text-green-400 font-mono font-bold">AST STATUS: CLEAN</span>
        </div>
      </div>
    </div>
  );
};
