import React from 'react';
import { Flame, Wrench, GitMerge, Mail, User, Sparkles, BookOpen, Gauge } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { playClickSound } from '../lib/soundEngine';

interface MarketingWindowProps {
  onOpenSetup?: () => void;
  onOpenHotwire: () => void;
  onOpenSlopshop: () => void;
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
      body: 'A live window onto your local agent mailbox — watch your AI agents email each other in threaded discussions. Clone and run the mailbox server and this shows the threads; honest offline pane when it isn\'t running.',
      cta: 'Open your mailbox',
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
      <div className="text-center py-2.5 border-b border-gray-300 mb-3">
        <div className="text-3xl font-black text-w95-blue tracking-tight mb-1.5">
          WELCOME TO NATE'S SOFTWARE EMPORIUM
        </div>
        <p className="text-gray-700 text-sm max-w-3xl mx-auto leading-relaxed font-bold">
          Stop renting software. Own the source.
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

      <div className="flex-1 overflow-y-auto mb-3">

        <div className="bg-white border-2 border-gray-800 p-3.5 mb-3 shadow-sm">
          <div className="text-w95-blue font-bold text-base mb-2">What is this?</div>
          <p className="text-gray-800 text-xs leading-relaxed font-sans mb-2.5">
            A Win95 desktop where you buy apps outright. You get the live web app, the full source in a Git repo,
            and a real license key with your name on it. Fork any of it, change it with an AI agent, then sell your version.
            Nothing lists until it proves it builds and runs. Sales are final. No subscription, ever.
          </p>
          <div className="bg-gray-100 border border-gray-400 p-2.5 rounded text-xs">
            <div className="font-bold text-gray-900 mb-0.5 font-mono">The Money Model</div>
            <div className="text-gray-700 font-sans leading-relaxed">
              You set <strong>one royalty</strong> when you list. Anyone who forks your app and sells pays you that
              rate, frozen the day they forked so you can't jack it up later. Forks of forks pay everyone up the chain.
              The house takes a flat <strong className="text-green-800">10%</strong>. The seller keeps the rest.
            </div>
          </div>
        </div>

        <div className="bg-white border-2 border-gray-800 p-3.5 mb-4 shadow-sm">
          <div className="text-w95-blue font-bold text-base mb-2">How it works</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-gray-700 text-xs leading-relaxed">
            <div>
              <div className="font-bold text-gray-900 mb-0.5">Buy it, own it</div>
              Buy an app once and it's yours. Live web app, the full source in a Git repo, and a license key
              with your name on it.
            </div>
            <div>
              <div className="font-bold text-gray-900 mb-0.5">Publish and sell</div>
              Fork in your browser; publish from your machine. Push your fork up with the{' '}
              <code className="bg-gray-200 px-1 rounded font-mono">slop</code> CLI — it builds onto its own URL, no Dockerfile,
              no servers. Then list it on HOTWIRE at whatever price you set.
            </div>
            <div>
              <div className="font-bold text-gray-900 mb-0.5">Get paid on every sale</div>
              The platform takes a flat <strong>10%</strong>. Makers you forked from earn the royalty they
              froze the day you forked, and you keep the rest. Original app, no parents? <strong className="text-green-800">90% you / 10% us</strong>.
            </div>
            <div>
              <div className="font-bold text-gray-900 mb-0.5">Fork and remix</div>
              Fork anyone's app, change it with AI in SLOPSHOP or the <code className="bg-gray-200 px-1 rounded font-mono">slop</code> CLI,
              and sell your version. The makers you built on earn their frozen royalty. Forks of forks pay everyone up the chain.
            </div>
          </div>
        </div>

        <div className="text-center mb-3">
          <div className="text-2xl font-black text-w95-blue tracking-tight">ENTER ONE OF THE SHOPS</div>
          <div className="text-xs text-gray-500 font-sans mt-0.5">Each stands on its own — here's what they are and how they connect.</div>
        </div>

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
