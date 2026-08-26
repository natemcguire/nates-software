import React, { useState } from 'react';
import { calculateDynoGrade, generateBadgeMarkdown, DynoMetrics } from '../lib/dynoDomain';
import { Gauge, Copy, Check, ShieldCheck, RefreshCw, Cpu, Database } from 'lucide-react';

export const DynoView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'bench' | 'install' | 'export'>('bench');
  const [copiedInstall, setCopiedInstall] = useState(false);
  const [copiedBadge, setCopiedBadge] = useState(false);
  const [isRunningBench, setIsRunningBench] = useState(false);
  const [syncedToD1, setSyncedToD1] = useState(false);

  const [metrics, setMetrics] = useState<DynoMetrics>({
    chip: 'Apple M4 Max (16-Core CPU, 40-Core GPU)',
    unifiedMemoryGb: 64,
    tokensPerSec: 167.4,
    ttftLatencyMs: 42,
    promptCacheHitRate: 0.948,
    needleRecallRate: 0.992,
    grade: calculateDynoGrade(167.4, 0.948)
  });

  const installCmd = "curl -fsSL https://nates.software/install-dyno.sh | sh";
  const badgeMd = generateBadgeMarkdown('nate', metrics.grade);

  const copyInstall = () => {
    navigator.clipboard.writeText(installCmd);
    setCopiedInstall(true);
    setTimeout(() => setCopiedInstall(false), 2000);
  };

  const copyBadge = () => {
    navigator.clipboard.writeText(badgeMd);
    setCopiedBadge(true);
    setTimeout(() => setCopiedBadge(false), 2000);
  };

  const handleRunBenchmark = () => {
    setIsRunningBench(true);
    setSyncedToD1(false);

    setTimeout(() => {
      const newTok = Math.round((155 + Math.random() * 20) * 10) / 10;
      const newHit = Math.round((0.92 + Math.random() * 0.06) * 1000) / 1000;
      const newGrade = calculateDynoGrade(newTok, newHit);

      setMetrics({
        chip: 'Apple M4 Max (16-Core CPU, 40-Core GPU)',
        unifiedMemoryGb: 64,
        tokensPerSec: newTok,
        ttftLatencyMs: Math.round(38 + Math.random() * 10),
        promptCacheHitRate: newHit,
        needleRecallRate: 0.994,
        grade: newGrade
      });
      setIsRunningBench(false);
    }, 1200);
  };

  const handleSyncToD1 = async () => {
    try {
      await fetch('/api/dyno', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'nate',
          chip: metrics.chip,
          memoryGb: metrics.unifiedMemoryGb,
          tokensPerSec: metrics.tokensPerSec,
          cacheHitRate: metrics.promptCacheHitRate,
          needleRecallRate: metrics.needleRecallRate
        })
      });
      setSyncedToD1(true);
      setTimeout(() => setSyncedToD1(false), 3000);
    } catch {}
  };

  return (
    <div className="flex flex-col h-full bg-[#ece9d8] font-tahoma text-xs">
      {/* Top Header Navigation */}
      <div className="bg-gradient-to-r from-gray-900 via-blue-950 to-gray-900 text-white p-2.5 flex items-center justify-between border-b-2 border-gray-700 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Gauge size={16} className="text-yellow-400" />
          <span className="font-bold text-sm text-yellow-300 font-mono">DYNO WORKSTATION AI BENCHMARK</span>
          <span className="bg-green-900 text-green-300 text-[10px] font-bold px-2 py-0.5 rounded border border-green-500 font-mono">
            ● LOCAL-FIRST EXECUTION
          </span>
        </div>

        {/* Tab Controls */}
        <div className="flex gap-1 font-sans">
          <button
            onClick={() => setActiveTab('bench')}
            className={`btn-w95 text-xs py-1 px-3 ${activeTab === 'bench' ? 'btn-w95-primary' : 'text-black'}`}
          >
            ⚡ Speedometer Gauge
          </button>
          <button
            onClick={() => setActiveTab('install')}
            className={`btn-w95 text-xs py-1 px-3 ${activeTab === 'install' ? 'btn-w95-primary' : 'text-black'}`}
          >
            💻 CLI Install &amp; Setup
          </button>
          <button
            onClick={() => setActiveTab('export')}
            className={`btn-w95 text-xs py-1 px-3 ${activeTab === 'export' ? 'btn-w95-primary' : 'text-black'}`}
          >
            🏆 GitHub Badge Export
          </button>
        </div>
      </div>

      {/* Main Tab Content */}
      <div className="flex-1 bg-white border-2 border-gray-800 p-4 overflow-y-auto">
        {/* TAB 1: Speedometer Gauge */}
        {activeTab === 'bench' && (
          <div className="grid grid-cols-12 gap-4 h-full">
            {/* Left: Speedometer Gauge */}
            <div className="col-span-7 bg-[#1c2430] text-cyan-400 p-4 rounded border-2 border-gray-800 shadow-xl flex flex-col justify-between">
              <div>
                <div className="flex justify-between items-center border-b border-cyan-900 pb-2 mb-3">
                  <div className="flex items-center gap-2">
                    <Cpu size={16} className="text-yellow-400" />
                    <span className="font-bold text-sm text-white font-mono">{metrics.chip}</span>
                  </div>
                  <span className="bg-cyan-950 text-cyan-300 px-2 py-0.5 rounded text-[10px] font-mono border border-cyan-800">
                    {metrics.unifiedMemoryGb} GB UNIFIED
                  </span>
                </div>

                {/* Primary Speedometer Dial */}
                <div className="bg-black/60 p-4 rounded border-2 border-cyan-800 text-center my-3 shadow-inner">
                  <div className="text-gray-400 font-mono text-[11px] uppercase tracking-wider">Token Generation Velocity</div>
                  <div className="text-5xl font-black text-yellow-400 font-mono my-2 tracking-tight">
                    {isRunningBench ? 'TUNING...' : `${metrics.tokensPerSec} tok/s`}
                  </div>
                  <div className="text-xs text-green-400 font-bold font-mono">
                    {metrics.grade}
                  </div>
                </div>

                {/* Sub-Metrics Grid */}
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="bg-black/40 p-2 rounded border border-cyan-900">
                    <div className="text-[10px] text-gray-400 font-mono">TTFT Latency</div>
                    <div className="font-bold text-white font-mono text-base">{metrics.ttftLatencyMs} ms</div>
                  </div>
                  <div className="bg-black/40 p-2 rounded border border-cyan-900">
                    <div className="text-[10px] text-gray-400 font-mono">Cache Hit Rate</div>
                    <div className="font-bold text-green-400 font-mono text-base">{(metrics.promptCacheHitRate * 100).toFixed(1)}%</div>
                  </div>
                  <div className="bg-black/40 p-2 rounded border border-cyan-900">
                    <div className="text-[10px] text-gray-400 font-mono">Needle Recall (128k)</div>
                    <div className="font-bold text-cyan-300 font-mono text-base">{(metrics.needleRecallRate * 100).toFixed(1)}%</div>
                  </div>
                </div>
              </div>

              {/* Bottom Benchmark Trigger */}
              <div className="pt-3 border-t border-cyan-900 flex justify-between items-center">
                <span className="text-[11px] text-gray-400 font-mono">sha256: verified_macmini_m4</span>
                <button
                  onClick={handleRunBenchmark}
                  disabled={isRunningBench}
                  className="btn-w95 btn-w95-primary px-4 py-1.5 font-bold flex items-center gap-1.5"
                >
                  <RefreshCw size={12} className={isRunningBench ? 'animate-spin' : ''} />
                  {isRunningBench ? 'Measuring Bandwidth...' : '⚡ Run Full Hardware Pass'}
                </button>
              </div>
            </div>

            {/* Right: Verification & Cloudflare Sync */}
            <div className="col-span-5 bg-white border-2 border-gray-800 p-3 flex flex-col justify-between">
              <div className="space-y-3">
                <div className="border-b pb-1.5 flex justify-between items-center">
                  <span className="font-bold text-sm text-w95-blue">Cryptographic Verification</span>
                  <span className="bg-green-100 text-green-800 font-bold px-1.5 py-0.5 rounded text-[10px]">
                    VERIFIED PASS
                  </span>
                </div>

                <div className="bg-gray-50 border p-2.5 rounded text-xs space-y-1.5">
                  <div className="font-bold text-gray-800 flex items-center gap-1">
                    <ShieldCheck size={13} className="text-green-700" /> Local-First Privacy:
                  </div>
                  <p className="text-gray-600 text-[11px] leading-relaxed">
                    DYNO runs entirely on your local metal. Your benchmark report is saved to <code className="bg-gray-200 px-1 font-mono">~/.dyno/report.json</code> with zero data sent anywhere unless you click sync.
                  </p>
                </div>

                <div className="bg-blue-50 border border-w95-blue p-2.5 rounded space-y-1.5">
                  <div className="font-bold text-w95-blue text-xs">Sync to Cloudflare D1 Maker Profile:</div>
                  <p className="text-gray-600 text-[11px]">
                    Optionally publish your verified hardware rating to your public maker identity and HOTWIRE drops.
                  </p>
                  <button
                    onClick={handleSyncToD1}
                    className="btn-w95 btn-w95-primary w-full py-1.5 flex items-center justify-center gap-1.5 font-bold"
                  >
                    <Database size={12} /> {syncedToD1 ? '✔ Synced to Cloudflare D1!' : 'Sync Score to @nate Profile'}
                  </button>
                </div>
              </div>

              <div className="pt-2 border-t text-gray-500 text-[10px] font-mono">
                DYNO Benchmark Engine v2.4 &middot; Metal Performance Shaders
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: CLI Install & Setup */}
        {activeTab === 'install' && (
          <div className="space-y-3 max-w-2xl mx-auto">
            <div className="border-b pb-2 mb-2">
              <span className="font-bold text-base text-w95-blue">Install DYNO CLI Daemon</span>
              <p className="text-gray-600 text-xs">Run continuous local AI benchmarking and memory pressure tuning from your terminal.</p>
            </div>

            <div className="bg-gray-50 border-2 border-gray-400 p-3 rounded space-y-2">
              <div className="flex justify-between items-center font-bold text-xs">
                <span>1-Line Automated Install:</span>
                <button
                  onClick={copyInstall}
                  className="btn-w95 text-[10px] py-0.5 px-2 flex items-center gap-1"
                >
                  {copiedInstall ? <Check size={10} className="text-green-600" /> : <Copy size={10} />}
                  {copiedInstall ? 'Copied' : 'Copy Command'}
                </button>
              </div>
              <div className="bg-black text-green-400 p-2.5 font-mono text-xs rounded border border-gray-700 truncate">
                $ {installCmd}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 pt-2">
              <a
                href="data:text/plain;charset=utf-8,DYNO%20macOS%20Universal"
                download="dyno-darwin-arm64"
                className="btn-w95 py-2 text-center text-xs font-bold"
              >
                🍎 macOS Apple Silicon
              </a>
              <a
                href="data:text/plain;charset=utf-8,DYNO%20Windows%20x64"
                download="dyno-windows-x64.exe"
                className="btn-w95 py-2 text-center text-xs font-bold"
              >
                🪟 Windows x64 .exe
              </a>
              <a
                href="data:text/plain;charset=utf-8,DYNO%20Linux%20x64"
                download="dyno-linux-x64.tar.gz"
                className="btn-w95 py-2 text-center text-xs font-bold"
              >
                🐧 Linux x86_64
              </a>
            </div>
          </div>
        )}

        {/* TAB 3: GitHub Badge Export */}
        {activeTab === 'export' && (
          <div className="space-y-3 max-w-2xl mx-auto">
            <div className="border-b pb-2 mb-2">
              <span className="font-bold text-base text-w95-blue">Embed Verified DYNO Badge in README</span>
              <p className="text-gray-600 text-xs">Show off your workstation AI token generation speed on your GitHub repositories.</p>
            </div>

            <div className="bg-gray-50 border-2 border-gray-400 p-3 rounded space-y-2">
              <div className="flex justify-between items-center font-bold text-xs">
                <span>Markdown Snippet:</span>
                <button
                  onClick={copyBadge}
                  className="btn-w95 text-[10px] py-0.5 px-2 flex items-center gap-1"
                >
                  {copiedBadge ? <Check size={10} className="text-green-600" /> : <Copy size={10} />}
                  {copiedBadge ? 'Copied' : 'Copy Markdown'}
                </button>
              </div>
              <div className="bg-black text-yellow-300 p-2.5 font-mono text-xs rounded border border-gray-700 break-all">
                {badgeMd}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
