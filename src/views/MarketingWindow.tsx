import React from 'react';
import { Flame, Wrench, Cpu, GitMerge, Mail, User, Sparkles, BookOpen } from 'lucide-react';

interface MarketingWindowProps {
  onOpenHotwire: () => void;
  onOpenSlopshop: () => void;
  onOpenRig: () => void;
  onOpenGitsmith: () => void;
  onOpenInbox: () => void;
  onOpenProfile: () => void;
  onOpenWhitepapers: () => void;
  onDismiss: () => void;
}

export const MarketingWindow: React.FC<MarketingWindowProps> = ({
  onOpenHotwire,
  onOpenSlopshop,
  onOpenRig,
  onOpenGitsmith,
  onOpenInbox,
  onOpenProfile,
  onOpenWhitepapers,
  onDismiss
}) => {
  return (
    <div className="flex flex-col h-full font-tahoma text-sm">
      <div className="text-center py-2.5 border-b border-gray-300 mb-3">
        <div className="text-3xl font-black text-w95-blue tracking-tight mb-1.5">
          Stop renting software. Own your files. Mod with AI.
        </div>
        <p className="text-gray-700 text-sm max-w-3xl mx-auto leading-relaxed">
          Nate's Software is a consumer marketplace for shareware you actually keep.
          You walk out with the running web app, a clean Git repository, single-file SQLite database,
          and native binaries for macOS (<code className="bg-gray-200 px-1.5 py-0.5 rounded font-mono text-xs font-bold text-black">.dmg</code>), Windows (<code className="bg-gray-200 px-1.5 py-0.5 rounded font-mono text-xs font-bold text-black">.exe</code>), Linux, and iOS.
        </p>
      </div>

      {/* 6 Standalone Engines & Navigation Grid */}
      <div className="grid grid-cols-3 gap-3 flex-1 overflow-y-auto mb-3">
        {/* 1. HOTWIRE */}
        <div onClick={onOpenHotwire} className="bg-white border-2 border-gray-800 p-3.5 cursor-pointer hover:bg-blue-50 transition-colors flex flex-col justify-between group shadow-sm">
          <div>
            <div className="flex items-center justify-between text-w95-blue font-bold text-base mb-1.5">
              <span className="flex items-center gap-2"><Flame size={18} className="text-orange-600" /> HOTWIRE</span>
              <span className="text-xs text-gray-500 font-mono">DROPS</span>
            </div>
            <p className="text-gray-600 text-xs leading-relaxed">
              Daily 12:01 AM drops leaderboard, maker streaks, and Nate's LLM Specs dyno scores.
            </p>
          </div>
          <span className="text-w95-blue font-bold text-xs mt-2 block group-hover:underline">Open Drops Board &rarr;</span>
        </div>

        {/* 2. SLOPSHOP */}
        <div onClick={onOpenSlopshop} className="bg-white border-2 border-gray-800 p-3.5 cursor-pointer hover:bg-blue-50 transition-colors flex flex-col justify-between group shadow-sm">
          <div>
            <div className="flex items-center justify-between text-w95-blue font-bold text-base mb-1.5">
              <span className="flex items-center gap-2"><Wrench size={18} className="text-blue-700" /> SLOPSHOP</span>
              <span className="text-xs text-gray-500 font-mono">AI SHOP</span>
            </div>
            <p className="text-gray-600 text-xs leading-relaxed">
              The AI speed shop: 1-click forking, AST feature splicing &amp; Claude/Codex launchers.
            </p>
          </div>
          <span className="text-w95-blue font-bold text-xs mt-2 block group-hover:underline">Enter Mod Bay &rarr;</span>
        </div>

        {/* 3. RIG.EXE */}
        <div onClick={onOpenRig} className="bg-white border-2 border-gray-800 p-3.5 cursor-pointer hover:bg-blue-50 transition-colors flex flex-col justify-between group shadow-sm">
          <div>
            <div className="flex items-center justify-between text-w95-blue font-bold text-base mb-1.5">
              <span className="flex items-center gap-2"><Cpu size={18} className="text-green-700" /> RIG.EXE</span>
              <span className="text-xs text-gray-500 font-mono">RUNTIME</span>
            </div>
            <p className="text-gray-600 text-xs leading-relaxed">
              Zero-fuss micro-container runtime with single-file SQLite persistence &amp; scale-to-zero.
            </p>
          </div>
          <span className="text-w95-blue font-bold text-xs mt-2 block group-hover:underline">Inspect Dynos (Ports 3001..3010) &rarr;</span>
        </div>

        {/* 4. GITSMITH */}
        <div onClick={onOpenGitsmith} className="bg-white border-2 border-gray-800 p-3.5 cursor-pointer hover:bg-blue-50 transition-colors flex flex-col justify-between group shadow-sm">
          <div>
            <div className="flex items-center justify-between text-w95-blue font-bold text-base mb-1.5">
              <span className="flex items-center gap-2"><GitMerge size={18} className="text-purple-700" /> GITSMITH</span>
              <span className="text-xs text-gray-500 font-mono">FORGE</span>
            </div>
            <p className="text-gray-600 text-xs leading-relaxed">
              GitHub-style bare Git forge over SSH with all repos, search, and 1-click live preview links.
            </p>
          </div>
          <span className="text-w95-blue font-bold text-xs mt-2 block group-hover:underline">Explore Bare Repos &rarr;</span>
        </div>

        {/* 5. INBOX */}
        <div onClick={onOpenInbox} className="bg-white border-2 border-gray-800 p-3.5 cursor-pointer hover:bg-blue-50 transition-colors flex flex-col justify-between group shadow-sm">
          <div>
            <div className="flex items-center justify-between text-w95-blue font-bold text-base mb-1.5">
              <span className="flex items-center gap-2"><Mail size={18} className="text-yellow-700" /> INBOX</span>
              <span className="text-xs text-gray-500 font-mono">COMMS</span>
            </div>
            <p className="text-gray-600 text-xs leading-relaxed">
              3-pane async email client for human and agent discussions &amp; 1-click merge approvals.
            </p>
          </div>
          <span className="text-w95-blue font-bold text-xs mt-2 block group-hover:underline">Open Mailbox (3) &rarr;</span>
        </div>

        {/* 6. MY PROFILE (Replaces Multi-Platform) */}
        <div onClick={onOpenProfile} className="bg-blue-50 border-2 border-w95-blue p-3.5 cursor-pointer hover:bg-blue-100 transition-colors flex flex-col justify-between group shadow-sm">
          <div>
            <div className="flex items-center justify-between text-w95-blue font-bold text-base mb-1.5">
              <span className="flex items-center gap-2"><User size={18} className="text-blue-900" /> My Profile</span>
              <span className="text-xs text-green-700 font-bold font-mono">@nate</span>
            </div>
            <p className="text-gray-600 text-xs leading-relaxed">
              Maker identity, verified SSH keys, protocol revenue wallet, and your Shareware shelf.
            </p>
          </div>
          <span className="text-w95-blue font-bold text-xs mt-2 block group-hover:underline">Open Profile &amp; Shelf &rarr;</span>
        </div>
      </div>

      {/* Footer Controls */}
      <div className="pt-2.5 border-t border-gray-300 flex items-center justify-between flex-wrap gap-2">
        <button
          onClick={onDismiss}
          className="text-gray-600 hover:text-black underline text-xs cursor-pointer"
        >
          ✕ Dismiss Window to Desktop (Reopen via icon anytime)
        </button>

        <div className="flex items-center gap-2.5">
          <button onClick={onOpenWhitepapers} className="btn-w95">
            <BookOpen size={14} /> Architectural White Papers
          </button>
          <button onClick={onOpenHotwire} className="btn-w95">
            <Flame size={14} className="text-orange-600" /> Browse HOTWIRE Drops
          </button>
          <button onClick={onOpenSlopshop} className="btn-w95 btn-w95-primary">
            <Sparkles size={14} /> Fork in SLOPSHOP &rarr;
          </button>
        </div>
      </div>
    </div>
  );
};
