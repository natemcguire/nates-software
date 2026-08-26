import React, { useState } from 'react';
import { INITIAL_APPS, AppListing } from '../data/mockData';
import { Wrench, Sparkles, Terminal, Folder, HardDrive, CheckCircle2 } from 'lucide-react';
import { playClickSound, playSuccessChime } from '../lib/soundEngine';
import { useAlert } from '../context/AlertContext';

interface SlopshopFeature {
  id: string;
  name: string;
  description: string;
  cleanliness: string;
  ref: string;
  astNodes: string;
  tables: string;
  presetPrompt: string;
}

const PROJECT_FEATURES: Record<string, SlopshopFeature[]> = {
  dronehunter: [
    {
      id: 'dh-radar-emp',
      name: 'EMP Counter-Drone Battery & Sweep HUD',
      description: '360-degree rotating phosphor radar sweep and electromagnetic pulse defense battery.',
      cleanliness: '100% Clean',
      ref: 'refs/features/dronehunter-emp/v1.2.0',
      astNodes: '+18 AST Nodes',
      tables: 'radar_intercepts, emp_batteries',
      presetPrompt: 'Weld AN/MPQ-64 Sentinel radar sweep HUD and tactical fire controls'
    },
    {
      id: 'dh-highscores-wal',
      name: 'High Score WAL Synchronizer',
      description: 'Multi-player arcade scoreboard with concurrent SQLite journal locking prevention.',
      cleanliness: '99.8% Clean',
      ref: 'refs/features/dronehunter-highscores/v1.0.0',
      astNodes: '+14 AST Nodes',
      tables: 'high_scores, player_profiles',
      presetPrompt: 'Add SQLite WAL high score leaderboard table and sync hooks'
    },
    {
      id: 'dh-dog-audio',
      name: 'Duck Hunt Dog & Sound FX Pack',
      description: 'Classic laughing dog animations, shell counters, and 8-bit arcade audio synthesizer.',
      cleanliness: '100% Clean',
      ref: 'refs/features/dronehunter-audio/v1.1.0',
      astNodes: '+12 AST Nodes',
      tables: 'audio_settings',
      presetPrompt: 'Inject Web Audio API retro shotgun sound effects and dog animations'
    }
  ],
  'certified-mailer': [
    {
      id: 'cm-flatten-pdf',
      name: '300 DPI High-Res PDF Flattener',
      description: 'Flattens DOCX/PDF pages to raw pixels, preventing postal printer font metric distortions.',
      cleanliness: '99.9% Clean',
      ref: 'refs/features/certified-pdf-flatten/v1.0.0',
      astNodes: '+16 AST Nodes',
      tables: 'flattened_receipts',
      presetPrompt: 'Weld PyMuPDF 300 DPI pixel flattening pipeline into dispute dispatch queue'
    },
    {
      id: 'cm-err-pipeline',
      name: 'USPS Electronic Return Receipt (ERR) Barcode',
      description: 'Automates official 20-digit USPS Certified Mail barcodes and digital signature tracking.',
      cleanliness: '100% Clean',
      ref: 'refs/features/certified-err-tracking/v1.3.0',
      astNodes: '+22 AST Nodes',
      tables: 'usps_tracking, return_receipts',
      presetPrompt: 'Integrate USPS CASS address verification and Electronic Return Receipt tokens'
    },
    {
      id: 'cm-letterstream-lob',
      name: 'LetterStream & Lob Dual Postal API Gateway',
      description: 'Multi-provider postal dispatch failover with idempotency keys and proof receipts.',
      cleanliness: '99.7% Clean',
      ref: 'refs/features/certified-postal-gateway/v1.1.0',
      astNodes: '+15 AST Nodes',
      tables: 'dispatch_logs',
      presetPrompt: 'Add LetterStream / Lob API test and live dispatch router'
    }
  ],
  picfitai: [
    {
      id: 'pf-gemini-vision',
      name: 'Google Gemini Vision Neural Try-On Diffusion',
      description: 'Hyper-realistic outfit transfer onto portrait photos with clothing mask boundary warping.',
      cleanliness: '99.5% Clean',
      ref: 'refs/features/picfit-gemini-diffusion/v2.0.0',
      astNodes: '+26 AST Nodes',
      tables: 'neural_generations, wardrobe_outfits',
      presetPrompt: 'Weld Gemini 1.5 Flash Vision clothing drape prompt pipeline'
    },
    {
      id: 'pf-stripe-credits',
      name: 'Stripe Credits & User Ledger',
      description: 'Credit deduction journal in SQLite WAL with webhook signature validation.',
      cleanliness: '99.8% Clean',
      ref: 'refs/features/picfit-credits-ledger/v1.2.0',
      astNodes: '+18 AST Nodes',
      tables: 'credit_transactions, webhook_events',
      presetPrompt: 'Add Stripe checkout session builder and credit balance check in SQLite'
    },
    {
      id: 'pf-4k-export',
      name: '4K Ultra-HD Canvas PNG Exporter',
      description: 'High-resolution client-side canvas render and lossless PNG compression.',
      cleanliness: '100% Clean',
      ref: 'refs/features/picfit-4k-export/v1.0.0',
      astNodes: '+11 AST Nodes',
      tables: 'export_history',
      presetPrompt: 'Inject 4K viewport renderer and download helper'
    }
  ]
};

export const SlopshopView: React.FC = () => {
  const { showAlert } = useAlert();
  const [selectedAppId, setSelectedAppId] = useState<string>('dronehunter');
  const [selectedFeature, setSelectedFeature] = useState<SlopshopFeature>(PROJECT_FEATURES['dronehunter'][0]);
  const [customPrompt, setCustomPrompt] = useState(PROJECT_FEATURES['dronehunter'][0].presetPrompt);
  const [terminalLogs, setTerminalLogs] = useState<string[]>([
    `$ slop fork nate/dronehunter`,
    `[SLOPSHOP] Worktree initialized at /tmp/slop-dronehunter-8910`,
    `[AST] Base TypeScript AST loaded: 148 nodes parsed`,
    `[STORAGE] Local SQLite snapshot mounted: /data/dronehunter.sqlite (WAL active)`
  ]);
  const [isWelding, setIsWelding] = useState(false);

  const selectedApp = INITIAL_APPS.find(a => a.id === selectedAppId) || INITIAL_APPS[0];
  const features = PROJECT_FEATURES[selectedAppId] || PROJECT_FEATURES['dronehunter'];

  const handleSelectApp = (app: AppListing) => {
    playClickSound();
    setSelectedAppId(app.id);
    const newFeatures = PROJECT_FEATURES[app.id] || PROJECT_FEATURES['dronehunter'];
    setSelectedFeature(newFeatures[0]);
    setCustomPrompt(newFeatures[0].presetPrompt);
    setTerminalLogs([
      `$ slop fork ${app.creator}/${app.id}`,
      `[SLOPSHOP] Worktree initialized at /tmp/slop-${app.id}-9921`,
      `[AST] Base AST loaded for ${app.name}: 164 nodes parsed`,
      `[STORAGE] Mounted single-file SQLite database: ${app.sqlitePath} (WAL Mode)`
    ]);
  };

  const handleSelectFeature = (f: SlopshopFeature) => {
    playClickSound();
    setSelectedFeature(f);
    setCustomPrompt(f.presetPrompt);
    setTerminalLogs(prev => [
      `[SELECT] Loaded feature package manifest: ${f.name}`,
      `[AST SPEC] Ref: ${f.ref} (${f.astNodes})`,
      `[SCHEMA] Tables to merge: [${f.tables}]`,
      ...prev.slice(0, 8)
    ]);
  };

  const handleWeld = () => {
    setIsWelding(true);
    playClickSound();
    setTerminalLogs(prev => [
      `[SLOPSHOP] Splicing ${selectedFeature.name} into ${selectedApp.name}...`,
      `  ✔ Parsing AST nodes and checking import interfaces...`,
      `  ✔ Merging migrations into ${selectedApp.sqlitePath}...`,
      `  ✔ Running isolated unit assertions... (100% green)`,
      `✔ Feature mod welded cleanly (${selectedFeature.cleanliness})!`,
      ...prev
    ]);

    setTimeout(() => {
      setIsWelding(false);
      playSuccessChime();
      showAlert(
        `Successfully spliced "${selectedFeature.name}" into ${selectedApp.name}!\n\n• Worktree: /tmp/slop-${selectedApp.id}\n• SQLite: ${selectedApp.sqlitePath} (WAL Mode)\n• Port: 3004 (Zero collisions)\n\nReady to test in ephemeral dev!`,
        "SLOPSHOP — Feature Welded Cleanly",
        "success"
      );
    }, 900);
  };

  return (
    <div className="flex flex-col h-full font-tahoma text-xs overflow-hidden">
      {/* 3-Column Split: Left File Explorer / Center Feature Bay / Right Terminal */}
      <div className="grid grid-cols-12 gap-3 flex-1 overflow-hidden p-1">
        {/* COLUMN 1: Left Old-School File Explorer & Project Tree */}
        <div className="col-span-3 bg-[#ece9d8] border-2 border-gray-600 rounded p-2.5 flex flex-col justify-between overflow-y-auto shadow-sm select-none">
          <div>
            <div className="bg-w95-blue text-white px-2 py-1 font-bold text-xs flex items-center justify-between rounded-t mb-2">
              <span className="flex items-center gap-1.5"><Folder size={13} /> Sovereign Projects</span>
              <span className="text-[10px] opacity-80 font-mono">~/Projects/</span>
            </div>

            <div className="space-y-1 bg-white border border-gray-500 p-1.5 rounded shadow-inner min-h-[220px]">
              {INITIAL_APPS.map((app) => {
                const isSelected = selectedAppId === app.id;
                return (
                  <div
                    key={app.id}
                    onClick={() => handleSelectApp(app)}
                    className={`p-2 rounded cursor-pointer transition-colors flex items-start gap-2 ${
                      isSelected
                        ? 'bg-[#000080] text-white font-bold'
                        : 'text-gray-900 hover:bg-[#d8e4f8]'
                    }`}
                  >
                    <span className="text-base mt-0.5">{app.creatorAvatar}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs truncate">{app.name}</div>
                      <div className={`text-[10px] font-mono truncate ${isSelected ? 'text-blue-200' : 'text-gray-500'}`}>
                        {app.sqlitePath}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Selected Project Specs */}
            <div className="mt-3 bg-white border border-gray-500 p-2.5 rounded text-[11px] space-y-1.5 shadow-inner">
              <div className="font-bold text-gray-800 flex items-center gap-1">
                <HardDrive size={12} className="text-blue-700" /> Active Worktree
              </div>
              <div className="font-mono text-gray-600 text-[10px] bg-gray-100 p-1 rounded border break-all">
                /tmp/slop-{selectedApp.id}
              </div>
              <div className="flex items-center justify-between text-gray-700 text-[10px]">
                <span>Moddability:</span>
                <span className="font-bold text-green-700">{selectedApp.moddabilityScore}/100</span>
              </div>
              <div className="flex items-center justify-between text-gray-700 text-[10px]">
                <span>Lineage Depth:</span>
                <span className="font-bold">{selectedApp.lineageDepth} Ancestors</span>
              </div>
            </div>
          </div>

          <div className="text-[10px] text-gray-600 font-mono pt-2 border-t border-gray-400 mt-2">
            ● SQLite WAL Mode Active
          </div>
        </div>

        {/* COLUMN 2: AST Feature Packages & Custom AI Prompt */}
        <div className="col-span-5 bg-white border-2 border-gray-800 p-3 flex flex-col justify-between overflow-y-auto shadow-sm">
          <div>
            <div className="flex items-center justify-between border-b pb-2 mb-2.5">
              <span className="font-bold text-xs text-w95-blue flex items-center gap-1.5">
                <Wrench size={14} /> Compatible AST Features ({selectedApp.name})
              </span>
              <span className="text-[10px] bg-purple-100 text-purple-800 font-mono font-bold px-2 py-0.5 rounded">
                v4.2 AST
              </span>
            </div>

            <div className="space-y-2 mb-3">
              {features.map((f) => (
                <div
                  key={f.id}
                  onClick={() => handleSelectFeature(f)}
                  className={`p-2.5 border-2 rounded cursor-pointer transition-all ${
                    selectedFeature.id === f.id
                      ? 'border-purple-600 bg-purple-50 ring-1 ring-purple-400 shadow-sm'
                      : 'border-gray-300 hover:border-gray-400 bg-gray-50/50'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-xs text-gray-900 flex items-center gap-1">
                      <Sparkles size={12} className="text-purple-600" /> {f.name}
                    </span>
                    <span className="text-[10px] bg-green-100 text-green-800 px-1.5 py-0.2 rounded font-mono font-bold">
                      {f.cleanliness}
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-600 mb-1.5 leading-tight">{f.description}</p>
                  <div className="flex items-center justify-between text-[10px] font-mono text-gray-500 bg-white p-1 rounded border">
                    <span className="truncate">{f.ref}</span>
                    <span className="text-purple-700 font-bold ml-1">{f.astNodes}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Custom AI Prompt Input */}
            <div className="border-2 border-gray-400 p-2.5 rounded bg-gray-50">
              <label className="block font-bold text-gray-800 mb-1 text-[11px]">
                Custom AI Mechanic / AST Mod Instructions:
              </label>
              <textarea
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                className="w-full h-14 border border-gray-400 p-1.5 font-mono text-xs rounded resize-none"
                placeholder="Describe modifications to splice..."
              />
            </div>
          </div>

          <div className="pt-2 border-t mt-2 flex items-center justify-between">
            <span className="text-[10px] text-gray-500 font-mono">Port 3004..3010 Reserved</span>
            <button
              onClick={handleWeld}
              disabled={isWelding}
              className="btn-w95 btn-w95-primary font-bold text-xs py-2 px-5 flex items-center gap-1.5 shadow-md"
            >
              <Wrench size={13} />
              <span>{isWelding ? 'SPLICING AST NODES...' : '⚡ Weld Feature & Mod'}</span>
            </button>
          </div>
        </div>

        {/* COLUMN 3: Isolated Worktree Terminal HUD */}
        <div className="col-span-4 bg-black border-2 border-gray-800 p-3 rounded flex flex-col justify-between font-mono text-xs shadow-inner overflow-hidden">
          <div className="flex items-center justify-between border-b border-gray-800 pb-1.5 mb-2 text-gray-400 text-[11px]">
            <span className="flex items-center gap-1.5 text-green-400 font-bold">
              <Terminal size={13} /> WORKTREE TERMINAL
            </span>
            <span className="text-gray-500">1000 Baud</span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-1 text-green-400 text-[11px] select-text pr-1">
            {terminalLogs.map((log, i) => (
              <div key={i} className="leading-tight">{log}</div>
            ))}
          </div>

          <div className="border-t border-gray-800 pt-2 mt-2 flex items-center justify-between text-[10px] text-gray-500">
            <span className="flex items-center gap-1 text-green-500">
              <CheckCircle2 size={11} /> 0 Lock Collisions
            </span>
            <span className="text-cyan-400 font-bold">AST STATUS: READY</span>
          </div>
        </div>
      </div>
    </div>
  );
};
