import React, { useState } from 'react';
import { Award, Flame, ThumbsUp } from 'lucide-react';
import { playClickSound, playSuccessChime } from '../lib/soundEngine';

interface EditorialArticle {
  id: string;
  badge: 'EDITOR CHOICE' | 'HARDWARE BENCHMARK' | 'MAKER SPOTLIGHT' | 'DEEP DIVE';
  badgeColor: string;
  title: string;
  author: string;
  date: string;
  summary: string;
  appId?: string;
  ratingScore: number;
  specs: { label: string; value: string }[];
  content: string[];
}

const ARTICLES: EditorialArticle[] = [
  {
    id: 'art_dronehunter',
    badge: 'EDITOR CHOICE',
    badgeColor: 'bg-red-600 text-white',
    title: "DroneHunter 95 Teardown: How 60 FPS Canvas Geometry & Web Audio Beat Electron Bloat",
    author: "Nate McGuire (Editor-in-Chief)",
    date: "Aug 29, 2026",
    summary: "A pure retro canvas shooter that boots in under 12ms. Zero framework overhead, Local-First state persistence, and instant sound synthesis.",
    appId: 'dronehunter',
    ratingScore: 9.8,
    specs: [
      { label: "Bundle Size", value: "38 KB (Zero NPM bloat)" },
      { label: "Frame Rate", value: "60 FPS rock solid" },
      { label: "Audio Engine", value: "Pure Web Audio API Synthesizers" },
      { label: "Shareware Split", value: "70% Maker / 20% Lineage / 10% Pool" }
    ],
    content: [
      "In an era where basic desktop calculators consume 400MB of RAM via Chromium containers, DroneHunter 95 is a masterclass in shareware restraint.",
      "The entire game logic, weapon physics, duck/drone trajectory trigonometry, and sound synthesizer fit in a single self-contained bundle.",
      "Forking this app via SLOP CLI takes under 400ms and yields a completely functional local worktree with hot-reloading."
    ]
  },
  {
    id: 'art_m4max_bench',
    badge: 'HARDWARE BENCHMARK',
    badgeColor: 'bg-blue-600 text-white',
    title: "Apple M4 Max vs Nvidia RTX 4090: Local AI Token Velocity & TTFT Benchmark Lab",
    author: "Nate's Software Lab Team",
    date: "Aug 28, 2026",
    summary: "Benchmarking 16-core Apple Silicon Unified Memory bandwidth against dedicated GDDR6X on local LLM prompt caching and code synthesis.",
    ratingScore: 9.6,
    specs: [
      { label: "M4 Max Throughput", value: "168.2 tok/s (Metal Performance Shaders)" },
      { label: "Memory Bandwidth", value: "410 GB/s Unified" },
      { label: "TTFT (First Token)", value: "42ms" },
      { label: "Needle Recall", value: "99.2% at 128k context" }
    ],
    content: [
      "Using the official `slop dyno --bench` suite, we stressed unified memory architectures under heavy speculative decoding loads.",
      "Apple Silicon's unified 64GB memory pool enables instant zero-copy prompt cache reuse, eliminating PCIe bus bottlenecks encountered on discrete GPUs."
    ]
  },
  {
    id: 'art_certified_mailer',
    badge: 'MAKER SPOTLIGHT',
    badgeColor: 'bg-emerald-600 text-white',
    title: "Certified Mailer: Replacing $100/mo SaaS with a $15 Single-Payment Shareware App",
    author: "Josh McGuire",
    date: "Aug 27, 2026",
    summary: "USPS certified barcode formatting, Electronic Return Receipt validation, and landlord dispute packet generation in pure local client code.",
    appId: 'certified-mailer',
    ratingScore: 9.5,
    specs: [
      { label: "USPS ERR Barcode", value: "20-digit Code 128 Compliant" },
      { label: "Export Format", value: "Print-Ready Vector PDF" },
      { label: "Data Privacy", value: "100% Client-Side Local" },
      { label: "License Price", value: "$15.00 Lifetime" }
    ],
    content: [
      "Why subscribe to bloated monthly document portals when an unbundled, local-first shareware app can generate compliant postal documents directly?",
      "Certified Mailer demonstrates the power of Shareware: pay once, own forever, fork with AI whenever requirements change."
    ]
  }
];

export const EditorialView: React.FC<{ onOpenApp?: (appId: string) => void }> = ({ onOpenApp }) => {
  const [selectedArticle, setSelectedArticle] = useState<EditorialArticle>(ARTICLES[0]);
  const [claps, setClaps] = useState<Record<string, number>>({ art_dronehunter: 142, art_m4max_bench: 98, art_certified_mailer: 76 });

  const handleClap = (id: string) => {
    playSuccessChime();
    setClaps(prev => ({ ...prev, [id]: (prev[id] || 0) + 1 }));
  };

  return (
    <div className="h-full flex flex-col bg-[#c0c0c0] text-black font-sans select-none overflow-hidden">
      {/* Editorial Header Banner */}
      <div className="bg-gradient-to-r from-blue-900 via-indigo-900 to-black text-white p-3 border-b-2 border-white shadow-md flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Award className="w-6 h-6 text-yellow-400" />
          <div>
            <h1 className="font-bold text-sm tracking-wider font-mono">NATE'S SOFTWARE & EDITORIAL LAB</h1>
            <p className="text-[11px] text-gray-300">Independent Shareware Teardowns, Hardware Benchmarks & Editor's Choice Awards</p>
          </div>
        </div>
        <div className="bg-yellow-400 text-black px-2 py-0.5 font-mono font-bold text-xs border border-black shadow">
          VOLUME 95 · ISSUE 42
        </div>
      </div>

      {/* Main 2-Column Split */}
      <div className="flex-1 flex overflow-hidden">
        {/* Article Index Column */}
        <div className="w-80 border-r-2 border-gray-400 bg-gray-100 flex flex-col">
          <div className="p-2 bg-[#d4d0c8] border-b border-gray-300 font-bold text-xs font-mono uppercase text-gray-700 flex items-center justify-between">
            <span>Featured Reviews</span>
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
                    <span className={`font-mono font-bold text-[10px] ${isSelected ? 'text-yellow-300' : 'text-blue-700'}`}>
                      ★ {art.ratingScore} / 10
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
              <span className="text-xs text-gray-500 font-mono">Published {selectedArticle.date} by {selectedArticle.author}</span>
            </div>

            <h1 className="text-xl font-bold font-sans text-black leading-snug border-b pb-2">
              {selectedArticle.title}
            </h1>

            {/* Spec Scorecard Box */}
            <div className="bg-gray-50 border-2 border-gray-300 p-3 rounded font-sans text-xs space-y-2">
              <div className="flex items-center justify-between border-b pb-1">
                <span className="font-bold text-gray-700 font-mono uppercase">Lab Benchmark Scorecard</span>
                <span className="font-bold text-blue-900 font-mono text-sm bg-yellow-200 px-2 py-0.5 rounded border border-yellow-400">
                  {selectedArticle.ratingScore} / 10.0 (Gold Award)
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
              <button
                onClick={() => handleClap(selectedArticle.id)}
                className="btn-w95 text-xs py-1.5 px-3 font-bold flex items-center space-x-1.5 bg-gray-200 hover:bg-white"
              >
                <ThumbsUp className="w-3.5 h-3.5 text-blue-800" />
                <span>Editorial Clap ({claps[selectedArticle.id] || 0})</span>
              </button>

              {selectedArticle.appId && onOpenApp && (
                <button
                  onClick={() => { playClickSound(); if (selectedArticle.appId) onOpenApp(selectedArticle.appId); }}
                  className="btn-w95 text-xs py-1.5 px-4 font-bold bg-blue-700 text-white hover:bg-blue-800 flex items-center space-x-1.5 shadow"
                >
                  <Flame className="w-3.5 h-3.5 text-yellow-300" />
                  <span>Launch {selectedArticle.appId} in Sandbox</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
