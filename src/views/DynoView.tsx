import React, { useState } from 'react';
import { Gauge, Download, Copy, Check, ShieldCheck, Play } from 'lucide-react';

export const DynoView: React.FC = () => {
  const [copiedCurl, setCopiedCurl] = useState(false);
  const [copiedBadge, setCopiedBadge] = useState(false);
  const [syncToCloud, setSyncToCloud] = useState(true);
  const [isRunningPass, setIsRunningPass] = useState(false);
  const [benchScore, setBenchScore] = useState<{
    tokPerSec: number;
    cacheHit: string;
    vram: string;
    recall: string;
    badge: string;
  }>({
    tokPerSec: 167,
    cacheHit: '94.8%',
    vram: '18.4 GB / 64 GB',
    recall: '128k (99.2% recall)',
    badge: 'M4 Max · 167 tok/s · Grade A+'
  });

  const curlCommand = 'curl -fsSL https://nates.software/install-dyno.sh | sh';

  const copyCurl = () => {
    navigator.clipboard.writeText(curlCommand);
    setCopiedCurl(true);
    setTimeout(() => setCopiedCurl(false), 2000);
  };

  const copyBadge = () => {
    navigator.clipboard.writeText(`[![Nate's Dyno Score](https://dyno.natesoftware.com/badge/nate.svg)](https://nates-software.pages.dev)`);
    setCopiedBadge(true);
    setTimeout(() => setCopiedBadge(false), 2000);
  };

  const triggerLivePass = () => {
    setIsRunningPass(true);
    let count = 0;
    const interval = setInterval(() => {
      count++;
      setBenchScore(prev => ({
        ...prev,
        tokPerSec: Math.floor(140 + Math.random() * 45)
      }));
      if (count > 7) {
        clearInterval(interval);
        setIsRunningPass(false);
      }
    }, 200);
  };

  return (
    <div className="grid grid-cols-12 gap-3 h-full overflow-hidden font-tahoma text-sm">
      {/* Left Column: Download & How It Works Flow */}
      <div className="col-span-6 bg-white border-2 border-gray-800 p-4 flex flex-col justify-between overflow-y-auto">
        <div className="space-y-3">
          <div className="border-b pb-2 flex items-center justify-between">
            <span className="font-bold text-base text-w95-blue flex items-center gap-2">
              <Gauge size={20} className="text-red-600" /> DYNO — AI Workstation Benchmarker
            </span>
            <span className="bg-green-100 text-green-800 text-[11px] font-mono font-bold px-2 py-0.5 rounded border border-green-300">
              v1.0.4 Native CLI
            </span>
          </div>

          <p className="text-gray-700 text-xs leading-relaxed">
            <b>DYNO</b> is a standalone native command-line tool and macOS menu bar utility that measures your workstation's real AI throughput, context recall depth, and prompt cache hit rates across local models (Ollama/MLX/vLLM) and remote APIs (Claude/Codex).
          </p>

          {/* Setup Step 1 */}
          <div className="bg-blue-50 border-2 border-w95-blue p-3 rounded space-y-2">
            <div className="font-bold text-w95-blue text-xs flex items-center gap-1.5">
              <span className="bg-w95-blue text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px]">1</span>
              Install the DYNO CLI on your machine:
            </div>

            {/* Quick Curl Box */}
            <div className="flex items-center gap-1 bg-black text-green-400 p-2 font-mono text-xs rounded border border-gray-700">
              <span className="text-gray-500">$</span>
              <span className="flex-1 truncate">{curlCommand}</span>
              <button
                onClick={copyCurl}
                className="bg-gray-800 hover:bg-gray-700 text-gray-200 px-2 py-0.5 rounded text-[10px] font-sans flex items-center gap-1 shrink-0"
              >
                {copiedCurl ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
                {copiedCurl ? 'Copied' : 'Copy'}
              </button>
            </div>

            {/* Native Binary Download Buttons */}
            <div className="flex gap-1.5 pt-1 flex-wrap">
              <a
                href="#download-mac"
                onClick={(e) => { e.preventDefault(); alert('Downloading dyno-mac-arm64 binary...'); }}
                className="btn-w95 text-xs py-1 px-2 flex items-center gap-1"
              >
                <Download size={12} /> 🍎 macOS (Apple Silicon)
              </a>
              <a
                href="#download-win"
                onClick={(e) => { e.preventDefault(); alert('Downloading dyno-win-x64.exe installer...'); }}
                className="btn-w95 text-xs py-1 px-2 flex items-center gap-1"
              >
                <Download size={12} /> 🪟 Windows (.exe)
              </a>
              <a
                href="#download-linux"
                onClick={(e) => { e.preventDefault(); alert('Downloading dyno-linux-x64 binary...'); }}
                className="btn-w95 text-xs py-1 px-2 flex items-center gap-1"
              >
                <Download size={12} /> 🐧 Linux x64
              </a>
            </div>
          </div>

          {/* Setup Step 2 */}
          <div className="bg-gray-50 border border-gray-300 p-3 rounded space-y-1.5">
            <div className="font-bold text-gray-800 text-xs flex items-center gap-1.5">
              <span className="bg-gray-700 text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px]">2</span>
              Run a local benchmark pass:
            </div>
            <p className="text-gray-600 text-xs">
              In your terminal, run <code className="bg-gray-200 px-1 py-0.5 rounded font-mono text-black font-bold">dyno pass --all</code> to test token generation speed, TTFT cache latency, and 128k needle retrieval.
            </p>
          </div>

          {/* Setup Step 3 */}
          <div className="bg-gray-50 border border-gray-300 p-3 rounded space-y-1.5">
            <div className="font-bold text-gray-800 text-xs flex items-center gap-1.5">
              <span className="bg-gray-700 text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px]">3</span>
              Sync Results to Account (Optional):
            </div>
            <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-700 pt-1">
              <input
                type="checkbox"
                checked={syncToCloud}
                onChange={(e) => setSyncToCloud(e.target.checked)}
                className="w-4 h-4"
              />
              <span>Sync verified Dyno badge to your <b>@nate</b> maker profile on HOTWIRE</span>
            </label>
            <div className="text-[11px] text-gray-500 flex items-center gap-1">
              <ShieldCheck size={12} className="text-green-700" />
              {syncToCloud
                ? 'Your verified hardware score is synced via Cloudflare D1.'
                : '100% sovereign & local: results saved only to ~/.dyno/report.json'}
            </div>
          </div>
        </div>

        {/* Footer trigger button */}
        <div className="pt-3 border-t border-gray-300">
          <button
            onClick={triggerLivePass}
            disabled={isRunningPass}
            className="btn-w95 btn-w95-primary w-full py-2 text-xs flex items-center justify-center gap-1.5 font-bold"
          >
            <Play size={13} /> {isRunningPass ? 'RUNNING TEST PASS (10s)...' : 'SIMULATE / PREVIEW LOCAL DYNO PASS'}
          </button>
        </div>
      </div>

      {/* Right Column: Live Benchmark Diagnostics & Embed Badge */}
      <div className="col-span-6 bg-white border-2 border-gray-800 p-4 flex flex-col justify-between overflow-y-auto">
        <div className="space-y-3">
          <div className="border-b pb-2 flex items-center justify-between">
            <span className="font-bold text-base text-w95-blue">
              📊 Verified Workstation Scorecard
            </span>
            <span className="bg-red-100 text-red-800 text-xs font-mono font-bold px-2 py-0.5 rounded border border-red-300">
              {benchScore.badge}
            </span>
          </div>

          {/* Speedometer Telemetry Card */}
          <div className="bg-gray-900 text-green-400 p-4 rounded border-2 border-gray-700 shadow-inner text-center">
            <div className="text-[11px] text-gray-400 font-mono uppercase tracking-widest mb-1">
              Token Generation Throughput
            </div>
            <div className="text-5xl font-mono font-black text-yellow-400 tracking-tight my-1.5">
              {benchScore.tokPerSec} <span className="text-lg text-gray-400 font-normal">tok/s</span>
            </div>
            <div className="w-full bg-gray-700 h-2.5 rounded overflow-hidden mt-2">
              <div
                style={{ width: `${Math.min(100, (benchScore.tokPerSec / 200) * 100)}%` }}
                className="bg-gradient-to-r from-green-500 via-yellow-400 to-red-500 h-full transition-all duration-200"
              />
            </div>
          </div>

          {/* Metrics List */}
          <div className="space-y-2">
            <div className="bg-gray-50 border border-gray-300 p-2.5 rounded flex justify-between items-center">
              <div>
                <span className="font-bold text-gray-800 text-xs block">⚡ Prompt Cache Hit Rate:</span>
                <span className="text-[11px] text-gray-500">Sub-50ms TTFT via prefix caching</span>
              </div>
              <span className="font-bold text-green-700 font-mono text-sm">{benchScore.cacheHit}</span>
            </div>

            <div className="bg-gray-50 border border-gray-300 p-2.5 rounded flex justify-between items-center">
              <div>
                <span className="font-bold text-gray-800 text-xs block">💾 Unified Memory / VRAM:</span>
                <span className="text-[11px] text-gray-500">Active KV cache for local models</span>
              </div>
              <span className="font-bold text-blue-800 font-mono text-sm">{benchScore.vram}</span>
            </div>

            <div className="bg-gray-50 border border-gray-300 p-2.5 rounded flex justify-between items-center">
              <div>
                <span className="font-bold text-gray-800 text-xs block">🎯 Needle-In-A-Haystack:</span>
                <span className="text-[11px] text-gray-500">Zero loss across 128k context</span>
              </div>
              <span className="font-bold text-green-700 font-mono text-sm">{benchScore.recall}</span>
            </div>
          </div>
        </div>

        {/* Shareable Badge Box */}
        <div className="bg-blue-50 border-2 border-w95-blue p-3 rounded space-y-2 mt-2">
          <div className="flex items-center justify-between">
            <span className="font-bold text-w95-blue text-xs">Embed Verified Badge on GitHub:</span>
            <button
              onClick={copyBadge}
              className="btn-w95 text-xs py-0.5 px-2 flex items-center gap-1"
            >
              {copiedBadge ? <Check size={11} className="text-green-600" /> : <Copy size={11} />}
              {copiedBadge ? 'Copied Markdown' : 'Copy Badge Markdown'}
            </button>
          </div>
          <div className="bg-white p-2 border border-gray-300 rounded font-mono text-[11px] text-gray-700 truncate">
            [![Nate's Dyno Score](https://dyno.natesoftware.com/badge/nate.svg)](https://nates-software.pages.dev)
          </div>
        </div>
      </div>
    </div>
  );
};
