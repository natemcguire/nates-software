import React, { useState } from 'react';
import { Wrench, Sparkles, Terminal, CheckCircle2, Layers } from 'lucide-react';

export const SlopshopView: React.FC = () => {
  const [modPrompt, setModPrompt] = useState('Add OCR receipt scanner button to the main calculator header');
  const [status, setStatus] = useState<'idle' | 'analyzing' | 'splicing' | 'ready'>('idle');

  const handleRunMod = () => {
    setStatus('analyzing');
    setTimeout(() => {
      setStatus('splicing');
      setTimeout(() => {
        setStatus('ready');
      }, 1200);
    }, 800);
  };

  return (
    <div className="grid grid-cols-12 gap-3 h-full overflow-hidden font-tahoma text-xs">
      {/* Left AI Modding Bay */}
      <div className="col-span-6 bg-white border-2 border-gray-800 p-3 flex flex-col overflow-y-auto">
        <div className="border-b pb-2 mb-2 flex items-center justify-between">
          <span className="font-bold text-sm text-w95-blue flex items-center gap-1.5">
            <Wrench size={16} className="text-blue-700" /> AI Speed Shop (Fork & Mod Engine)
          </span>
          <span className="bg-blue-100 text-blue-900 text-[10px] px-1.5 py-0.5 rounded font-mono font-bold">
            Target: sam/retro-calc
          </span>
        </div>

        <p className="text-gray-600 text-xs mb-3">
          Type what you want to change.
        </p>

        {/* Prompt Box */}
        <div className="bg-gray-50 border-2 border-gray-600 p-2 mb-3">
          <label className="font-bold text-gray-800 block mb-1">Prompt AI Mechanic:</label>
          <textarea
            value={modPrompt}
            onChange={(e) => setModPrompt(e.target.value)}
            rows={3}
            className="w-full p-2 border border-gray-400 font-mono text-xs bg-white resize-none"
          />
          <div className="flex justify-between items-center mt-2">
            <div className="flex gap-1 text-[11px] text-gray-500">
              <span className="bg-gray-200 px-1 py-0.5 rounded font-mono">AST v4.2</span>
              <span className="bg-gray-200 px-1 py-0.5 rounded font-mono">Claude 3.7 / GPT-5.6</span>
            </div>
            <button
              onClick={handleRunMod}
              disabled={status === 'analyzing' || status === 'splicing'}
              className="btn-w95 btn-w95-primary px-3 py-1.5 flex items-center gap-1"
            >
              <Sparkles size={12} /> {status === 'idle' ? 'Weld Feature & Mod →' : 'Modding AST...'}
            </button>
          </div>
        </div>

        {/* Modding Pipeline Progress */}
        {status !== 'idle' && (
          <div className="bg-blue-50 border-2 border-w95-blue p-3 space-y-2 rounded">
            <div className="font-bold text-w95-blue flex items-center gap-1.5">
              <Layers size={14} /> AST Splicing Pipeline
            </div>
            <div className="space-y-1 text-[11px] font-mono">
              <div className="flex items-center gap-1.5 text-green-700">
                <CheckCircle2 size={12} /> [1/4] Parsed TypeScript AST (0 collisions)
              </div>
              <div className={`flex items-center gap-1.5 ${status !== 'analyzing' ? 'text-green-700' : 'text-blue-700 animate-pulse'}`}>
                <CheckCircle2 size={12} /> [2/4] Spliced refs/features/receipt-ocr@v2
              </div>
              <div className={`flex items-center gap-1.5 ${status === 'ready' ? 'text-green-700' : 'text-gray-400'}`}>
                <CheckCircle2 size={12} /> [3/4] Applied SQLite migration (004_receipts.sql)
              </div>
              <div className={`flex items-center gap-1.5 ${status === 'ready' ? 'text-green-700' : 'text-gray-400'}`}>
                <CheckCircle2 size={12} /> [4/4] Test suite passed (4/4 assertions)
              </div>
            </div>

            {status === 'ready' && (
              <div className="pt-2 border-t border-blue-200 flex justify-between items-center">
                <span className="text-green-800 font-bold">✔ Build Ready for Launch</span>
                <button className="btn-w95 btn-w95-primary px-3 py-1 font-bold">
                  LAUNCH YOUR RIG (Build Site)
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right Terminal & AST Worktree Log */}
      <div className="col-span-6 bg-black text-green-400 border-2 border-gray-800 p-3 font-mono text-xs flex flex-col overflow-y-auto">
        <div className="text-gray-500 border-b border-gray-800 pb-1 mb-2 flex items-center gap-1.5">
          <Terminal size={14} /> SLOPSHOP ISOLATED WORKTREE TERMINAL
        </div>
        <div className="flex-1 space-y-1 leading-relaxed">
          <div>$ slop fork sam/retro-calc --open=claude</div>
          <div className="text-gray-400">[SLOPSHOP] Created bare worktree at /tmp/slop-worktree-8910</div>
          <div className="text-gray-400">[SLOPSHOP] Mounting local SQLite snapshot /data/app.sqlite (WAL mode)</div>
          <div className="text-yellow-300">&gt; Target AST nodes detected: 48 declarations, 12 hooks</div>
          <div className="text-green-300">&gt; Weld ref: refs/features/receipt-ocr@v2 (commit: 8f4a21)</div>
          <div className="text-green-300">&gt; CAS compare-and-swap ref updated to 4e10bc9</div>
          <div className="text-blue-300">&gt; Port 3001 bound cleanly.</div>
        </div>
      </div>
    </div>
  );
};
