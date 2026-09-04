import React, { useState } from 'react';
import { BookOpen, Cpu, Wrench, GitMerge, Mail, Flame, Download, ShieldCheck, Copy, Check, Scroll } from 'lucide-react';
import { WHITEPAPERS_DATA } from '../data/whitepapersData';
import { MONEY_MODEL_MARKDOWN } from '../data/moneyModelData';
import { MarkdownRenderer } from '../components/MarkdownRenderer';
import { Win95Scroll } from '../components/Win95Scroll';
import { playClickSound } from '../lib/soundEngine';

export const WhitePapersView: React.FC = () => {
  const [selectedTab, setSelectedTab] = useState<'rig' | 'slopshop' | 'gitsmith' | 'inbox' | 'hotwire' | 'suite' | 'moneyModel'>('gitsmith');
  const [copied, setCopied] = useState(false);

  const papers = {
    rig: {
      id: 'rig',
      title: "1. RIG.EXE Architectural White Paper",
      subtitle: "Runtime-Agnostic Ephemeral Build & Preview Isolation",
      icon: <Cpu size={16} className="text-green-700" />,
      content: WHITEPAPERS_DATA.rig
    },
    slopshop: {
      id: 'slopshop',
      title: "2. SLOPSHOP Architectural White Paper",
      subtitle: "AST-Aware Forking, Feature Splicing & Local AI Modding Speed Shop",
      icon: <Wrench size={16} className="text-blue-700" />,
      content: WHITEPAPERS_DATA.slopshop
    },
    gitsmith: {
      id: 'gitsmith',
      title: "3. GITSMITH Architectural White Paper",
      subtitle: "Bare Git Forge Over SSH & Atomic CAS Merge Engine",
      icon: <GitMerge size={16} className="text-purple-700" />,
      content: WHITEPAPERS_DATA.gitsmith
    },
    inbox: {
      id: 'inbox',
      title: "4. INBOX Architectural White Paper",
      subtitle: "3-Pane Async Email Client & AI Agent Comms Bridge",
      icon: <Mail size={16} className="text-yellow-700" />,
      content: WHITEPAPERS_DATA.inbox
    },
    hotwire: {
      id: 'hotwire',
      title: "5. HOTWIRE Architectural White Paper",
      subtitle: "Daily Drops Leaderboard, Streak Machines & Lineage Ledgers",
      icon: <Flame size={16} className="text-orange-600" />,
      content: WHITEPAPERS_DATA.hotwire
    },
    suite: {
      id: 'suite',
      title: "Suite Index & Architectural Boundary Spec",
      subtitle: "Decoupled Local-First Open Source System Invariants",
      icon: <BookOpen size={16} className="text-blue-900" />,
      content: WHITEPAPERS_DATA.suite
    },
    moneyModel: {
      id: 'moneyModel',
      title: "Shareware, Restored",
      subtitle: "How Forking, Frozen Royalties & Settlement Actually Work",
      icon: <Scroll size={16} className="text-emerald-700" />,
      content: MONEY_MODEL_MARKDOWN
    }
  };

  const current = papers[selectedTab];

  const handleCopyMd = () => {
    playClickSound();
    navigator.clipboard.writeText(current.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="grid grid-cols-12 gap-3 h-full overflow-hidden font-tahoma text-sm">
      <Win95Scroll className="col-span-4 bg-white border-2 border-gray-800 p-2.5 space-y-1.5 flex flex-col justify-between">
        <div className="space-y-1.5">
          <div className="font-bold text-base text-w95-blue border-b pb-1.5 mb-2 flex items-center gap-1.5">
            <BookOpen size={16} /> Architectural White Papers
          </div>
          {Object.values(papers).map((p) => (
            <div
              key={p.id}
              onClick={() => { playClickSound(); setSelectedTab(p.id as any); }}
              className={`p-2.5 border-2 cursor-pointer transition-all ${
                selectedTab === p.id ? 'bg-blue-50 border-w95-blue shadow-sm' : 'bg-gray-50 border-gray-300 hover:border-gray-500'
              }`}
            >
              <div className="font-bold text-gray-900 flex items-center gap-2 text-xs">
                {p.icon} {p.title}
              </div>
              <div className="text-gray-500 text-[11px] mt-0.5 truncate">{p.subtitle}</div>
            </div>
          ))}
        </div>

        <div className="bg-blue-50 p-2.5 border border-w95-blue rounded text-[11px] text-gray-700 mt-4 space-y-1">
          <div className="font-bold text-w95-blue flex items-center gap-1">
            <ShieldCheck size={13} className="text-green-700" /> Peer-Reviewed Specifications:
          </div>
          <p className="leading-relaxed">
            All 5 white papers are released under open licenses and explain why each tool is completely standalone and self-hostable.
          </p>
        </div>
      </Win95Scroll>

      <div className="col-span-8 bg-white border-2 border-gray-800 p-5 overflow-y-auto flex flex-col">
        <div className="border-b pb-3 mb-4 flex items-start justify-between flex-wrap gap-2">
          <div>
            <div className="text-xl font-black text-w95-blue flex items-center gap-2">
              {current.icon} {current.title}
            </div>
            <div className="text-gray-600 text-xs mt-0.5 font-medium">{current.subtitle}</div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopyMd}
              className="btn-w95 text-xs py-1 px-2.5 flex items-center gap-1"
            >
              {copied ? <Check size={12} className="text-green-700" /> : <Copy size={12} />}
              <span>{copied ? 'Copied MD' : 'Copy MD'}</span>
            </button>

            <a
              href={`data:text/markdown;charset=utf-8,${encodeURIComponent(current.content)}`}
              download={`${current.id}-whitepaper.md`}
              className="btn-w95 text-xs py-1 px-2.5 flex items-center gap-1"
            >
              <Download size={12} /> Export .md
            </a>
          </div>
        </div>

        <Win95Scroll className="flex-1 p-6 bg-[#fafafa] border border-gray-300 rounded shadow-inner select-text">
          <MarkdownRenderer content={current.content} />
        </Win95Scroll>
      </div>
    </div>
  );
};
