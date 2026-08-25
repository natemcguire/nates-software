import React, { useState } from 'react';
import { AppListing } from '../data/mockData';
import { RotateCcw, Download, Database, Compass, Plus } from 'lucide-react';

interface EphemeralLiveAppProps {
  app: AppListing;
}

export const EphemeralLiveApp: React.FC<EphemeralLiveAppProps> = ({ app }) => {
  // 1. State for RetroCalc Pro
  const [calcVal, setCalcVal] = useState('1,420.00');
  const [transactions, setTransactions] = useState([
    { id: 1, desc: 'Starting Balance', amount: 1420.00, type: 'credit' },
  ]);

  // 2. State for SailTrack GPS
  const [sog, setSog] = useState(7.4);
  const [heading, setHeading] = useState(142);
  const [vmg, setVmg] = useState(6.8);
  const [waypoints, setWaypoints] = useState([
    { id: 1, name: 'Start Line Pin', lat: '30.2672° N', lon: '97.7431° W' },
    { id: 2, name: 'Windward Mark', lat: '30.2750° N', lon: '97.7380° W' }
  ]);

  // 3. State for Ledgerly 95
  const [ledgerEntries, setLedgerEntries] = useState([
    { id: 1, account: '1010 Cash in Bank', debit: 4500.00, credit: 0 },
    { id: 2, account: '4000 Shareware Sales', debit: 0, credit: 4500.00 }
  ]);
  const [newAccount, setNewAccount] = useState('');
  const [newAmount, setNewAmount] = useState('');

  // RetroCalc Actions
  const handleCalcClick = (btn: string) => {
    if (btn === 'C') {
      setCalcVal('0');
    } else if (btn === '=') {
      try {
        const clean = calcVal.replace(/,/g, '');
        // Safe math evaluation for basic operators
        const res = Function(`"use strict"; return (${clean})`)();
        const formatted = Number(res).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        setCalcVal(formatted);
        setTransactions([
          { id: Date.now(), desc: `Calc Result (${clean})`, amount: Number(res), type: 'credit' },
          ...transactions
        ]);
      } catch {
        setCalcVal('Error');
      }
    } else {
      setCalcVal(prev => prev === '0' || prev === '1,420.00' ? btn : prev + btn);
    }
  };

  const addReceiptScan = () => {
    const amt = 42.50;
    setTransactions([
      { id: Date.now(), desc: 'Receipt OCR Scan (Office Depot)', amount: amt, type: 'debit' },
      ...transactions
    ]);
    setCalcVal('1,462.50');
  };

  // SailTrack Actions
  const adjustTrim = () => {
    setSog(prev => Number((prev + (Math.random() * 0.4 - 0.2)).toFixed(1)));
    setHeading(prev => (prev + 2) % 360);
    setVmg(prev => Number((prev + 0.1).toFixed(1)));
  };

  const addWaypoint = () => {
    const id = waypoints.length + 1;
    setWaypoints([
      ...waypoints,
      { id, name: `Gate Mark #${id}`, lat: '30.2710° N', lon: '97.7410° W' }
    ]);
  };

  // Ledgerly Actions
  const handleAddLedger = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAccount || !newAmount) return;
    const val = parseFloat(newAmount);
    setLedgerEntries([
      ...ledgerEntries,
      { id: Date.now(), account: newAccount, debit: val, credit: 0 },
      { id: Date.now() + 1, account: '2000 Accounts Payable', debit: 0, credit: val }
    ]);
    setNewAccount('');
    setNewAmount('');
  };

  return (
    <div className="h-full flex flex-col bg-[#ece9d8] p-3 text-xs font-tahoma overflow-y-auto">
      {/* Top Ephemeral Dyno Runtime Badge */}
      <div className="bg-gradient-to-r from-gray-900 via-blue-950 to-gray-900 text-white p-2.5 rounded border-2 border-gray-700 mb-3 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-green-400 animate-ping" />
          <span className="font-bold text-sm text-green-300 font-mono">LIVE EPHEMERAL MAIN BUILD</span>
          <span className="bg-gray-800 text-gray-300 px-2 py-0.5 rounded text-[11px] font-mono">
            dyno://{app.creator}/{app.id}:3001
          </span>
        </div>

        <div className="flex items-center gap-2 font-mono text-[11px] text-gray-400">
          <span>Storage: <b>/data/app.sqlite (WAL)</b></span>
          <span>&middot;</span>
          <span>Latency: <b>0.08ms</b></span>
        </div>
      </div>

      {/* 1. RETROCALC PRO BUILD */}
      {app.id === 'retro-calc' && (
        <div className="grid grid-cols-12 gap-3 flex-1">
          {/* Calculator Hardware Unit */}
          <div className="col-span-6 bg-[#d4d0c8] border-2 border-white border-r-gray-700 border-b-gray-700 p-4 shadow-lg flex flex-col justify-between">
            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="font-black text-sm text-w95-blue tracking-wider">RETROCALC PRO v1.2</span>
                <span className="bg-green-200 text-green-900 font-bold px-1.5 py-0.5 rounded text-[10px]">WASM SQLite 3.45</span>
              </div>

              {/* LCD Display */}
              <div className="bg-[#9ea792] p-3 rounded border-2 border-gray-700 mb-3 shadow-inner text-right font-mono">
                <div className="text-[10px] text-gray-700 font-sans uppercase">Compound Balance / Result</div>
                <div className="text-3xl font-black text-black tracking-tight my-1 truncate">{calcVal}</div>
              </div>

              {/* Keypad Grid */}
              <div className="grid grid-cols-4 gap-1.5 font-mono text-sm font-bold">
                {['C', '(', ')', '/', '7', '8', '9', '*', '4', '5', '6', '-', '1', '2', '3', '+', '0', '.', '%', '='].map((k) => (
                  <button
                    key={k}
                    onClick={() => handleCalcClick(k)}
                    className={`btn-w95 py-2.5 text-sm ${k === '=' ? 'btn-w95-primary' : k === 'C' ? 'btn-w95-danger text-white' : ''}`}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </div>

            {/* Special Actions */}
            <div className="flex gap-2 pt-3 border-t border-gray-400 mt-2">
              <button onClick={addReceiptScan} className="btn-w95 flex-1 py-1.5 font-bold text-xs bg-yellow-100">
                📷 Simulate Receipt OCR Scan
              </button>
              <button onClick={() => setCalcVal('1,420.00')} className="btn-w95 py-1.5 px-3">
                <RotateCcw size={12} /> Reset
              </button>
            </div>
          </div>

          {/* SQLite Live Ledger Table */}
          <div className="col-span-6 bg-white border-2 border-gray-800 p-3 flex flex-col justify-between overflow-hidden">
            <div>
              <div className="flex items-center justify-between border-b pb-1.5 mb-2">
                <span className="font-bold text-sm text-w95-blue flex items-center gap-1.5">
                  <Database size={14} className="text-blue-700" /> SQLite Database: /data/app.sqlite
                </span>
                <span className="text-[10px] text-gray-500 font-mono">Table: transactions</span>
              </div>

              <div className="overflow-y-auto max-h-[260px] space-y-1 pr-1">
                {transactions.map((tx) => (
                  <div key={tx.id} className="p-1.5 bg-gray-50 border border-gray-300 rounded flex justify-between items-center text-[11px]">
                    <span className="font-medium text-gray-800">{tx.desc}</span>
                    <span className={`font-mono font-bold ${tx.type === 'credit' ? 'text-green-700' : 'text-red-700'}`}>
                      {tx.type === 'credit' ? '+' : '-'}${tx.amount.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-blue-50 p-2 border border-w95-blue rounded mt-2 flex justify-between items-center">
              <span className="text-[11px] text-gray-700">PRAGMA journal_mode = WAL; 0 locks</span>
              <button className="btn-w95 text-xs py-0.5 px-2">
                <Download size={11} /> Export .sqlite
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. SAILTRACK GPS BUILD */}
      {app.id === 'sailtrack' && (
        <div className="grid grid-cols-12 gap-3 flex-1">
          {/* Instrument Console */}
          <div className="col-span-7 bg-[#1c2430] text-cyan-400 p-4 border-2 border-gray-700 rounded shadow-lg flex flex-col justify-between">
            <div>
              <div className="flex justify-between items-center border-b border-gray-700 pb-2 mb-3">
                <span className="font-black text-sm text-white flex items-center gap-1.5">
                  <Compass size={16} className="text-yellow-400" /> SAILTRACK TELEMETRY HUD
                </span>
                <span className="bg-cyan-950 text-cyan-300 px-2 py-0.5 rounded text-[10px] font-mono">GPS LOCK: 12 SATS</span>
              </div>

              {/* Gauges Grid */}
              <div className="grid grid-cols-3 gap-2 text-center my-3">
                <div className="bg-black/60 p-3 rounded border border-cyan-800">
                  <div className="text-[10px] text-gray-400 font-mono uppercase">Speed (SOG)</div>
                  <div className="text-3xl font-black text-yellow-400 font-mono my-1">{sog} <span className="text-xs text-gray-400">kts</span></div>
                </div>
                <div className="bg-black/60 p-3 rounded border border-cyan-800">
                  <div className="text-[10px] text-gray-400 font-mono uppercase">Heading (HDG)</div>
                  <div className="text-3xl font-black text-green-400 font-mono my-1">{heading}° <span className="text-xs text-gray-400">MAG</span></div>
                </div>
                <div className="bg-black/60 p-3 rounded border border-cyan-800">
                  <div className="text-[10px] text-gray-400 font-mono uppercase">Target VMG</div>
                  <div className="text-3xl font-black text-cyan-300 font-mono my-1">{vmg} <span className="text-xs text-gray-400">kts</span></div>
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <button onClick={adjustTrim} className="btn-w95 flex-1 py-2 font-bold text-xs bg-cyan-800 text-white">
                ⛵ Simulate Sheet Trim &amp; Wind Shift
              </button>
              <button onClick={addWaypoint} className="btn-w95 py-2 px-3 text-xs bg-gray-700 text-white">
                <Plus size={12} /> Add Waypoint
              </button>
            </div>
          </div>

          {/* Waypoints & SQLite Table */}
          <div className="col-span-5 bg-white border-2 border-gray-800 p-3 flex flex-col justify-between">
            <div>
              <div className="font-bold text-sm text-w95-blue border-b pb-1 mb-2">Race Waypoints &amp; Polar DB</div>
              <div className="space-y-1.5 overflow-y-auto max-h-[260px]">
                {waypoints.map((wp) => (
                  <div key={wp.id} className="p-2 bg-gray-50 border border-gray-300 rounded text-[11px]">
                    <div className="font-bold text-gray-900">{wp.name}</div>
                    <div className="font-mono text-gray-500 text-[10px]">{wp.lat} &middot; {wp.lon}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-gray-100 p-2 border border-gray-300 rounded text-[11px] text-gray-600">
              ✔ 100% Offline Polar Engine Active &middot; Zero cellular data needed
            </div>
          </div>
        </div>
      )}

      {/* 3. LEDGERLY 95 / GENERIC APP BUILD */}
      {app.id !== 'retro-calc' && app.id !== 'sailtrack' && (
        <div className="grid grid-cols-12 gap-3 flex-1">
          <div className="col-span-12 bg-white border-2 border-gray-800 p-4 flex flex-col justify-between">
            <div>
              <div className="flex justify-between items-center border-b pb-2 mb-3">
                <span className="font-bold text-sm text-w95-blue">{app.name} &middot; Ephemeral Runtime</span>
                <span className="bg-green-100 text-green-800 font-bold px-2 py-0.5 rounded text-xs">Ready</span>
              </div>

              <p className="text-gray-700 text-xs mb-3">{app.description}</p>

              <form onSubmit={handleAddLedger} className="bg-gray-50 border p-3 rounded mb-3 flex gap-2">
                <input
                  type="text"
                  placeholder="Account Name (e.g. 5010 Server Hosting)"
                  value={newAccount}
                  onChange={(e) => setNewAccount(e.target.value)}
                  className="flex-1 p-1.5 border text-xs"
                />
                <input
                  type="number"
                  placeholder="Amount ($)"
                  value={newAmount}
                  onChange={(e) => setNewAmount(e.target.value)}
                  className="w-32 p-1.5 border text-xs font-mono"
                />
                <button type="submit" className="btn-w95 btn-w95-primary px-4 py-1 text-xs">
                  Record Entry
                </button>
              </form>

              <div className="border border-gray-300 rounded overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-gray-100 border-b">
                    <tr>
                      <th className="p-2 text-left">Account</th>
                      <th className="p-2 text-right">Debit ($)</th>
                      <th className="p-2 text-right">Credit ($)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledgerEntries.map((e) => (
                      <tr key={e.id} className="border-b">
                        <td className="p-2 font-medium">{e.account}</td>
                        <td className="p-2 text-right font-mono text-green-700">{e.debit > 0 ? `$${e.debit.toFixed(2)}` : '-'}</td>
                        <td className="p-2 text-right font-mono text-blue-700">{e.credit > 0 ? `$${e.credit.toFixed(2)}` : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
