import React, { useState } from 'react';
import { Award, Flame, ExternalLink, Info } from 'lucide-react';
import { playClickSound } from '../lib/soundEngine';
import { useCatalog } from '../context/CatalogContext';

interface EditorialArticle {
  id: string;
  badge: 'EDITOR SAMPLE' | 'HARDWARE DISCUSSION' | 'MAKER SPOTLIGHT' | 'DEEP DIVE';
  badgeColor: string;
  title: string;
  author: string;
  date: string;
  summary: string;
  appId?: string;
  specs: { label: string; value: string }[];
  content: string[];
}

const ARTICLES: EditorialArticle[] = [
  {
    id: 'art_dronehunter',
    badge: 'EDITOR SAMPLE',
    badgeColor: 'bg-red-600 text-white',
    title: "DroneHunter 95 Architecture Breakdown: Canvas Geometry & Web Audio Synthesis",
    author: "Nate McGuire (Sample Reviewer)",
    date: "Aug 29, 2026",
    summary: "Illustrative breakdown of an arcade canvas shooter concept. Pure canvas rendering, browser-local state, and Web Audio synthesis.",
    appId: 'dronehunter',
    specs: [
      { label: "Rendering", value: "HTML5 Canvas (Client-side)" },
      { label: "Audio Engine", value: "Web Audio API Synthesizers" },
      { label: "Shareware Split", value: "70% Maker / 20% Lineage / 10% Pool" },
      { label: "Review Status", value: "Illustrative Sample (Not Verified)" }
    ],
    content: [
      "In an era where basic desktop utilities often consume hundreds of megabytes of RAM via Chromium containers, DroneHunter 95 is designed with retro shareware restraint.",
      "The game logic, duck and drone trajectories, and audio synthesizers run entirely within the client runtime with zero framework bloat.",
      "Note: This article is an illustrative demo review demonstrating editorial layout and formatting; quantitative metrics are unverified sample estimates."
    ]
  },
  {
    id: 'art_m4max_bench',
    badge: 'HARDWARE DISCUSSION',
    badgeColor: 'bg-blue-600 text-white',
    title: "Unified Memory vs Discrete GPU Architectures for Local LLM Inference",
    author: "Nate's Software Lab Team (Illustrative Sample)",
    date: "Aug 28, 2026",
    summary: "Illustrative discussion comparing unified memory architectures against discrete GPUs for prompt caching and local model execution.",
    specs: [
      { label: "Architecture", value: "Unified Memory vs Dedicated VRAM" },
      { label: "Bandwidth Comparison", value: "Theoretical Hardware Specs" },
      { label: "Benchmark Status", value: "Sample Data (Not Verified Measurement)" },
      { label: "Verified Benchmarks", value: "See DYNO suite for reproducible runs" }
    ],
    content: [
      "This is an illustrative sample article demonstrating editorial review layouts. Verified model and agent benchmark results are recorded in the DYNO benchmark suite.",
      "Unified memory architectures provide zero-copy prompt cache reuse, while discrete GPUs offer high raw compute throughput.",
      "Quantitative hardware throughput numbers in sample editorial reviews are illustrative placeholders and do not represent verified laboratory measurements."
    ]
  },
  {
    id: 'art_certified_mailer',
    badge: 'MAKER SPOTLIGHT',
    badgeColor: 'bg-emerald-600 text-white',
    title: "Certified Mailer: A Private, Local Correspondence Journal",
    author: "Josh McGuire (Sample Reviewer)",
    date: "Aug 27, 2026",
    summary: "Draft, review, print, and organize user-recorded mailing evidence locally without pretending the browser is a postal provider.",
    appId: 'certified-mailer',
    specs: [
      { label: "Postal Integration", value: "Not Connected (Browser-Local Only)" },
      { label: "Output Format", value: "Browser Print" },
      { label: "Storage", value: "Unencrypted Browser-Local" },
      { label: "Review Status", value: "Illustrative Sample" }
    ],
    content: [
      "Certified Mailer keeps drafts and user-entered evidence in the browser while making no claim that a letter was submitted, delivered, or legally compliant.",
      "The app is useful today as a private preparation journal; verified postage, tracking, and receipts require a future postal-provider adapter.",
      "This sample review demonstrates how maker spotlights are formatted in the editorial section."
    ]
  }
];

export const EditorialView: React.FC<{ onOpenApp?: (appId: string) => void }> = ({ onOpenApp }) => {
  const [selectedArticle, setSelectedArticle] = useState<EditorialArticle>(ARTICLES[0]);

  // Safely resolve catalog context if available
  let catalogContext: ReturnType<typeof useCatalog> | null = null;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    catalogContext = useCatalog();
  } catch {
    catalogContext = null;
  }

  const targetApp = selectedArticle.appId
    ? catalogContext?.getApp(selectedArticle.appId) ||
      catalogContext?.demoApps.find(a => a.id === selectedArticle.appId)
    : undefined;

  const hasActiveDeployment = Boolean(
    targetApp &&
    (targetApp.deploymentState === 'active' || targetApp.activeDeploymentId || targetApp.liveUrl)
  );

  return (
    <div className="h-full flex flex-col bg-[#c0c0c0] text-black font-sans select-none overflow-hidden">
      {/* Editorial Header Banner */}
      <div className="bg-gradient-to-r from-blue-900 via-indigo-900 to-black text-white p-3 border-b-2 border-white shadow-md flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Award className="w-6 h-6 text-yellow-400" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-sm tracking-wider font-mono">NATE'S SOFTWARE &amp; EDITORIAL LAB</h1>
              <span className="bg-amber-100 text-amber-900 border border-amber-400 font-bold px-1.5 py-0.2 rounded text-[9px] font-mono">
                DEMO SAMPLES (UNVERIFIED)
              </span>
            </div>
            <p className="text-[11px] text-gray-300">Illustrative Editorial Reviews &amp; Architecture Teardowns (Demo Samples)</p>
          </div>
        </div>
        <div className="bg-yellow-400 text-black px-2 py-0.5 font-mono font-bold text-xs border border-black shadow">
          SAMPLE ISSUE
        </div>
      </div>

      {/* Main 2-Column Split */}
      <div className="flex-1 flex overflow-hidden">
        {/* Article Index Column */}
        <div className="w-80 border-r-2 border-gray-400 bg-gray-100 flex flex-col">
          <div className="p-2 bg-[#d4d0c8] border-b border-gray-300 font-bold text-xs font-mono uppercase text-gray-700 flex items-center justify-between">
            <span>Sample Reviews</span>
            <span className="text-[10px] font-normal">{ARTICLES.length} ARTICLES</span>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {ARTICLES.map(art => {
              const isSelected = selectedArticle.id === art.id;
              return (
                <div
                  key={art.id}
                  onClick={() => { playClickSound(); setSelectedArticle(art); }}
                  className={`p-2.5 cursor-pointer border rounded text-xs transition-all ${
                    isSelected
                      ? 'bg-blue-900 text-white border-black shadow'
                      : 'bg-white text-black border-gray-300 hover:bg-yellow-50'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className={`px-1.5 py-0.5 text-[9px] font-bold uppercase rounded font-mono ${art.badgeColor}`}>
                      {art.badge}
                    </span>
                    <span className={`font-mono text-[9px] uppercase font-bold ${isSelected ? 'text-yellow-300' : 'text-gray-500'}`}>
                      Sample
                    </span>
                  </div>
                  <h3 className="font-bold line-clamp-2 text-[11px] leading-tight mb-1">{art.title}</h3>
                  <div className={`text-[10px] ${isSelected ? 'text-blue-200' : 'text-gray-500'}`}>
                    {art.author} · {art.date}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Article Detail Viewer */}
        <div className="flex-1 bg-white overflow-y-auto p-5 font-serif text-gray-900">
          <div className="max-w-2xl mx-auto space-y-4">
            <div className="flex items-center space-x-2">
              <span className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded font-mono ${selectedArticle.badgeColor}`}>
                {selectedArticle.badge}
              </span>
              <span className="text-xs text-gray-500 font-mono">Sample Article · {selectedArticle.date}</span>
            </div>

            <h1 className="text-xl font-bold font-sans text-black leading-snug border-b pb-2">
              {selectedArticle.title}
            </h1>

            {/* Spec Scorecard Box */}
            <div className="bg-gray-50 border-2 border-gray-300 p-3 rounded font-sans text-xs space-y-2">
              <div className="flex items-center justify-between border-b pb-1">
                <span className="font-bold text-gray-700 font-mono uppercase">Illustrative Spec Overview</span>
                <span className="font-bold text-amber-900 font-mono text-xs bg-amber-100 px-2 py-0.5 rounded border border-amber-300">
                  Sample / Not a verified benchmark
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 pt-1 font-mono text-[11px]">
                {selectedArticle.specs.map((s, idx) => (
                  <div key={idx} className="flex justify-between bg-white p-1.5 border rounded">
                    <span className="text-gray-500">{s.label}:</span>
                    <span className="font-bold text-black">{s.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Content Paragraphs */}
            <div className="space-y-3 text-sm leading-relaxed pt-2">
              {selectedArticle.content.map((p, idx) => (
                <p key={idx}>{p}</p>
              ))}
            </div>

            {/* Bottom Actions */}
            <div className="pt-4 border-t flex items-center justify-between font-sans">
              <div className="text-xs text-gray-500 font-mono flex items-center gap-1.5 py-1 px-2 bg-gray-100 border border-gray-300 rounded">
                <Info className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                <span>Illustrative editorial sample — not a verified measurement</span>
              </div>

              {selectedArticle.appId && onOpenApp && (
                hasActiveDeployment ? (
                  <button
                    onClick={() => {
                      playClickSound();
                      if (selectedArticle.appId) onOpenApp(selectedArticle.appId);
                    }}
                    className="btn-w95 text-xs py-1.5 px-4 font-bold bg-blue-700 text-white hover:bg-blue-800 flex items-center space-x-1.5 shadow"
                  >
                    <Flame className="w-3.5 h-3.5 text-yellow-300" />
                    <span>Launch {targetApp?.name || selectedArticle.appId} in Sandbox</span>
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      playClickSound();
                      if (selectedArticle.appId) onOpenApp(selectedArticle.appId);
                    }}
                    className="btn-w95 text-xs py-1.5 px-4 font-bold bg-gray-200 text-gray-800 hover:bg-gray-100 flex items-center space-x-1.5 shadow border border-gray-400"
                  >
                    <ExternalLink className="w-3.5 h-3.5 text-gray-600" />
                    <span>View draft listing</span>
                  </button>
                )
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
