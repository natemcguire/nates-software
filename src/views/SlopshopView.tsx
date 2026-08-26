import React, { useState } from 'react';
import { INITIAL_APPS, AppListing } from '../data/mockData';
import { Wrench, Sparkles, Terminal, Shield } from 'lucide-react';
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
      {/* Step 1: Project Selector Header */}
      <div className="bg-[#161b22] text-white p-3 border-2 border-gray-800 rounded mb-3 flex items-center justify-between shadow-md flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-base font-bold text-yellow-300">1. Select Project to Mod:</span>
          <div className="flex items-center gap-1.5">
            {INITIAL_APPS.map((app) => (
              <button
                key={app.id}
                onClick={() => handleSelectApp(app)}
                className={`px-3 py-1.5 rounded font-bold text-xs flex items-center gap-1.5 transition-all ${
                  selectedAppId === app.id
                    ? 'bg-blue-600 text-white ring-2 ring-blue-300 shadow-md'
                    : 'bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white border border-gray-700'
                }`}
              >
                <span>{app.creatorAvatar}</span>
                <span>{app.name}</span>
                <span className="text-[10px] font-mono opacity-75">({app.version})</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 font-mono text-[11px] text-green-400 bg-black/50 px-2.5 py-1 rounded border border-green-800">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span>Worktree: /tmp/slop-{selectedApp.id}</span>
        </div>
      </div>

      {/* Main Split: Left Feature Bay / Right Terminal HUD */}
      <div className="grid grid-cols-12 gap-3 flex-1 overflow-hidden">
        {/* Left: AST Feature Packages & Custom AI Prompt */}
        <div className="col-span-7 bg-white border-2 border-gray-800 p-3.5 flex flex-col justify-between overflow-y-auto shadow-sm">
          <div>
            <div className="flex items-center justify-between border-b pb-2 mb-3">
              <span className="font-bold text-sm text-w95-blue flex items-center gap-1.5">
                <Wrench size={15} /> 2. Compatible AST Features for {selectedApp.name}
              </span>
              <span className="text-[10px] bg-purple-100 text-purple-800 font-mono font-bold px-2 py-0.5 rounded">
                AST Engine v4.2
              </span>
            </div>

            <div className="space-y-2 mb-3">
              {features.map((f) => (
                <div
                  key={f.id}
                  onClick={() => handleSelectFeature(f)}
                  className={`p-2.5 border-2 rounded cursor-pointer transition-all ${
                    selectedFeature.id === f.id
                      ? 'bg-blue-50 border-w95-blue shadow-sm'
                      : 'bg-gray-50 border-gray-300 hover:border-gray-500'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="font-bold text-gray-900 text-xs flex items-center gap-1.5">
                      <Sparkles size={13} className="text-purple-600" /> {f.name}
                    </div>
                    <span className="text-[10px] bg-green-100 text-green-800 px-1.5 py-0.2 rounded font-mono font-bold">
                      {f.cleanliness}
                    </span>
                  </div>
                  <p className="text-gray-600 text-[11px] leading-relaxed mb-1.5">{f.description}</p>
                  <div className="flex items-center justify-between text-[10px] font-mono text-gray-500 bg-white/80 p-1 rounded border border-gray-200">
                    <span className="truncate">{f.ref}</span>
                    <span className="text-blue-900 font-bold ml-2">{f.astNodes}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Custom AI Mechanic Prompt */}
            <div className="border-2 border-gray-400 p-2.5 rounded bg-gray-50 mb-2">
              <label className="block font-bold text-gray-800 text-xs mb-1">
                Custom AI Mechanic / AST Mod Instructions:
              </label>
              <textarea
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                className="w-full border border-gray-400 p-2 font-mono text-xs bg-white rounded h-16 resize-none focus:outline-none focus:border-blue-600"
                placeholder="Describe custom AST components or SQLite schema changes to inject..."
              />
            </div>
          </div>

          <div className="pt-2 border-t flex items-center justify-between">
            <span className="text-gray-600 text-[11px] flex items-center gap-1">
              <Shield size={13} className="text-green-700" /> Zero local port collisions guaranteed (3001..3010)
            </span>
            <button
              onClick={handleWeld}
              disabled={isWelding}
              className="btn-w95 btn-w95-primary px-5 py-2 font-bold text-xs flex items-center gap-1.5 shadow-md"
            >
              <Wrench size={13} /> {isWelding ? 'WELDING AST NODES...' : '⚡ Weld Feature & Mod →'}
            </button>
          </div>
        </div>

        {/* Right: Isolated Worktree Terminal HUD */}
        <div className="col-span-5 bg-black border-2 border-gray-800 p-3 flex flex-col justify-between font-mono text-green-400 rounded shadow-inner overflow-hidden">
          <div className="flex items-center justify-between border-b border-green-800/80 pb-2 text-[11px]">
            <span className="flex items-center gap-1 text-green-300 font-bold">
              <Terminal size={13} /> SLOPSHOP ISOLATED WORKTREE TERMINAL
            </span>
            <span className="text-gray-400">Stream at 1000 Baud</span>
          </div>

          <div className="flex-1 overflow-y-auto py-2 space-y-1 text-[11px] leading-relaxed select-text">
            {terminalLogs.map((log, idx) => (
              <div
                key={idx}
                className={
                  log.startsWith('$')
                    ? 'text-yellow-300 font-bold mt-1'
                    : log.includes('ERROR')
                    ? 'text-red-400 font-bold'
                    : log.includes('Clean') || log.includes('green') || log.includes('PASS')
                    ? 'text-emerald-300 font-bold'
                    : 'text-green-400'
                }
              >
                {log}
              </div>
            ))}
          </div>

          <div className="border-t border-green-800/80 pt-2 flex items-center justify-between text-[10px] text-green-600">
            <span>✔ Isolated Worktree · Zero Lock Contentions</span>
            <span className="text-green-400 font-bold">AST STATUS: CLEAN</span>
          </div>
        </div>
      </div>
    </div>
  );
};
