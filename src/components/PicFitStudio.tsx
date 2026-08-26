import React, { useState } from 'react';
import { Sparkles, CheckCircle2, Wand2 } from 'lucide-react';
import { playClickSound, playSuccessChime } from '../lib/soundEngine';

interface Garment {
  id: string;
  name: string;
  category: string;
  color: string;
  price: string;
  texture: string;
}

const GARMENTS: Garment[] = [
  { id: 'g1', name: '90s Vintage Distressed Leather', category: 'Outerwear', color: '#3e2723', price: '$240', texture: 'Heavy Cowhide' },
  { id: 'g2', name: 'EBP Raw Selvedge Denim Jacket', category: 'Outerwear', color: '#1a237e', price: '$180', texture: '14oz Japanese Denim' },
  { id: 'g3', name: 'Retro Cyberpunk Neon Windbreaker', category: 'Athleisure', color: '#00e676', price: '$120', texture: 'Ripstop Nylon' },
  { id: 'g4', name: 'Minimalist Relaxed White Linen', category: 'Shirts', color: '#f5f5f5', price: '$95', texture: 'French Flax Linen' }
];

const MODELS = [
  { id: 'm1', name: 'Nate McGuire', role: 'Casual / Everyday', avatar: '👨‍💻' },
  { id: 'm2', name: 'Alex Vance', role: 'Studio Editorial', avatar: '✨' },
  { id: 'm3', name: 'Sarah Connor', role: 'Athletic / Techwear', avatar: '⚡' },
  { id: 'm4', name: 'Retro 8-Bit Pixel Sprite', role: 'DOS Arcade Avatar', avatar: '👾' }
];

export const PicFitStudio: React.FC = () => {
  const [selectedModel, setSelectedModel] = useState(MODELS[0]);
  const [selectedGarment, setSelectedGarment] = useState<Garment>(GARMENTS[0]);
  const [lighting, setLighting] = useState<'studio' | 'sunset' | 'cyber' | 'monochrome'>('sunset');
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [synthesisProgress, setSynthesisProgress] = useState(0);
  const [sliderPos, setSliderPos] = useState(50);
  const [savedCount, setSavedCount] = useState(4);
  const [isSaved, setIsSaved] = useState(false);

  const handleSynthesize = () => {
    playClickSound();
    setIsSynthesizing(true);
    setSynthesisProgress(15);

    const t1 = setTimeout(() => setSynthesisProgress(45), 300);
    const t2 = setTimeout(() => setSynthesisProgress(80), 700);
    const t3 = setTimeout(() => {
      setSynthesisProgress(100);
      setIsSynthesizing(false);
      playSuccessChime();
    }, 1100);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  };

  const handleSaveToSqlite = () => {
    playSuccessChime();
    setSavedCount(prev => prev + 1);
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  return (
    <div className="h-full flex flex-col md:flex-row bg-[#ece9d8] font-tahoma text-xs overflow-hidden select-none">
      {/* Left Controls: Garment & Model Selector */}
      <div className="w-full md:w-80 bg-w95-gray border-r-2 border-gray-400 p-3 flex flex-col gap-3 overflow-y-auto shrink-0">
        <div className="bg-[#000080] text-white px-2 py-1 font-bold text-xs flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Sparkles size={13} className="text-pink-300" />
            <span>WARDROBE &amp; MODEL SYNTHESIS</span>
          </div>
          <span className="text-[10px] font-mono bg-blue-900 px-1.5 py-0.5 rounded">Gemini 2.5</span>
        </div>

        {/* Model Picker */}
        <div>
          <label className="block text-gray-700 font-bold mb-1">Target Model / Subject</label>
          <div className="grid grid-cols-2 gap-1.5">
            {MODELS.map(m => (
              <button
                key={m.id}
                onClick={() => { playClickSound(); setSelectedModel(m); }}
                className={`p-1.5 text-left border flex items-center gap-1.5 ${
                  selectedModel.id === m.id
                    ? 'bg-white border-2 border-t-black border-l-black border-b-white border-r-white font-bold text-blue-900 shadow-inner'
                    : 'bg-w95-gray border-t-white border-l-white border-b-black border-r-black hover:bg-gray-200'
                }`}
              >
                <span className="text-base">{m.avatar}</span>
                <div className="truncate">
                  <div className="text-[11px] truncate font-bold">{m.name}</div>
                  <div className="text-[9px] text-gray-500 truncate font-mono">{m.role}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Garment Rack */}
        <div>
          <label className="block text-gray-700 font-bold mb-1">Garment Rack</label>
          <div className="space-y-1">
            {GARMENTS.map(g => (
              <button
                key={g.id}
                onClick={() => { playClickSound(); setSelectedGarment(g); }}
                className={`w-full text-left p-2 border flex items-center justify-between transition-colors ${
                  selectedGarment.id === g.id
                    ? 'bg-white border-2 border-t-black border-l-black border-b-white border-r-white font-bold text-purple-950 shadow-inner'
                    : 'bg-w95-gray border-t-white border-l-white border-b-black border-r-black hover:bg-gray-200 text-gray-800'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full border border-gray-400 shrink-0" style={{ backgroundColor: g.color }} />
                  <div>
                    <div className="text-xs">{g.name}</div>
                    <div className="text-[10px] text-gray-500 font-mono">{g.texture} · {g.category}</div>
                  </div>
                </div>
                <span className="text-[10px] text-purple-900 font-mono font-bold">{g.price}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Lighting Environments */}
        <div>
          <label className="block text-gray-700 font-bold mb-1">Studio Lighting &amp; Atmosphere</label>
          <div className="grid grid-cols-2 gap-1 font-mono text-[10px]">
            {[
              { id: 'sunset', label: 'Sunset Golden Hour' },
              { id: 'studio', label: 'Studio Neutral' },
              { id: 'cyber', label: 'Cyber 80s Neon' },
              { id: 'monochrome', label: 'High Contrast B&W' }
            ].map(l => (
              <button
                key={l.id}
                onClick={() => { playClickSound(); setLighting(l.id as any); }}
                className={`p-1 text-center border ${
                  lighting === l.id
                    ? 'bg-purple-100 border-2 border-t-black border-l-black border-b-white border-r-white font-bold text-purple-900'
                    : 'bg-w95-gray border-t-white border-l-white border-b-black border-r-black'
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>

        {/* Synthesis Action */}
        <div className="space-y-1.5 pt-2 border-t border-gray-300 mt-auto">
          {isSynthesizing ? (
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] font-mono text-purple-900 font-bold">
                <span>Gemini Vision Synthesis...</span>
                <span>{synthesisProgress}%</span>
              </div>
              <div className="w-full bg-gray-300 h-3 border border-gray-500 p-0.5">
                <div className="bg-purple-700 h-full transition-all duration-200" style={{ width: `${synthesisProgress}%` }} />
              </div>
            </div>
          ) : (
            <button
              onClick={handleSynthesize}
              className="btn-w95 btn-w95-primary w-full py-2 font-bold text-xs flex items-center justify-center gap-1.5 text-white"
            >
              <Wand2 size={13} className="text-yellow-300" />
              <span>Synthesize Fit on {selectedModel.name}</span>
            </button>
          )}

          <button
            onClick={handleSaveToSqlite}
            className="btn-w95 w-full py-1 text-xs flex items-center justify-center gap-1.5"
          >
            <CheckCircle2 size={12} />
            <span>{isSaved ? '✔ Saved Look to /data/picfitai.sqlite' : `Save Look to SQLite (${savedCount} saved)`}</span>
          </button>
        </div>
      </div>

      {/* Right Viewport: Before / After Split Slider */}
      <div className="flex-1 bg-slate-900 p-4 flex flex-col items-center justify-center relative overflow-hidden">
        {/* Main Canvas Area */}
        <div className="w-full max-w-xl aspect-[4/3] bg-black border-2 border-slate-700 rounded-lg overflow-hidden relative shadow-2xl flex items-center justify-center">
          {/* Background Scene */}
          <div
            className={`absolute inset-0 transition-opacity duration-500 ${
              lighting === 'sunset'
                ? 'bg-gradient-to-tr from-amber-900/60 via-orange-800/40 to-indigo-950/80'
                : lighting === 'cyber'
                ? 'bg-gradient-to-tr from-purple-950 via-pink-900/40 to-cyan-950/80'
                : lighting === 'monochrome'
                ? 'bg-gradient-to-b from-gray-900 via-gray-800 to-black'
                : 'bg-gradient-to-b from-slate-900 via-slate-800 to-slate-950'
            }`}
          />

          {/* Model & Garment Overlay */}
          <div className="relative z-10 text-center space-y-3 p-6 select-none">
            <div className="text-6xl drop-shadow-2xl animate-bounce duration-1000">{selectedModel.avatar}</div>
            <div className="font-mono text-base font-bold text-white tracking-wide">
              {selectedModel.name} <span className="text-pink-400">×</span> {selectedGarment.name}
            </div>
            <div className="bg-black/70 backdrop-blur-sm border border-slate-700 p-2.5 rounded font-mono text-[11px] text-slate-300 max-w-md mx-auto space-y-1">
              <div className="flex justify-between text-slate-400">
                <span>Garment Fabric:</span>
                <span className="text-pink-300 font-bold">{selectedGarment.texture}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Lighting Rig:</span>
                <span className="text-cyan-300 uppercase font-bold">{lighting}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Local Database Ledger:</span>
                <span className="text-emerald-400">/data/picfitai.sqlite (WAL)</span>
              </div>
            </div>
          </div>

          {/* Interactive Split Comparison Slider */}
          <div className="absolute bottom-3 left-4 right-4 z-20 bg-black/80 backdrop-blur-md p-2 rounded border border-slate-700 flex items-center gap-3">
            <span className="text-[10px] font-mono text-slate-400">Before (Base)</span>
            <input
              type="range"
              min="0"
              max="100"
              value={sliderPos}
              onChange={(e) => setSliderPos(Number(e.target.value))}
              className="flex-1 accent-pink-500 cursor-pointer h-1.5 bg-slate-700 rounded-lg"
            />
            <span className="text-[10px] font-mono text-pink-300 font-bold">Synthesized ({sliderPos}%)</span>
          </div>
        </div>
      </div>
    </div>
  );
};
