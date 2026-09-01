import React from 'react';
import { Flame, Wrench, Cpu, GitMerge, Mail, User, Sparkles, BookOpen, HelpCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { playClickSound } from '../lib/soundEngine';

interface MarketingWindowProps {
  onOpenSetup?: () => void;
  onOpenExplainer?: () => void;
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
  onOpenSetup,
  onOpenExplainer,
  onOpenHotwire,
  onOpenSlopshop,
  onOpenRig,
  onOpenGitsmith,
  onOpenInbox,
  onOpenProfile,
  onOpenWhitepapers,
  onDismiss
}) => {
  const { user } = useAuth();
  const userBadge = user?.username ? `@${user.username}` : '@nate';

  return (
    <div className="flex flex-col h-full font-tahoma text-sm">
      <div className="text-center py-2.5 border-b border-gray-300 mb-3">
        <div className="text-3xl font-black text-w95-blue tracking-tight mb-1.5">
          Stop renting software. Own your files. Mod with AI.
        </div>
        <p className="text-gray-700 text-sm max-w-3xl mx-auto leading-relaxed">
          A marketplace for software you buy once and keep. Every app comes with the running web version,
          the full source in a Git repo, native installers (<code className="bg-gray-200 px-1.5 py-0.5 rounded font-mono text-xs font-bold text-black">.dmg</code>, <code className="bg-gray-200 px-1.5 py-0.5 rounded font-mono text-xs font-bold text-black">.exe</code>, and more),
          and a real license key with your name on it. No subscription, ever.
        </p>
        <div className="mt-2.5 flex items-center justify-center gap-2">
          {onOpenExplainer && (
            <button
              type="button"
              onClick={() => {
                playClickSound();
                onOpenExplainer();
              }}
              className="btn-w95 px-4 py-2 font-bold text-xs flex items-center gap-1.5 shadow"
            >
              <HelpCircle size={14} className="text-blue-700" />
              <span>What is this? (Explainer)</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              playClickSound();
              if (onOpenSetup) onOpenSetup();
            }}
            className="btn-w95 btn-w95-primary px-5 py-2 font-bold text-xs flex items-center gap-1.5 shadow"
          >
            <Sparkles size={14} className="text-yellow-300" />
            <span>Try an app now &rarr;</span>
          </button>
        </div>
        <div className="text-xs text-gray-500 mt-2 font-sans">
          Free to browse and fork. Create a maker account when you're ready to publish.
        </div>
      </div>

      {/* How it works + Navigation Grid (shared scroll area) */}
      <div className="flex-1 overflow-y-auto mb-3">

      {/* How it works */}
      <div className="bg-white border-2 border-gray-800 p-3.5 mb-3 shadow-sm">
        <div className="text-w95-blue font-bold text-base mb-2">How it works</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-gray-700 text-xs leading-relaxed">
          <div>
            <div className="font-bold text-gray-900 mb-0.5">Buy it, own it</div>
            Buy an app once. It's yours: the live web app, the source repo, native installers,
            and a license key. Cancel nothing, because there's nothing to cancel.
          </div>
          <div>
            <div className="font-bold text-gray-900 mb-0.5">Publish and sell</div>
            Push your code to our forge and it builds and goes live on its own URL. No Dockerfile,
            no servers to set up. List it, set a price, drop it on HOTWIRE, and people buy it.
          </div>
          <div>
            <div className="font-bold text-gray-900 mb-0.5">Get paid on every sale</div>
            You keep <strong className="text-green-800">70%</strong>. <strong>20%</strong> goes up the chain
            to the makers you forked from. <strong>10%</strong> keeps the lights on here. Built something
            original with no parents? That 20% comes back to you, so it's <strong>90% you / 10% us</strong>.
          </div>
          <div>
            <div className="font-bold text-gray-900 mb-0.5">Fork and remix</div>
            Fork anyone's app, change it with AI in SLOPSHOP or the <code className="bg-gray-200 px-1 rounded font-mono">slop</code> CLI,
            and sell your version. When your fork sells, the makers you built on earn that 20% too. Forks of forks pay everyone up the line.
          </div>
        </div>
        <div className="text-[11px] text-gray-500 mt-2.5 border-t border-gray-200 pt-2">
          Coming soon: put a slice of your app's future sales up for grabs. Contribute code that gets merged, and you earn a cut of every sale from then on.
        </div>
      </div>

      {/* 6 Standalone Engines & Navigation Grid */}
      <div className="grid grid-cols-3 gap-3">
        {/* 1. HOTWIRE */}
        <div onClick={onOpenHotwire} className="bg-white border-2 border-gray-800 p-3.5 cursor-pointer hover:bg-blue-50 transition-colors flex flex-col justify-between group shadow-sm">
          <div>
            <div className="flex items-center justify-between text-w95-blue font-bold text-base mb-1.5">
              <span className="flex items-center gap-2"><Flame size={18} className="text-orange-600" /> HOTWIRE</span>
              <span className="text-xs text-gray-500 font-mono">DROPS</span>
            </div>
            <p className="text-gray-600 text-xs leading-relaxed">
              The daily 12:01 AM board where makers drop new apps and people vote them up.
            </p>
          </div>
          <span className="text-w95-blue font-bold text-xs mt-2 block group-hover:underline">Browse today's drops &rarr;</span>
        </div>

        {/* 2. SLOPSHOP */}
        <div onClick={onOpenSlopshop} className="bg-white border-2 border-gray-800 p-3.5 cursor-pointer hover:bg-blue-50 transition-colors flex flex-col justify-between group shadow-sm">
          <div>
            <div className="flex items-center justify-between text-w95-blue font-bold text-base mb-1.5">
              <span className="flex items-center gap-2"><Wrench size={18} className="text-blue-700" /> SLOPSHOP</span>
              <span className="text-xs text-gray-500 font-mono">AI SHOP</span>
            </div>
            <p className="text-gray-600 text-xs leading-relaxed">
              Fork any app in one click, then add features with Claude or Codex right in the browser.
            </p>
          </div>
          <span className="text-w95-blue font-bold text-xs mt-2 block group-hover:underline">Mod an app with AI &rarr;</span>
        </div>

        {/* 3. RIG.EXE */}
        <div onClick={onOpenRig} className="bg-white border-2 border-gray-800 p-3.5 cursor-pointer hover:bg-blue-50 transition-colors flex flex-col justify-between group shadow-sm">
          <div>
            <div className="flex items-center justify-between text-w95-blue font-bold text-base mb-1.5">
              <span className="flex items-center gap-2"><Cpu size={18} className="text-green-700" /> RIG.EXE</span>
              <span className="text-xs text-gray-500 font-mono">RUNTIME</span>
            </div>
            <p className="text-gray-600 text-xs leading-relaxed">
              Runs your app in a sandboxed container. It sleeps when idle, so you don't pay for nothing.
            </p>
          </div>
          <span className="text-w95-blue font-bold text-xs mt-2 block group-hover:underline">See what's running &rarr;</span>
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
          <span className="text-w95-blue font-bold text-xs mt-2 block group-hover:underline">Browse the code &rarr;</span>
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
          <span className="text-w95-blue font-bold text-xs mt-2 block group-hover:underline">Open your mailbox &rarr;</span>
        </div>

        {/* 6. MY PROFILE (Replaces Multi-Platform) */}
        <div onClick={onOpenProfile} className="bg-blue-50 border-2 border-w95-blue p-3.5 cursor-pointer hover:bg-blue-100 transition-colors flex flex-col justify-between group shadow-sm">
          <div>
            <div className="flex items-center justify-between text-w95-blue font-bold text-base mb-1.5">
              <span className="flex items-center gap-2"><User size={18} className="text-blue-900" /> My Profile</span>
              <span className="text-xs text-green-700 font-bold font-mono">{userBadge}</span>
            </div>
            <p className="text-gray-600 text-xs leading-relaxed">
              Your maker page, SSH keys, earnings, and the shelf of apps you own.
            </p>
          </div>
          <span className="text-w95-blue font-bold text-xs mt-2 block group-hover:underline">See your profile &amp; shelf &rarr;</span>
        </div>
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
          {onOpenExplainer && (
            <button
              type="button"
              onClick={() => {
                playClickSound();
                onOpenExplainer();
              }}
              className="btn-w95 text-xs flex items-center gap-1 font-bold"
            >
              <HelpCircle size={14} className="text-blue-700" /> What is this?
            </button>
          )}
          <button onClick={onOpenWhitepapers} className="btn-w95">
            <BookOpen size={14} /> Architectural White Papers
          </button>
          <button onClick={onOpenHotwire} className="btn-w95">
            <Flame size={14} className="text-orange-600" /> Browse HOTWIRE Drops
          </button>
          <button
            onClick={() => {
              playClickSound();
              if (onOpenSetup) {
                onOpenSetup();
              } else {
                onOpenSlopshop();
              }
            }}
            className="btn-w95 btn-w95-primary"
          >
            <Sparkles size={14} /> Try an app now &rarr;
          </button>
        </div>
      </div>
    </div>
  );
};
