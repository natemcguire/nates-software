import React, { useState } from 'react';
import { AppListing } from '../data/mockData';
import { Download, Sparkles, Send, Check, Shield, ExternalLink, Mail, FileText } from 'lucide-react';
import { playClickSound } from '../lib/soundEngine';

interface EphemeralLiveAppProps {
  app: AppListing;
}

export const EphemeralLiveApp: React.FC<EphemeralLiveAppProps> = ({ app }) => {
  // Hold To Ship state
  const [isHoldingShip, setIsHoldingShip] = useState(false);
  const [shipProgress, setShipProgress] = useState(0);
  const [isShipped, setIsShipped] = useState(false);

  // Certified Mailer State
  const [cmRecipient, setCmRecipient] = useState('CSC Lawyers Incorporating Service, 211 E 7th St, Austin, TX 78701');
  const [cmAmount, setCmAmount] = useState('$1,850.00');
  const [cmCaseId, setCmCaseId] = useState('CASE-TX-2026-0814');
  const [cmLogs, setCmLogs] = useState<string[]>([
    '[INFO] Loaded dispute manifest: private/dispute.json',
    '[PASS] USPS CASS address verification successful',
    '[READY] Electronic Return Receipt (ERR) token ready'
  ]);

  // PicFit.ai State
  const [tryOnOutfit, setTryOnOutfit] = useState('Executive Navy Suit');
  const [geminiStatus, setGeminiStatus] = useState('Idle');
  const [credits, setCredits] = useState(100);

  const handleExportSqlite = (dbName: string) => {
    playClickSound();
    const blob = new Blob([`${dbName} SQLite Database (WAL Mode)`], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${dbName}.sqlite`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleHoldStart = () => {
    setIsHoldingShip(true);
    let current = 0;
    const interval = setInterval(() => {
      current += 10;
      setShipProgress(current);
      if (current >= 100) {
        clearInterval(interval);
        setIsShipped(true);
        setIsHoldingShip(false);
      }
    }, 80);
  };

  const handleHoldEnd = () => {
    if (shipProgress < 100) {
      setIsHoldingShip(false);
      setShipProgress(0);
    }
  };

  const subdomainUrl = `https://${app.id}.pages.dev`;

  return (
    <div className="h-full flex flex-col bg-[#ece9d8] p-3 text-xs font-tahoma overflow-y-auto">
      {/* Top Ephemeral Dyno Runtime Badge with Subdomain Link & HOLD TO SHIP BUTTON */}
      <div className="bg-gradient-to-r from-gray-900 via-blue-950 to-gray-900 text-white p-2.5 rounded border-2 border-gray-700 mb-3 flex items-center justify-between shadow-md flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-green-400 animate-ping" />
          <span className="font-bold text-sm text-green-300 font-mono">LIVE SUBDOMAIN BUILD</span>
          <a
            href={subdomainUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-blue-950 text-blue-300 hover:text-white px-2.5 py-1 rounded text-[11px] font-mono hover:bg-blue-900 transition-colors flex items-center gap-1.5 border border-blue-700 cursor-pointer shadow-sm"
            title={`Click to open ${subdomainUrl} in a new tab`}
          >
            <span>{app.id}.pages.dev</span>
            <ExternalLink size={11} />
          </a>
        </div>

        {/* The AMP-style HOLD TO SHIP button */}
        <div className="flex items-center gap-2">
          {isShipped ? (
            <div className="bg-green-600 text-white font-bold px-3 py-1.5 rounded flex items-center gap-1.5 shadow-md">
              <Check size={14} /> SHIPPED &amp; MERGED TO MAIN!
            </div>
          ) : (
            <button
              onMouseDown={handleHoldStart}
              onMouseUp={handleHoldEnd}
              onTouchStart={handleHoldStart}
              onTouchEnd={handleHoldEnd}
              className={`relative overflow-hidden btn-w95 btn-w95-primary px-4 py-1.5 font-bold text-xs flex items-center gap-1.5 select-none ${
                isHoldingShip ? 'ring-2 ring-yellow-400 scale-95' : ''
              }`}
              title="Click and hold for 1 second to ship verified changes to origin/main"
            >
              <div
                style={{ width: `${shipProgress}%` }}
                className="absolute inset-0 bg-green-600/80 transition-all duration-75 pointer-events-none"
              />
              <Send size={13} className="relative z-10" />
              <span className="relative z-10">
                {isHoldingShip ? `SHIPPING (${shipProgress}%)...` : '🚀 HOLD TO SHIP TO MAIN'}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* 1. DRONEHUNTER 95 (REAL DUCK HUNT STYLE ARCADE SHOOTER GAME) */}
      {app.id === 'dronehunter' && (
        <div className="grid grid-cols-12 gap-3 flex-1">
          {/* Left: Real Arcade Game Frame */}
          <div className="col-span-8 bg-black border-2 border-gray-800 rounded shadow-2xl overflow-hidden flex flex-col min-h-[480px]">
            <div className="bg-[#161b22] text-white p-2 flex items-center justify-between border-b border-gray-700 select-none">
              <div className="flex items-center gap-2">
                <span className="text-base">🎯</span>
                <span className="font-bold text-xs font-mono text-cyan-300">DRONE HUNTER — DUCK HUNT STYLE ARCADE SHOOTER</span>
                <span className="bg-green-600 text-white text-[9px] font-bold px-1.5 py-0.2 rounded font-mono">
                  AUTHENTIC RETRO ENGINE
                </span>
              </div>
              <a
                href={subdomainUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-w95 text-[10px] py-0.5 px-2 bg-gray-200 text-black font-bold flex items-center gap-1"
              >
                <ExternalLink size={10} /> Open Subdomain
              </a>
            </div>

            {/* Embedded Live Game Frame */}
            <div className="flex-1 bg-[#87CEEB] relative overflow-hidden">
              <iframe
                src="/dronehunter-game/index.html"
                title="Drone Hunter Arcade Game"
                className="w-full h-full border-0 absolute inset-0"
                allow="autoplay; fullscreen"
              />
            </div>
          </div>

          {/* Right: Telemetry & Sovereign SQLite Database Controls */}
          <div className="col-span-4 flex flex-col justify-between space-y-3">
            <div className="bg-white border-2 border-gray-800 p-3 rounded shadow-sm">
              <div className="font-bold text-xs text-w95-blue mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5"><Shield size={13} /> Flight Telemetry &amp; Weapons</span>
                <span className="text-[10px] bg-green-100 text-green-800 px-1.5 py-0.2 rounded border border-green-300 font-mono">
                  WAL ACTIVE
                </span>
              </div>

              <div className="space-y-2 text-xs text-gray-700">
                <div className="p-2 border border-gray-300 rounded bg-gray-50 flex items-center justify-between">
                  <div>
                    <div className="font-bold text-xs">🦆 Game Mode</div>
                    <div className="text-[10px] text-gray-500 font-mono">Duck Hunt Style Arcade</div>
                  </div>
                  <span className="text-xl">🐶</span>
                </div>

                <div className="p-2 border border-gray-300 rounded bg-gray-50 flex items-center justify-between">
                  <div>
                    <div className="font-bold text-xs">💥 Weapons System</div>
                    <div className="text-[10px] text-gray-500 font-mono">Double-Barrel 12G Shotgun</div>
                  </div>
                  <span className="text-xl">🎯</span>
                </div>

                <div className="p-2 border border-gray-300 rounded bg-gray-50 flex items-center justify-between">
                  <div>
                    <div className="font-bold text-xs">🗄️ Sovereign Storage</div>
                    <div className="text-[10px] text-gray-500 font-mono">/data/dronehunter.sqlite</div>
                  </div>
                  <span className="text-xs font-mono font-bold text-green-700">WAL Mode</span>
                </div>
              </div>
            </div>

            {/* High Scores Log */}
            <div className="bg-white border-2 border-gray-800 p-3 rounded shadow-sm flex-1 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-bold text-xs text-w95-blue">SQLite High Scores (/data/dronehunter.sqlite):</span>
                  <span className="text-[10px] text-gray-500 font-mono">WAL Verified</span>
                </div>
                <div className="bg-gray-50 p-2 rounded border border-gray-300 font-mono text-[10px] text-gray-800 divide-y divide-gray-200 max-h-28 overflow-y-auto">
                  <div className="py-1 flex justify-between">
                    <span>Rank #1: @nate</span>
                    <span className="text-green-700 font-bold">14,280 PTS</span>
                  </div>
                  <div className="py-1 flex justify-between">
                    <span>Rank #2: @josh</span>
                    <span className="text-green-700 font-bold">11,450 PTS</span>
                  </div>
                  <div className="py-1 flex justify-between">
                    <span>Rank #3: @sam</span>
                    <span className="text-green-700 font-bold">9,820 PTS</span>
                  </div>
                </div>
              </div>

              <button
                onClick={() => handleExportSqlite('dronehunter')}
                className="btn-w95 btn-w95-primary w-full py-1.5 mt-2 flex items-center justify-center gap-1.5 font-bold"
              >
                <Download size={13} /> Export /data/dronehunter.sqlite
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. CERTIFIED MAILER (USPS CERTIFIED MAIL & DISPUTE PIPELINE) */}
      {app.id === 'certified-mailer' && (
        <div className="grid grid-cols-12 gap-3 flex-1">
          <div className="col-span-7 bg-white border-2 border-gray-800 p-4 rounded shadow-sm flex flex-col justify-between space-y-3">
            <div>
              <div className="font-bold text-sm text-w95-blue border-b pb-2 mb-3 flex items-center justify-between">
                <span className="flex items-center gap-1.5"><Mail size={15} /> USPS Certified Dispute Manifest</span>
                <span className="text-xs font-mono bg-blue-100 text-blue-800 px-2 py-0.5 rounded">ERR Pipeline</span>
              </div>

              <div className="space-y-3 text-xs">
                <div>
                  <label className="block font-bold text-gray-700 mb-1">Registered Agent / Recipient:</label>
                  <input
                    type="text"
                    value={cmRecipient}
                    onChange={(e) => setCmRecipient(e.target.value)}
                    className="w-full border-2 border-gray-600 p-1.5 font-mono text-xs"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block font-bold text-gray-700 mb-1">Case Reference ID:</label>
                    <input
                      type="text"
                      value={cmCaseId}
                      onChange={(e) => setCmCaseId(e.target.value)}
                      className="w-full border-2 border-gray-600 p-1.5 font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-gray-700 mb-1">Disputed Amount:</label>
                    <input
                      type="text"
                      value={cmAmount}
                      onChange={(e) => setCmAmount(e.target.value)}
                      className="w-full border-2 border-gray-600 p-1.5 font-mono text-xs"
                    />
                  </div>
                </div>

                <button
                  onClick={() => {
                    playClickSound();
                    setCmLogs(prev => [
                      `[BUILD] Flattened dispute-letter.pdf to 300 DPI pixels at ${new Date().toLocaleTimeString()}`,
                      `[LOB/LETTERSTREAM] Prepared dispatch manifest for ${cmRecipient}`,
                      ...prev
                    ]);
                  }}
                  className="btn-w95 btn-w95-primary font-bold text-xs py-2 px-4 flex items-center gap-1.5 shadow-sm"
                >
                  <FileText size={13} /> ⚡ Build, Flatten &amp; Prepare USPS ERR
                </button>
              </div>
            </div>

            <div className="bg-gray-900 text-green-400 p-3 rounded font-mono text-[11px] border border-gray-700 max-h-32 overflow-y-auto space-y-1">
              {cmLogs.map((log, i) => (
                <div key={i}>{log}</div>
              ))}
            </div>
          </div>

          <div className="col-span-5 bg-white border-2 border-gray-800 p-4 rounded shadow-sm flex flex-col justify-between">
            <div className="space-y-3">
              <div className="font-bold text-sm text-w95-blue border-b pb-2 flex items-center justify-between">
                <span>USPS Certified Tracking</span>
                <span className="text-[10px] bg-green-100 text-green-800 px-1.5 py-0.5 rounded font-mono">WAL Active</span>
              </div>

              <div className="bg-gray-50 border border-gray-300 p-3 rounded space-y-1 text-xs">
                <div className="text-gray-500 text-[10px]">USPS CERTIFIED BARCODE #</div>
                <div className="font-mono font-bold text-blue-900 text-sm">9407 1118 9956 0421 9882 14</div>
                <div className="text-green-700 font-bold text-[11px]">✔ Electronic Return Receipt (ERR) Active</div>
              </div>

              <div className="bg-gray-50 border border-gray-300 p-3 rounded space-y-1 text-xs">
                <div className="text-gray-500 text-[10px]">DATABASE VOLUME</div>
                <div className="font-mono font-bold">/data/certified-mailer.sqlite</div>
                <div className="text-gray-600 text-[10px]">14 case disputes · Zero cloud lock-in</div>
              </div>
            </div>

            <button
              onClick={() => handleExportSqlite('certified-mailer')}
              className="btn-w95 btn-w95-primary w-full py-2 font-bold text-xs flex items-center justify-center gap-1.5"
            >
              <Download size={13} /> Export /data/certified-mailer.sqlite
            </button>
          </div>
        </div>
      )}

      {/* 3. PICFIT.AI (AI VIRTUAL TRY-ON STUDIO WITH GEMINI VISION) */}
      {app.id === 'picfitai' && (
        <div className="grid grid-cols-12 gap-3 flex-1">
          <div className="col-span-7 bg-white border-2 border-gray-800 p-4 rounded shadow-sm flex flex-col justify-between space-y-3">
            <div>
              <div className="font-bold text-sm text-w95-blue border-b pb-2 mb-3 flex items-center justify-between">
                <span className="flex items-center gap-1.5"><Sparkles size={15} className="text-purple-600" /> AI Virtual Try-On Studio</span>
                <span className="text-xs font-mono bg-purple-100 text-purple-800 px-2 py-0.5 rounded">Gemini Vision</span>
              </div>

              <div className="space-y-3 text-xs">
                <div>
                  <label className="block font-bold text-gray-700 mb-1">Select Outfit from Catalog:</label>
                  <div className="grid grid-cols-3 gap-2">
                    {['Executive Navy Suit', 'Streetwear Bomber', 'Evening Silk Dress'].map((o) => (
                      <div
                        key={o}
                        onClick={() => { playClickSound(); setTryOnOutfit(o); }}
                        className={`p-2 border-2 cursor-pointer text-center rounded ${
                          tryOnOutfit === o ? 'border-purple-700 bg-purple-50 font-bold' : 'border-gray-300 bg-gray-50'
                        }`}
                      >
                        {o}
                      </div>
                    ))}
                  </div>
                </div>

                <button
                  onClick={() => {
                    playClickSound();
                    setGeminiStatus('Synthesizing neural cloth mesh with Gemini Vision...');
                    setTimeout(() => {
                      setCredits(prev => Math.max(0, prev - 1));
                      setGeminiStatus(`Generated 4K photoreal render with ${tryOnOutfit}! Debited 1 credit in /data/picfitai.sqlite.`);
                    }, 800);
                  }}
                  className="btn-w95 btn-w95-primary font-bold text-xs py-2 px-4 flex items-center gap-1.5 shadow-sm"
                >
                  <Sparkles size={13} /> ✨ Synthesize AI Virtual Try-On (1 Credit)
                </button>
              </div>
            </div>

            <div className="bg-gray-900 text-purple-300 p-3 rounded font-mono text-[11px] border border-gray-700 space-y-1">
              <div>[STATUS]: {geminiStatus}</div>
              <div>[CREDITS REMAINING]: {credits} credits in /data/picfitai.sqlite (WAL Active)</div>
            </div>
          </div>

          <div className="col-span-5 bg-white border-2 border-gray-800 p-4 rounded shadow-sm flex flex-col justify-between">
            <div className="space-y-3">
              <div className="font-bold text-sm text-w95-blue border-b pb-2 flex items-center justify-between">
                <span>Neural Try-On Render</span>
                <span className="text-[10px] bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded font-mono">4K UHD</span>
              </div>

              <div className="border border-gray-300 rounded p-2 bg-gray-50 text-center">
                <div className="text-4xl my-3">✨ 👔 📸</div>
                <div className="font-bold text-xs text-gray-800">{tryOnOutfit}</div>
                <div className="text-[10px] text-gray-500 font-mono">Google Gemini Vision Neural Diffusion</div>
              </div>
            </div>

            <button
              onClick={() => handleExportSqlite('picfitai')}
              className="btn-w95 btn-w95-primary w-full py-2 font-bold text-xs flex items-center justify-center gap-1.5"
            >
              <Download size={13} /> Export /data/picfitai.sqlite
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
