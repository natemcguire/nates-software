import React, { useState } from 'react';
import { AppListing } from '../data/mockData';
import { Download, Compass, Sliders, Sparkles, Image as ImageIcon, Send, Check, Upload, Trash2 } from 'lucide-react';
import { playClickSound, playSuccessChime } from '../lib/soundEngine';

interface EphemeralLiveAppProps {
  app: AppListing;
}

export const EphemeralLiveApp: React.FC<EphemeralLiveAppProps> = ({ app }) => {
  // Hold To Ship state
  const [isHoldingShip, setIsHoldingShip] = useState(false);
  const [shipProgress, setShipProgress] = useState(0);
  const [isShipped, setIsShipped] = useState(false);

  // WallArt Canvas Pro (Flagship)
  const [wallColor, setWallColor] = useState('#2a2f35');
  const [frameStyle, setFrameStyle] = useState<'walnut' | 'black' | 'oak' | 'canvas-wrap'>('walnut');
  const [layoutMode, setLayoutMode] = useState<'single' | 'triptych' | 'grid'>('single');
  const [printSize, setPrintSize] = useState('24" x 36" (60x90cm)');
  const [customPhotoUrl, setCustomPhotoUrl] = useState<string | null>(null);

  const [renderJobQueue, setRenderJobQueue] = useState([
    { id: 'job-981', preset: '24x36 Floating Walnut', status: 'Completed', size: '48.2 MB TIFF' },
    { id: 'job-982', preset: '3-Piece Triptych Split', status: 'Completed', size: '112.4 MB TIFF' }
  ]);

  // RetroCalc Pro
  const [calcVal, setCalcVal] = useState('1,420.00');
  const [transactions, setTransactions] = useState([
    { id: 1, desc: 'Starting Balance', amount: 1420.00, type: 'credit' },
  ]);
  const [newTxDesc, setNewTxDesc] = useState('');
  const [newTxAmount, setNewTxAmount] = useState('');

  // SailTrack GPS
  const [sog] = useState(7.4);
  const [heading] = useState(142);
  const [vmg] = useState(6.8);
  const [waypoints] = useState([
    { id: 1, name: 'Start Line Pin', lat: '30.2672° N', lon: '97.7431° W' },
    { id: 2, name: 'Windward Mark', lat: '30.2750° N', lon: '97.7380° W' }
  ]);

  // Hold to ship handler
  const handleHoldStart = () => {
    setIsHoldingShip(true);
    let p = 0;
    const interval = setInterval(() => {
      p += 20;
      setShipProgress(p);
      if (p >= 100) {
        clearInterval(interval);
        setIsHoldingShip(false);
        setIsShipped(true);
        playSuccessChime();
        setTimeout(() => setIsShipped(false), 4000);
      }
    }, 150);
  };

  const handleHoldEnd = () => {
    if (shipProgress < 100) {
      setIsHoldingShip(false);
      setShipProgress(0);
    }
  };

  const handleQueueRender = () => {
    playClickSound();
    const newId = `job-${Math.floor(100 + Math.random() * 900)}`;
    const newJob = {
      id: newId,
      preset: `${printSize} · ${frameStyle.toUpperCase()}`,
      status: 'Rendering 300 DPI...',
      size: 'Processing...'
    };
    setRenderJobQueue([newJob, ...renderJobQueue]);

    setTimeout(() => {
      setRenderJobQueue(prev => prev.map(j => j.id === newId ? { ...j, status: 'Completed', size: '64.1 MB TIFF' } : j));
      playSuccessChime();
    }, 1200);
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setCustomPhotoUrl(url);
      playSuccessChime();
    }
  };

  const handleAddTransaction = (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(newTxAmount);
    if (!newTxDesc.trim() || isNaN(amt)) return;

    playClickSound();
    const newTx = {
      id: Date.now(),
      desc: newTxDesc.trim(),
      amount: amt,
      type: 'credit'
    };
    setTransactions([newTx, ...transactions]);
    const currentNum = parseFloat(calcVal.replace(/,/g, ''));
    setCalcVal((currentNum + amt).toLocaleString('en-US', { minimumFractionDigits: 2 }));
    setNewTxDesc('');
    setNewTxAmount('');
  };

  const activeMasterImage = customPhotoUrl || "https://images.unsplash.com/photo-1513519245088-0e12902e5a38?auto=format&fit=crop&w=1000&q=80";

  return (
    <div className="h-full flex flex-col bg-[#ece9d8] p-3 text-xs font-tahoma overflow-y-auto">
      {/* Top Ephemeral Dyno Runtime Badge with HOLD TO SHIP BUTTON */}
      <div className="bg-gradient-to-r from-gray-900 via-blue-950 to-gray-900 text-white p-2.5 rounded border-2 border-gray-700 mb-3 flex items-center justify-between shadow-md flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-green-400 animate-ping" />
          <span className="font-bold text-sm text-green-300 font-mono">LIVE EPHEMERAL MAIN BUILD</span>
          <span className="bg-gray-800 text-gray-300 px-2 py-0.5 rounded text-[11px] font-mono">
            dyno://{app.creator}/{app.id}:3002
          </span>
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

      {/* 0. WALLART CANVAS PRO (FLAGSHIP EXAMPLE) */}
      {app.id === 'wallart' && (
        <div className="grid grid-cols-12 gap-3 flex-1">
          {/* Left: 3D Wall Art Interactive Preview Stage */}
          <div
            style={{ backgroundColor: wallColor }}
            className="col-span-7 p-4 border-2 border-gray-800 rounded shadow-xl flex flex-col justify-between transition-colors duration-300 min-h-[380px]"
          >
            {/* Top Canvas Badges */}
            <div className="flex justify-between items-center bg-black/50 p-2 rounded text-white backdrop-blur-sm">
              <span className="font-bold text-xs flex items-center gap-1.5 text-yellow-300">
                <ImageIcon size={14} /> Living Room Gallery Wall Preview
              </span>
              <div className="flex items-center gap-2">
                {customPhotoUrl && (
                  <button
                    onClick={() => { setCustomPhotoUrl(null); playClickSound(); }}
                    className="text-[10px] bg-red-900/80 text-red-200 px-1.5 py-0.5 rounded flex items-center gap-1 border border-red-500"
                    title="Reset to default photo"
                  >
                    <Trash2 size={10} /> Reset
                  </button>
                )}
                <span className="text-[10px] font-mono bg-blue-900/80 px-2 py-0.5 rounded border border-blue-400">
                  {printSize} &middot; {layoutMode.toUpperCase()}
                </span>
              </div>
            </div>

            {/* Simulated Framed Canvas Display */}
            <div className="my-auto flex items-center justify-center p-4">
              {layoutMode === 'single' && (
                <div
                  style={{
                    borderWidth: frameStyle === 'canvas-wrap' ? '4px' : '14px',
                    borderColor: frameStyle === 'walnut' ? '#5c3a21' : frameStyle === 'oak' ? '#c49a6c' : frameStyle === 'black' ? '#111111' : '#ffffff',
                    padding: '8px',
                    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.75)'
                  }}
                  className="bg-white rounded-sm transition-all duration-300 max-w-[340px] max-h-[220px] overflow-hidden"
                >
                  <img
                    src={activeMasterImage}
                    alt="WallArt Master Canvas"
                    className="w-full h-full object-cover"
                  />
                </div>
              )}

              {layoutMode === 'triptych' && (
                <div className="flex gap-2.5 items-center justify-center">
                  {[1, 2, 3].map((panel) => (
                    <div
                      key={panel}
                      style={{
                        borderWidth: '10px',
                        borderColor: frameStyle === 'walnut' ? '#5c3a21' : frameStyle === 'oak' ? '#c49a6c' : '#111111',
                        padding: '4px',
                        boxShadow: '0 20px 35px rgba(0, 0, 0, 0.65)'
                      }}
                      className="bg-white rounded-sm w-28 h-44 overflow-hidden"
                    >
                      <img
                        src={activeMasterImage}
                        alt={`Panel ${panel}`}
                        style={{ objectPosition: `${(panel - 1) * 50}% center` }}
                        className="w-full h-full object-cover scale-150"
                      />
                    </div>
                  ))}
                </div>
              )}

              {layoutMode === 'grid' && (
                <div className="grid grid-cols-2 gap-2 max-w-[280px]">
                  {[1, 2, 3, 4].map((gridItem) => (
                    <div
                      key={gridItem}
                      style={{
                        borderWidth: '8px',
                        borderColor: frameStyle === 'walnut' ? '#5c3a21' : frameStyle === 'oak' ? '#c49a6c' : '#111111',
                        padding: '2px',
                        boxShadow: '0 15px 25px rgba(0, 0, 0, 0.5)'
                      }}
                      className="bg-white rounded-sm h-24 overflow-hidden"
                    >
                      <img
                        src={activeMasterImage}
                        alt={`Grid ${gridItem}`}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Bottom Wall Color Swatches */}
            <div className="flex items-center justify-between bg-black/60 p-2 rounded text-white backdrop-blur-sm">
              <span className="text-[11px] text-gray-300">Room Wall Paint:</span>
              <div className="flex gap-1.5">
                {[
                  { color: '#2a2f35', name: 'Charcoal Navy' },
                  { color: '#ded7c8', name: 'Warm Linen' },
                  { color: '#4a554a', name: 'Vintage Sage' },
                  { color: '#f3f4f6', name: 'Studio White' },
                ].map((swatch) => (
                  <button
                    key={swatch.color}
                    onClick={() => { setWallColor(swatch.color); playClickSound(); }}
                    style={{ backgroundColor: swatch.color }}
                    className={`w-5 h-5 rounded-full border-2 transition-transform ${
                      wallColor === swatch.color ? 'border-yellow-400 scale-125 shadow-md' : 'border-white/50 hover:scale-110'
                    }`}
                    title={swatch.name}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Right: Customization Controls & SQLite Print Queue */}
          <div className="col-span-5 bg-white border-2 border-gray-800 p-3 flex flex-col justify-between overflow-y-auto">
            <div className="space-y-2.5">
              <div className="border-b pb-1.5 flex items-center justify-between">
                <span className="font-bold text-sm text-w95-blue flex items-center gap-1.5">
                  <Sliders size={14} /> Frame Matting &amp; Print Controls
                </span>
                <span className="bg-green-100 text-green-800 text-[10px] font-bold px-1.5 py-0.5 rounded font-mono">
                  300 DPI READY
                </span>
              </div>

              {/* Upload Custom Photo Button */}
              <div>
                <label className="font-bold text-gray-800 block mb-1 text-[11px]">Upload Your Own Photo / Art:</label>
                <label className="btn-w95 w-full py-1.5 flex items-center justify-center gap-1.5 cursor-pointer font-bold bg-blue-50 hover:bg-blue-100">
                  <Upload size={12} className="text-w95-blue" />
                  <span>Choose JPG / PNG File...</span>
                  <input type="file" accept="image/*" onChange={handlePhotoUpload} className="hidden" />
                </label>
              </div>

              {/* Frame Material */}
              <div>
                <label className="font-bold text-gray-800 block mb-1 text-[11px]">Frame Material &amp; Finish:</label>
                <div className="grid grid-cols-2 gap-1 font-mono text-[11px]">
                  {[
                    { id: 'walnut', label: '🪵 Solid Walnut' },
                    { id: 'oak', label: '🌾 Natural Oak' },
                    { id: 'black', label: '🖤 Matte Black' },
                    { id: 'canvas-wrap', label: '🖼️ Gallery Wrap' },
                  ].map((f) => (
                    <button
                      key={f.id}
                      onClick={() => { setFrameStyle(f.id as any); playClickSound(); }}
                      className={`btn-w95 py-1 text-left ${frameStyle === f.id ? 'btn-w95-primary' : ''}`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Layout Mode */}
              <div>
                <label className="font-bold text-gray-800 block mb-1 text-[11px]">Display Layout:</label>
                <div className="flex gap-1 font-mono text-[11px]">
                  <button
                    onClick={() => { setLayoutMode('single'); playClickSound(); }}
                    className={`btn-w95 flex-1 py-1 ${layoutMode === 'single' ? 'btn-w95-primary' : ''}`}
                  >
                    Single Frame
                  </button>
                  <button
                    onClick={() => { setLayoutMode('triptych'); playClickSound(); }}
                    className={`btn-w95 flex-1 py-1 ${layoutMode === 'triptych' ? 'btn-w95-primary' : ''}`}
                  >
                    3-Panel Triptych
                  </button>
                  <button
                    onClick={() => { setLayoutMode('grid'); playClickSound(); }}
                    className={`btn-w95 flex-1 py-1 ${layoutMode === 'grid' ? 'btn-w95-primary' : ''}`}
                  >
                    4-Grid Split
                  </button>
                </div>
              </div>

              {/* Print Size */}
              <div>
                <label className="font-bold text-gray-800 block mb-1 text-[11px]">Canvas Aspect Ratio &amp; Dimension:</label>
                <select
                  value={printSize}
                  onChange={(e) => { setPrintSize(e.target.value); playClickSound(); }}
                  className="w-full p-1 border border-gray-400 text-xs bg-gray-50 font-bold"
                >
                  <option value='24" x 36" (60x90cm)'>24" x 36" (60x90cm) — Master Living Room Hero</option>
                  <option value='16" x 20" (40x50cm)'>16" x 20" (40x50cm) — Standard Gallery Size</option>
                  <option value='30" x 40" (75x100cm)'>30" x 40" (75x100cm) — Oversized Museum Canvas</option>
                </select>
              </div>

              {/* Live Render Queue Table */}
              <div className="border border-gray-300 rounded p-2 bg-gray-50">
                <div className="flex justify-between items-center text-[11px] font-bold text-w95-blue mb-1">
                  <span>SQLite Render Queue (/data/wallart.sqlite):</span>
                  <span className="font-mono text-gray-500">{renderJobQueue.length} jobs</span>
                </div>
                <div className="space-y-1 max-h-[75px] overflow-y-auto">
                  {renderJobQueue.map((job) => (
                    <div key={job.id} className="bg-white p-1 rounded border text-[10px] flex justify-between items-center font-mono">
                      <span className="truncate">{job.preset}</span>
                      <span className="text-green-700 font-bold ml-1">{job.size}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Bottom Actions */}
            <div className="pt-2 border-t border-gray-300 flex gap-1.5">
              <button
                onClick={handleQueueRender}
                className="btn-w95 btn-w95-primary flex-1 py-1.5 text-xs flex items-center justify-center gap-1 font-bold"
              >
                <Sparkles size={12} /> Render 300 DPI Print TIFF
              </button>
              <a
                href="data:text/plain;charset=utf-8,WallArt%20SQLite%20Database"
                download="wallart.sqlite"
                className="btn-w95 py-1.5 px-2 text-xs flex items-center gap-1"
              >
                <Download size={12} /> .sqlite
              </a>
            </div>
          </div>
        </div>
      )}

      {/* 1. RETROCALC PRO BUILD */}
      {app.id === 'retro-calc' && (
        <div className="grid grid-cols-12 gap-3 flex-1">
          <div className="col-span-6 bg-[#d4d0c8] border-2 border-white border-r-gray-700 border-b-gray-700 p-4 shadow-lg flex flex-col justify-between">
            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="font-black text-sm text-w95-blue tracking-wider">RETROCALC PRO v1.2</span>
                <span className="bg-green-200 text-green-900 font-bold px-1.5 py-0.5 rounded text-[10px]">WASM SQLite 3.45</span>
              </div>
              <div className="bg-[#9ea792] p-3 rounded border-2 border-gray-700 mb-3 shadow-inner text-right font-mono">
                <div className="text-[10px] text-gray-700 font-sans uppercase">Compound Balance / Ledger Total</div>
                <div className="text-3xl font-black text-black tracking-tight my-1 truncate">${calcVal}</div>
              </div>

              {/* Add Transaction Form */}
              <form onSubmit={handleAddTransaction} className="space-y-2 bg-gray-100 p-2.5 rounded border border-gray-400">
                <div className="font-bold text-gray-800 text-xs">Record Accounting Entry:</div>
                <div className="grid grid-cols-2 gap-1.5">
                  <input
                    type="text"
                    placeholder="Description (e.g. Office Supplies)"
                    value={newTxDesc}
                    onChange={(e) => setNewTxDesc(e.target.value)}
                    className="p-1 border text-xs bg-white"
                  />
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Amount ($)"
                    value={newTxAmount}
                    onChange={(e) => setNewTxAmount(e.target.value)}
                    className="p-1 border text-xs bg-white font-mono"
                  />
                </div>
                <button type="submit" className="btn-w95 btn-w95-primary w-full py-1 text-xs font-bold">
                  + Add Entry to SQLite Ledger
                </button>
              </form>
            </div>
          </div>
          <div className="col-span-6 bg-white border-2 border-gray-800 p-3 flex flex-col justify-between">
            <div className="font-bold text-sm text-w95-blue border-b pb-1 mb-2">Live SQLite Journal (/data/app.sqlite)</div>
            <div className="space-y-1 overflow-y-auto max-h-[220px]">
              {transactions.map((tx) => (
                <div key={tx.id} className="p-1.5 bg-gray-50 border rounded flex justify-between text-xs">
                  <span>{tx.desc}</span>
                  <span className="font-mono font-bold text-green-700">+${tx.amount.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 2. SAILTRACK GPS BUILD */}
      {app.id === 'sailtrack' && (
        <div className="grid grid-cols-12 gap-3 flex-1">
          <div className="col-span-7 bg-[#1c2430] text-cyan-400 p-4 border-2 border-gray-700 rounded shadow-lg flex flex-col justify-between">
            <div className="flex justify-between items-center border-b border-gray-700 pb-2 mb-3">
              <span className="font-black text-sm text-white flex items-center gap-1.5">
                <Compass size={16} className="text-yellow-400" /> SAILTRACK TELEMETRY HUD
              </span>
              <span className="bg-cyan-950 text-cyan-300 px-2 py-0.5 rounded text-[10px] font-mono">GPS LOCK: 12 SATS</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center my-3">
              <div className="bg-black/60 p-3 rounded border border-cyan-800">
                <div className="text-[10px] text-gray-400 font-mono uppercase">Speed (SOG)</div>
                <div className="text-3xl font-black text-yellow-400 font-mono my-1">{sog} kts</div>
              </div>
              <div className="bg-black/60 p-3 rounded border border-cyan-800">
                <div className="text-[10px] text-gray-400 font-mono uppercase">Heading (HDG)</div>
                <div className="text-3xl font-black text-green-400 font-mono my-1">{heading}°</div>
              </div>
              <div className="bg-black/60 p-3 rounded border border-cyan-800">
                <div className="text-[10px] text-gray-400 font-mono uppercase">Target VMG</div>
                <div className="text-3xl font-black text-cyan-300 font-mono my-1">{vmg} kts</div>
              </div>
            </div>
          </div>
          <div className="col-span-5 bg-white border-2 border-gray-800 p-3">
            <div className="font-bold text-sm text-w95-blue border-b pb-1 mb-2">Race Waypoints &amp; Polar DB</div>
            <div className="space-y-1.5 overflow-y-auto max-h-[220px]">
              {waypoints.map((wp) => (
                <div key={wp.id} className="p-2 bg-gray-50 border rounded text-[11px]">
                  <div className="font-bold">{wp.name}</div>
                  <div className="font-mono text-gray-500">{wp.lat} &middot; {wp.lon}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
