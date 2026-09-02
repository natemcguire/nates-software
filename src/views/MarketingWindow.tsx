import React from 'react';
import { Flame, Wrench, Cpu, GitMerge, Mail, User, Sparkles, BookOpen, Gauge } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { playClickSound } from '../lib/soundEngine';

interface MarketingWindowProps {
  onOpenSetup?: () => void;
  onOpenHotwire: () => void;
  onOpenSlopshop: () => void;
  onOpenRig: () => void;
  onOpenGitsmith: () => void;
  onOpenInbox: () => void;
  onOpenProfile: () => void;
  onOpenWhitepapers: () => void;
  onOpenDyno?: () => void;
  onDismiss: () => void;
}

export const MarketingWindow: React.FC<MarketingWindowProps> = ({
  onOpenSetup,
  onOpenHotwire,
  onOpenSlopshop,
  onOpenRig,
  onOpenGitsmith,
  onOpenInbox,
  onOpenProfile,
  onOpenWhitepapers,
  onOpenDyno,
  onDismiss
}) => {
  const { user } = useAuth();
  const userBadge = user?.username ? `@${user.username}` : '@guest';

  const shops = [
    {
      key: 'hotwire',
      onOpen: onOpenHotwire,
      icon: <Flame size={18} className="text-orange-600" />,
      title: 'HOTWIRE',
      tag: 'DROPS',
      body: 'The daily 12:01 AM board where makers drop new apps and people vote them up.',
      cta: "Browse today's drops",
      cardClass: 'bg-white border-2 border-gray-800'
    },
    {
      key: 'slopshop',
      onOpen: onOpenSlopshop,
      icon: <Wrench size={18} className="text-blue-700" />,
      title: 'SLOPSHOP',
      tag: 'AI SHOP',
      body: 'Fork an app in one click and change it with an AI agent right in the browser. It uses GITSMITH as its git backend and runs your fork for you — the old "RIG" runtime is part of this now.',
      cta: 'Mod an app with AI',
      cardClass: 'bg-white border-2 border-gray-800'
    },
    {
      key: 'gitsmith',
      onOpen: onOpenGitsmith,
      icon: <GitMerge size={18} className="text-purple-700" />,
      title: 'GITSMITH',
      tag: 'FORGE',
      body: 'The git forge — bare repos over SSH with search and 1-click live preview links. Most people use it from their own terminal; it\'s the backend SLOPSHOP builds on, and it stands on its own too.',
      cta: 'Browse the code',
      cardClass: 'bg-white border-2 border-gray-800'
    },
    {
      key: 'inbox',
      onOpen: onOpenInbox,
      icon: <Mail size={18} className="text-yellow-700" />,
      title: 'INBOX',
      tag: 'COMMS',
      body: '3-pane async mailbox for human and agent discussions and merge proposals — approvals require you to actually read the diff first.',
      cta: 'Open your mailbox',
      cardClass: 'bg-white border-2 border-gray-800'
    },
    {
      key: 'rig',
      onOpen: onOpenRig,
      icon: <Cpu size={18} className="text-green-700" />,
      title: 'RIG.EXE',
      tag: 'RUNTIME',
      body: 'Runs your app in a sandboxed container. It sleeps when idle, so you don\'t pay for nothing.',
      cta: "See what's running",
      cardClass: 'bg-white border-2 border-gray-800'
    },
    ...(onOpenDyno
      ? [{
          key: 'dyno',
          onOpen: onOpenDyno,
          icon: <Gauge size={18} className="text-emerald-700" />,
          title: 'DYNO',
          tag: 'BENCH',
          body: 'A benchmark for how AI models and agent harnesses do on real-world tasks.',
          cta: 'See the benchmark',
          cardClass: 'bg-white border-2 border-gray-800'
        }]
      : []),
    {
      key: 'profile',
      onOpen: onOpenProfile,
      icon: <User size={18} className="text-blue-900" />,
      title: 'My Profile',
      tag: userBadge,
      tagClass: 'text-green-700 font-bold',
      body: 'Your maker page, SSH keys, owned licenses, earnings, and the shelf of apps you own.',
      cta: 'See your profile & shelf',
      cardClass: 'bg-blue-50 border-2 border-w95-blue'
    }
  ];

  return (
    <div className="flex flex-col h-full font-tahoma text-sm">
      {/* ── TOP TITLE ─────────────────────────────────────────────── */}
      <div className="text-center py-2.5 border-b border-gray-300 mb-3">
        <div className="text-3xl font-black text-w95-blue tracking-tight mb-1.5">
          WELCOME TO NATE'S SOFTWARE EMPORIUM
        </div>
        <p className="text-gray-700 text-sm max-w-3xl mx-auto leading-relaxed font-bold">
          Stop renting software. Own your files. Mod with AI.
        </p>
        <div className="mt-2.5 flex items-center justify-center gap-2">
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

      {/* Shared scroll area */}
      <div className="flex-1 overflow-y-auto mb-3">

        {/* ── WHAT IS THIS? ───────────────────────────────────────── */}
        <div className="bg-white border-2 border-gray-800 p-3.5 mb-3 shadow-sm">
          <div className="text-w95-blue font-bold text-base mb-2">What is this?</div>
          <p className="text-gray-800 text-xs leading-relaxed font-sans mb-2.5">
            A marketplace for software you buy once and own — not rent. Every purchase gives you the running
            web app, the full source in a Git repo, native installers (<code className="bg-gray-200 px-1.5 py-0.5 rounded font-mono text-[11px] font-bold text-black">.dmg</code>, <code className="bg-gray-200 px-1.5 py-0.5 rounded font-mono text-[11px] font-bold text-black">.exe</code>, and more),
            and a real license key with your name on it. Fork any app, change it with an AI agent, and sell your
            version; when a fork sells, revenue splits back down the lineage. No subscription, ever.
          </p>
          <div className="bg-gray-100 border border-gray-400 p-2.5 rounded text-xs">
            <div className="font-bold text-gray-900 mb-0.5 font-mono">The Money Model</div>
            <div className="text-gray-700 font-sans leading-relaxed">
              <strong className="text-green-800">70%</strong> to the seller, <strong>20%</strong> up the fork lineage,
              <strong> 10%</strong> to the protocol — a root app with no ancestors is <strong>90/10</strong>.
            </div>
          </div>
        </div>

        {/* ── HOW IT WORKS ────────────────────────────────────────── */}
        <div className="bg-white border-2 border-gray-800 p-3.5 mb-4 shadow-sm">
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

        {/* ── SECOND TITLE ────────────────────────────────────────── */}
        <div className="text-center mb-3">
          <div className="text-2xl font-black text-w95-blue tracking-tight">ENTER ONE OF THE SHOPS</div>
          <div className="text-xs text-gray-500 font-sans mt-0.5">Each stands on its own — here's what they are and how they connect.</div>
        </div>

        {/* App grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {shops.map((s) => (
            <div
              key={s.key}
              onClick={() => { playClickSound(); s.onOpen(); }}
              className={`${s.cardClass} p-3.5 cursor-pointer hover:bg-blue-50 transition-colors flex flex-col justify-between group shadow-sm`}
            >
              <div>
                <div className="flex items-center justify-between text-w95-blue font-bold text-base mb-1.5">
                  <span className="flex items-center gap-2">{s.icon} {s.title}</span>
                  <span className={`text-xs font-mono ${s.tagClass || 'text-gray-500'}`}>{s.tag}</span>
                </div>
                <p className="text-gray-600 text-xs leading-relaxed">{s.body}</p>
              </div>
              <span className="text-w95-blue font-bold text-xs mt-2 block group-hover:underline">{s.cta} &rarr;</span>
            </div>
          ))}
        </div>
      </div>

      {/* Footer Controls */}
      <div className="pt-2.5 border-t border-gray-300 flex items-center justify-between flex-wrap gap-2">
        <button
          onClick={onDismiss}
          className="text-gray-600 hover:text-black underline text-xs cursor-pointer"
        >
          ✕ Dismiss Window to Desktop (Reopen via "? What is this" anytime)
        </button>

        <div className="flex items-center gap-2.5">
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
