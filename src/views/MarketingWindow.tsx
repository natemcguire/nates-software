import React from 'react';
import { Flame, BookOpen, ExternalLink } from 'lucide-react';
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

interface SpecItem {
  name: string;
  desc: string;
  onOpen?: () => void;
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

  const specs: SpecItem[] = [
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
      name: 'SERVERS & HOSTING',
      desc: 'Free tier and ephemeral envs'
    },
    {
      name: 'SLOPSHOP',
      desc: 'Virtualized forking with AI agents in the browser',
      onOpen: onOpenSlopshop
    },
    {
      name: 'AGENT INBOX',
      desc: 'A live window onto your local AI agents',
      onOpen: onOpenInbox
    },
    {
      name: 'DYNO',
      desc: 'Real-world AI model + agent benchmark',
      onOpen: onOpenDyno
    }
  ];

  return (
    <div className="flex flex-col h-full font-tahoma text-sm">
      <div className="pt-3 pb-2.5 px-4 border-b border-gray-300">
        <div className="text-2xl font-black text-w95-blue tracking-tight leading-none">
          NATE'S SOFTWARE EMPORIUM
        </div>
        <p className="text-gray-800 text-sm font-black mt-1">
          Marketplace For the Software Enthusiasts
        </p>
        <p className="text-gray-600 text-xs font-semibold mt-0.5">
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
        <div className="px-4 py-3 space-y-4">
          <div className="text-gray-800 text-sm leading-relaxed font-sans space-y-1.5">
            <p>Buy it once. It's yours the way a hammer is yours.</p>
            <p>You get the Git repo. Fork anything.</p>
            <p>Remix it by talking to an agent; your forks can pay you.</p>
            <p>Cancel nothing, because there's nothing to cancel.</p>
          </div>

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
                {specs.map((s) => {
                  const isLink = Boolean(s.onOpen);
                  return (
                    <tr
                      key={s.name}
                      onClick={() => { if (isLink && s.onOpen) { playClickSound(); s.onOpen(); } }}
                      className={`border-t border-gray-300 ${isLink ? 'cursor-pointer hover:bg-blue-50 group' : 'cursor-default'}`}
                    >
                      <td className={`align-top px-3 py-2 font-bold whitespace-nowrap w-px ${isLink ? 'text-w95-blue underline decoration-dotted group-hover:decoration-solid' : 'text-gray-900'}`}>
                        {s.name}
                      </td>
                      <td className="align-top px-3 py-2 font-sans leading-snug text-gray-800">
                        {s.desc}
                      </td>
                      <td className="align-top px-2 py-2 text-right w-6">
                        {isLink && <span className="text-blue-800 font-bold font-mono">▸</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-2">
            <button
              onClick={() => { playClickSound(); onOpenWhitepapers(); }}
              className="btn-w95 justify-start"
            >
              <BookOpen size={14} className="text-blue-700" /> Architectural White Papers &amp; Editorial
            </button>
          </div>
        </div>
      </Win95Scroll>

      <div className="pt-2.5 pb-1 px-4 border-t border-gray-300 flex items-center justify-between flex-wrap gap-2">
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
