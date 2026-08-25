import React, { useState } from 'react';
import { Cpu, Download, ShieldCheck, Terminal, Copy, Check, Play } from 'lucide-react';

export const RigRuntimeView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'onboard' | 'fleet' | 'storage'>('onboard');
  const [copiedRemote, setCopiedRemote] = useState(false);
  const [copiedPush, setCopiedPush] = useState(false);
  const [isBuilding, setIsBuilding] = useState(false);
  const [buildLogs, setBuildLogs] = useState<string[]>([
    "[GITSMITH] Hook post-receive initialized for repo: nate/wallart",
    "[RIG.EXE] Allocated isolated Linux micro-container (ID: rig-98a412)",
    "[RIG.EXE] Mounted sovereign volume: /data/wallart.sqlite (WAL mode)",
    "[BUILD] Running: npm run build (Vite 6 + React 19 + Tailwind)",
    "[BUILD] Transformed 1,835 modules in 1.25s -> dist/ (374 kB JS, 31 kB CSS)",
    "[PORTAL] Booted ephemeral dev server on port 3002 (dyno://nate/wallart:3002)",
    "[TESTS] Irrefutable Evidence Pass: 500 SQLite simulated writes verified in 0.04s",
    "[STATUS] ● Ephemeral build live and ready for testing."
  ]);

  const remoteCmd = "git remote add nate git@gitsmith.dev:nate/wallart.git";
  const pushCmd = "git push nate main";

  const copyRemote = () => {
    navigator.clipboard.writeText(remoteCmd);
    setCopiedRemote(true);
    setTimeout(() => setCopiedRemote(false), 2000);
  };

  const copyPush = () => {
    navigator.clipboard.writeText(pushCmd);
    setCopiedPush(true);
    setTimeout(() => setCopiedPush(false), 2000);
  };

  const runSimulatedPush = () => {
    setIsBuilding(true);
    setBuildLogs(["[GITSMITH] Receiving objects: 100% (142/142)..."]);
    
    const steps = [
      "[GITSMITH] CAS atomic update: refs/heads/main -> 5c030af (OK)",
      "[RIG.EXE] Spinning up isolated micro-container (CPU limit: 2 cores, RAM limit: 256MB)",
      "[STORAGE] Initialized SQLite WAL volume at /data/wallart.sqlite",
      "[BUILD] Compiling TypeScript AST & bundling assets with Vite 6...",
      "[BUILD] Build complete in 1.18s! Bundle size: 374 kB JS",
      "[EVIDENCE] Running 10k SQLite stress tests & visual regression checks...",
      "[EVIDENCE] Irrefutable Evidence: 100% test pass rate, 0 lock contentions, <0.08ms latency",
      "[PORTAL] Live Ephemeral URL: https://wallart-nate.rig.nates.software (Port 3002)",
      "[HOTWIRE] Submitted build to 12:01 AM Daily Drops Board (Batch #84)"
    ];

    steps.forEach((step, idx) => {
      setTimeout(() => {
        setBuildLogs(prev => [...prev, step]);
        if (idx === steps.length - 1) setIsBuilding(false);
      }, (idx + 1) * 350);
    });
  };

  return (
    <div className="flex flex-col h-full bg-[#ece9d8] font-tahoma text-xs">
      {/* Top Header Navigation */}
      <div className="bg-gradient-to-r from-gray-900 via-blue-950 to-gray-900 text-white p-2.5 flex items-center justify-between border-b-2 border-gray-700">
        <div className="flex items-center gap-2">
          <Cpu size={16} className="text-green-400" />
          <span className="font-bold text-sm text-green-300 font-mono">RIG.EXE BUILDER &amp; EPHEMERAL FLEET</span>
          <span className="bg-green-900 text-green-300 text-[10px] font-bold px-2 py-0.5 rounded border border-green-500 font-mono">
            ● 3 FLEET CONTAINERS ACTIVE
          </span>
        </div>

        {/* Tab Controls */}
        <div className="flex gap-1 font-sans">
          <button
            onClick={() => setActiveTab('onboard')}
            className={`btn-w95 text-xs py-1 px-3 ${activeTab === 'onboard' ? 'btn-w95-primary' : 'text-black'}`}
          >
            🚀 Onboard &amp; Push
          </button>
          <button
            onClick={() => setActiveTab('fleet')}
            className={`btn-w95 text-xs py-1 px-3 ${activeTab === 'fleet' ? 'btn-w95-primary' : 'text-black'}`}
          >
            ⚡ Parallel Fleet (Orbs)
          </button>
          <button
            onClick={() => setActiveTab('storage')}
            className={`btn-w95 text-xs py-1 px-3 ${activeTab === 'storage' ? 'btn-w95-primary' : 'text-black'}`}
          >
            💾 SQLite Storage &amp; WAL
          </button>
        </div>
      </div>

      {/* Main Tab Content */}
      <div className="flex-1 bg-white border-2 border-gray-800 p-4 overflow-y-auto">
        {/* TAB 1: Onboard New Project & Push Remote */}
        {activeTab === 'onboard' && (
          <div className="grid grid-cols-12 gap-4 h-full">
            {/* Left: Setup Instructions */}
            <div className="col-span-6 space-y-3 flex flex-col justify-between">
              <div>
                <div className="border-b pb-2 mb-2">
                  <span className="font-bold text-sm text-w95-blue">Connect Your Codebase to RIG.EXE</span>
                  <p className="text-gray-600 text-xs">
                    Push any local repository to your sovereign Git forge remote. RIG.EXE automatically allocates an isolated cloud container, mounts your single-file SQLite database, and boots your live ephemeral portal.
                  </p>
                </div>

                {/* Step 1 */}
                <div className="bg-gray-50 border border-gray-300 p-2.5 rounded space-y-1.5 mb-2.5">
                  <div className="font-bold text-gray-900 flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <span className="bg-w95-blue text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px]">1</span>
                      Add Git Remote:
                    </span>
                    <button
                      onClick={copyRemote}
                      className="btn-w95 text-[10px] py-0.5 px-2 flex items-center gap-1"
                    >
                      {copiedRemote ? <Check size={10} className="text-green-600" /> : <Copy size={10} />}
                      {copiedRemote ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <div className="bg-black text-green-400 p-2 font-mono text-[11px] rounded border border-gray-700 truncate">
                    $ {remoteCmd}
                  </div>
                </div>

                {/* Step 2 */}
                <div className="bg-gray-50 border border-gray-300 p-2.5 rounded space-y-1.5 mb-2.5">
                  <div className="font-bold text-gray-900 flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <span className="bg-w95-blue text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px]">2</span>
                      Push Code &amp; Trigger Ephemeral Build:
                    </span>
                    <button
                      onClick={copyPush}
                      className="btn-w95 text-[10px] py-0.5 px-2 flex items-center gap-1"
                    >
                      {copiedPush ? <Check size={10} className="text-green-600" /> : <Copy size={10} />}
                      {copiedPush ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <div className="bg-black text-green-400 p-2 font-mono text-[11px] rounded border border-gray-700 truncate">
                    $ {pushCmd}
                  </div>
                </div>

                {/* Step 3: Irrefutable Evidence Guarantee */}
                <div className="bg-blue-50 border border-w95-blue p-2.5 rounded space-y-1">
                  <div className="font-bold text-w95-blue flex items-center gap-1">
                    <ShieldCheck size={13} className="text-green-700" /> Automated Build Invariants:
                  </div>
                  <ul className="text-[11px] text-gray-700 list-disc list-inside space-y-0.5">
                    <li>Single-file SQLite WAL mounted at <code className="bg-gray-200 px-1 font-mono">/data/app.sqlite</code></li>
                    <li>Zero port collisions &middot; scale-to-zero micro-container</li>
                    <li>Instant live preview portal &amp; automatic HOTWIRE submission</li>
                  </ul>
                </div>
              </div>

              {/* Action Trigger */}
              <button
                onClick={runSimulatedPush}
                disabled={isBuilding}
                className="btn-w95 btn-w95-primary w-full py-2.5 text-xs flex items-center justify-center gap-2 font-bold shadow-md"
              >
                <Play size={13} /> {isBuilding ? 'BUILDING EPHEMERAL RIG (Vite + SQLite)...' : '⚡ TEST / SIMULATE GIT PUSH BUILD PIPELINE'}
              </button>
            </div>

            {/* Right: Live Build Console HUD */}
            <div className="col-span-6 bg-black text-green-400 p-3 rounded border-2 border-gray-700 flex flex-col justify-between shadow-inner font-mono text-[11px] overflow-hidden">
              <div>
                <div className="flex justify-between items-center border-b border-gray-800 pb-1.5 mb-2 text-gray-400 text-xs">
                  <span className="flex items-center gap-1.5 text-yellow-400">
                    <Terminal size={13} /> RIG.EXE Automated Build Console
                  </span>
                  <span className="text-[10px] text-gray-500 font-sans">Stream at 1000 Baud</span>
                </div>

                <div className="space-y-1 overflow-y-auto max-h-[310px] pr-1">
                  {buildLogs.map((log, idx) => (
                    <div
                      key={idx}
                      className={`leading-relaxed ${
                        log.includes('[EVIDENCE]') || log.includes('[PORTAL]')
                          ? 'text-yellow-300 font-bold'
                          : log.includes('[HOTWIRE]')
                          ? 'text-cyan-300 font-bold'
                          : ''
                      }`}
                    >
                      {log}
                    </div>
                  ))}
                  {isBuilding && <div className="text-gray-400 animate-pulse">_</div>}
                </div>
              </div>

              <div className="pt-2 border-t border-gray-800 flex justify-between items-center text-[10px] text-gray-500 font-sans">
                <span>✔ Git CAS Hook &middot; Zero Lock Contentions</span>
                <span className="text-green-400 font-mono font-bold">EXIT 0 (OK)</span>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: Parallel Fleet (Orbs) */}
        {activeTab === 'fleet' && (
          <div className="space-y-3">
            <div className="border-b pb-2 flex items-center justify-between">
              <div>
                <span className="font-bold text-sm text-w95-blue">Parallel Ephemeral Fleet ("Orbs")</span>
                <p className="text-gray-600 text-xs">
                  Every branch and mod runs on its own isolated micro-VM in the cloud with zero local CPU/port contention.
                </p>
              </div>
              <span className="bg-green-100 text-green-800 font-mono font-bold px-2 py-1 rounded text-xs">
                GPU-Style 10x Parallelism
              </span>
            </div>

            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-w95-blue text-white text-left">
                  <th className="p-2">App / Fork / Task</th>
                  <th className="p-2">Container Port</th>
                  <th className="p-2">Memory / Cap</th>
                  <th className="p-2">SQLite Volume</th>
                  <th className="p-2">Irrefutable Evidence</th>
                  <th className="p-2">Live Portal</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b hover:bg-gray-50">
                  <td className="p-2 font-bold text-w95-blue">nate/wallart (Flagship)</td>
                  <td className="p-2 font-mono">3002</td>
                  <td className="p-2 text-green-700 font-bold font-mono">48 MB / 256 MB</td>
                  <td className="p-2 font-mono">/data/wallart.sqlite (14.8MB)</td>
                  <td className="p-2 text-green-700 font-bold">✔ 100% (300 DPI Pass)</td>
                  <td className="p-2">
                    <span className="bg-blue-100 text-blue-900 px-2 py-0.5 rounded text-[10px] font-mono cursor-pointer hover:underline">
                      Open Portal &rarr;
                    </span>
                  </td>
                </tr>
                <tr className="border-b hover:bg-gray-50">
                  <td className="p-2 font-bold text-w95-blue">sam/retro-calc</td>
                  <td className="p-2 font-mono">3001</td>
                  <td className="p-2 text-green-700 font-bold font-mono">24 MB / 256 MB</td>
                  <td className="p-2 font-mono">/data/app.sqlite (1.4MB)</td>
                  <td className="p-2 text-green-700 font-bold">✔ 100% (WAL Verified)</td>
                  <td className="p-2">
                    <span className="bg-blue-100 text-blue-900 px-2 py-0.5 rounded text-[10px] font-mono cursor-pointer hover:underline">
                      Open Portal &rarr;
                    </span>
                  </td>
                </tr>
                <tr className="border-b hover:bg-gray-50">
                  <td className="p-2 font-bold text-w95-blue">nate/sailtrack</td>
                  <td className="p-2 font-mono">3003</td>
                  <td className="p-2 text-green-700 font-bold font-mono">38 MB / 256 MB</td>
                  <td className="p-2 font-mono">/data/telemetry.sqlite (4.2MB)</td>
                  <td className="p-2 text-green-700 font-bold">✔ 100% (Polar NMEA Lock)</td>
                  <td className="p-2">
                    <span className="bg-blue-100 text-blue-900 px-2 py-0.5 rounded text-[10px] font-mono cursor-pointer hover:underline">
                      Open Portal &rarr;
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* TAB 3: SQLite Storage & Recovery */}
        {activeTab === 'storage' && (
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-blue-50 border-2 border-w95-blue p-3 rounded space-y-2">
              <span className="font-bold text-w95-blue text-sm">Sovereign SQLite Disk Export</span>
              <p className="text-gray-700 text-xs">
                Export any running container\'s complete, uncorrupted SQLite database file to your local computer with zero locks.
              </p>
              <button className="btn-w95 btn-w95-primary w-full py-1.5 flex items-center justify-center gap-1.5">
                <Download size={13} /> Export wallart.sqlite (WAL Safe)
              </button>
            </div>

            <div className="bg-yellow-50 border-2 border-yellow-500 p-3 rounded space-y-2">
              <span className="font-bold text-yellow-900 text-sm">OOM Crash Proofing (Exit 137)</span>
              <p className="text-yellow-800 text-xs">
                Strict 256MB memory cap. If arbitrary user code leaks memory, RIG.EXE checkpoints the SQLite WAL journal and restarts clean in &lt;50ms.
              </p>
              <div className="text-[11px] text-green-800 font-mono font-bold">
                ✔ Litestream replication to Cloudflare R2 active
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
