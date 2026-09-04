import React from 'react';
import { Flame, BookOpen, ExternalLink, Newspaper } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { playClickSound } from '../lib/soundEngine';
import { Win95Scroll } from '../components/Win95Scroll';

interface MarketingWindowProps {
  onOpenSetup?: () => void;
  onOpenHotwire: () => void;
  onOpenSlopshop: () => void;
  onOpenGitsmith: (repoSlug?: string) => void;
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

  const specs = [
    {
      name: 'HOTWIRE',
      desc: 'App store marketplace',
      onOpen: onOpenHotwire
    },
    {
      name: 'GITSMITH',
      desc: 'Backed by our own git system, built for agents',
      onOpen: () => onOpenGitsmith()
    },
    {
      name: 'Servers & hosting',
      desc: 'Push a repo, get a live URL — no Dockerfile, no servers',
      onOpen: onOpenWhitepapers
    },
    {
      name: 'SLOPSHOP',
      desc: 'Virtualized forking with AI agents in the browser',
      onOpen: onOpenSlopshop
    },
    {
      name: 'Agent Inbox',
      desc: 'A live window onto your local AI agents',
      soon: true,
      onOpen: onOpenInbox
    },
    {
      name: 'DYNO',
      desc: 'Real-world AI model + agent benchmark',
      soon: true,
      onOpen: onOpenDyno
    }
  ];

  return (
    <div className="flex flex-col h-full font-tahoma text-sm">
      <div className="pt-3 pb-2.5 px-1 border-b border-gray-300">
        <div className="text-2xl font-black text-w95-blue tracking-tight leading-none">
          NATE'S SOFTWARE EMPORIUM
        </div>
        <p className="text-gray-800 text-sm font-black mt-1">
          Other sites let you fork code. We let you fork revenue.
        </p>
        <a
          href="/vision.md"
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => playClickSound()}
          className="inline-flex items-center gap-1 text-w95-blue hover:underline text-xs font-bold mt-1.5"
        >
          <BookOpen size={12} /> Read the full vision
          <ExternalLink size={10} />
        </a>
      </div>

      <Win95Scroll className="flex-1">
        <div className="px-1 py-3 space-y-4">
          <p className="text-gray-800 text-sm leading-relaxed font-sans">
            Buy a web app once and own the source forever — the live app, the full Git repo, and a
            real license key with your name on it. Fork anything, remix it with an AI agent, and sell
            your version; the maker you built on earns the royalty they locked the day you forked.
          </p>

          <div>
            <button
              type="button"
              onClick={() => { playClickSound(); onOpenHotwire(); }}
              className="btn-w95 btn-w95-primary w-full py-4 flex items-center justify-center gap-3 shadow"
            >
              <Flame size={28} className="text-orange-400" />
              <span className="text-lg font-black tracking-tight">Open HOTWIRE</span>
            </button>
            <p className="text-gray-600 text-xs font-sans mt-1.5 text-center">
              Browse the hottest builds and find something you can use or fork today.
            </p>
          </div>

          <div className="bg-white border-2 border-gray-800 shadow-sm">
            <div className="bg-w95-blue text-white font-bold text-xs px-3 py-1.5">
              Technical Specs for Nate's Software <span className="font-normal opacity-80">(aka How it works)</span>
            </div>
            <table className="w-full text-xs">
              <tbody>
                {specs.map((s) => (
                  <tr
                    key={s.name}
                    onClick={() => { if (!s.soon && s.onOpen) { playClickSound(); s.onOpen(); } }}
                    className={`border-t border-gray-300 ${s.soon ? 'opacity-60' : 'cursor-pointer hover:bg-blue-50'}`}
                  >
                    <td className="align-top px-3 py-2 font-bold text-w95-blue whitespace-nowrap w-px">
                      {s.name}
                      {s.soon && <span className="ml-1.5 text-[10px] font-mono text-gray-500">(coming soon)</span>}
                    </td>
                    <td className="align-top px-3 py-2 text-gray-700 font-sans leading-snug">
                      {s.desc}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-2">
            <button
              onClick={() => { playClickSound(); onOpenWhitepapers(); }}
              className="btn-w95 justify-start"
            >
              <Newspaper size={14} className="text-blue-700" /> Editorial — AI benchmarks, tooling &amp; shareware
            </button>
            <button
              onClick={() => { playClickSound(); onOpenWhitepapers(); }}
              className="btn-w95 justify-start"
            >
              <BookOpen size={14} /> Architectural White Papers
            </button>
          </div>
        </div>
      </Win95Scroll>

      <div className="pt-2.5 border-t border-gray-300 flex items-center justify-between flex-wrap gap-2">
        <button
          onClick={onDismiss}
          className="text-gray-600 hover:text-black underline text-xs cursor-pointer"
        >
          ✕ Dismiss to Desktop
        </button>
        <button
          onClick={() => {
            playClickSound();
            if (user?.username) onOpenProfile();
            else if (onOpenSetup) onOpenSetup();
          }}
          className="btn-w95"
        >
          {user?.username ? 'Account & shelf' : 'Set up your account'} &rarr;
        </button>
      </div>
    </div>
  );
};
