import React from 'react';
import { Flame, Wrench, GitMerge, Mail, Gauge, User, Terminal, MessageSquare, BookOpen, HelpCircle } from 'lucide-react';
import { playClickSound } from '../lib/soundEngine';

export interface ExplainerViewProps {
  onOpenHotwire?: () => void;
  onOpenSlopshop?: () => void;
  onOpenGitsmith?: () => void;
  onOpenInbox?: () => void;
  onOpenDyno?: () => void;
  onOpenProfile?: () => void;
  onOpenTerminal?: () => void;
  onOpenChat?: () => void;
  onOpenWhitepapers?: () => void;
  onDismiss?: () => void;
}

export const ExplainerView: React.FC<ExplainerViewProps> = ({
  onOpenHotwire,
  onOpenSlopshop,
  onOpenGitsmith,
  onOpenInbox,
  onOpenDyno,
  onOpenProfile,
  onOpenTerminal,
  onOpenChat,
  onOpenWhitepapers,
  onDismiss
}) => {
  return (
    <div className="flex flex-col h-full font-tahoma text-xs text-gray-900 select-none">
      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5 bg-white border-2 border-gray-800 shadow-inner">
        {/* Top Overview Paragraph */}
        <div className="border-b border-gray-300 pb-3">
          <div className="flex items-center gap-2 mb-1">
            <HelpCircle size={18} className="text-w95-blue" />
            <h1 className="text-base font-bold text-w95-blue tracking-tight font-mono">
              What is Nate's Software?
            </h1>
          </div>
          <p className="text-gray-800 text-xs leading-relaxed font-sans">
            A marketplace for software you buy once and own — not rent. Every purchase gives you a license and the source. Fork any app, change it with an AI agent, and sell your version; when a fork sells, revenue splits back down the lineage.
          </p>
        </div>

        {/* Money Model */}
        <div className="bg-gray-100 border border-gray-400 p-2.5 rounded text-xs">
          <div className="font-bold text-gray-900 mb-0.5 font-mono">The Money Model</div>
          <div className="text-gray-700 font-sans leading-relaxed">
            70% to the seller, 20% up the fork lineage, 10% to the protocol — a root app with no ancestors is 90/10.
          </div>
        </div>

        {/* App Directory Breakdown */}
        <div className="space-y-2.5">
          <div className="font-bold text-[11px] uppercase tracking-wider font-mono text-gray-600 border-b border-gray-200 pb-1">
            The Apps &amp; How They Connect
          </div>

          {/* Creation & Code */}
          <div className="space-y-1.5">
            {/* HOTWIRE */}
            <div
              data-testid="explainer-app-hotwire"
              onClick={() => {
                playClickSound();
                onOpenHotwire?.();
              }}
              className="flex items-start gap-2.5 p-2 rounded border border-gray-300 hover:border-blue-700 hover:bg-blue-50/60 cursor-pointer transition-colors"
            >
              <Flame size={16} className="text-orange-600 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="font-bold font-mono text-w95-blue">HOTWIRE</span>
                  <span className="text-[10px] text-gray-500 font-mono">Open &rarr;</span>
                </div>
                <p className="text-gray-700 leading-normal mt-0.5">
                  A daily board where makers drop new apps and people vote.
                </p>
              </div>
            </div>

            {/* SLOPSHOP */}
            <div
              data-testid="explainer-app-slopshop"
              onClick={() => {
                playClickSound();
                onOpenSlopshop?.();
              }}
              className="flex items-start gap-2.5 p-2 rounded border border-gray-300 hover:border-blue-700 hover:bg-blue-50/60 cursor-pointer transition-colors"
            >
              <Wrench size={16} className="text-blue-700 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="font-bold font-mono text-w95-blue">SLOPSHOP</span>
                  <span className="text-[10px] text-gray-500 font-mono">Open &rarr;</span>
                </div>
                <p className="text-gray-700 leading-normal mt-0.5">
                  Where you fork an app and change it with an AI agent in a terminal. (It uses GITSMITH as its git backend, and runs your forked app for you — the old &quot;RIG&quot; runtime is part of this now.)
                </p>
              </div>
            </div>

            {/* GITSMITH */}
            <div
              data-testid="explainer-app-gitsmith"
              onClick={() => {
                playClickSound();
                onOpenGitsmith?.();
              }}
              className="flex items-start gap-2.5 p-2 rounded border border-gray-300 hover:border-blue-700 hover:bg-blue-50/60 cursor-pointer transition-colors"
            >
              <GitMerge size={16} className="text-purple-700 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="font-bold font-mono text-w95-blue">GITSMITH</span>
                  <span className="text-[10px] text-gray-500 font-mono">Open &rarr;</span>
                </div>
                <p className="text-gray-700 leading-normal mt-0.5">
                  The git forge (bare repos over SSH). Most people use it from their own terminal; it's the backend SLOPSHOP builds on. It stands on its own too.
                </p>
              </div>
            </div>
          </div>

          {/* Review & Evaluation */}
          <div className="space-y-1.5 pt-1">
            {/* INBOX */}
            <div
              data-testid="explainer-app-inbox"
              onClick={() => {
                playClickSound();
                onOpenInbox?.();
              }}
              className="flex items-start gap-2.5 p-2 rounded border border-gray-300 hover:border-blue-700 hover:bg-blue-50/60 cursor-pointer transition-colors"
            >
              <Mail size={16} className="text-yellow-700 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="font-bold font-mono text-w95-blue">INBOX</span>
                  <span className="text-[10px] text-gray-500 font-mono">Open &rarr;</span>
                </div>
                <p className="text-gray-700 leading-normal mt-0.5">
                  Review and merge proposals; approvals require you to actually read the diff first.
                </p>
              </div>
            </div>

            {/* DYNO */}
            <div
              data-testid="explainer-app-dyno"
              onClick={() => {
                playClickSound();
                onOpenDyno?.();
              }}
              className="flex items-start gap-2.5 p-2 rounded border border-gray-300 hover:border-blue-700 hover:bg-blue-50/60 cursor-pointer transition-colors"
            >
              <Gauge size={16} className="text-emerald-700 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="font-bold font-mono text-w95-blue">DYNO</span>
                  <span className="text-[10px] text-gray-500 font-mono">Open &rarr;</span>
                </div>
                <p className="text-gray-700 leading-normal mt-0.5">
                  A benchmark for how AI models and agent harnesses do on real tasks.
                </p>
              </div>
            </div>
          </div>

          {/* Identity & Tools */}
          <div className="space-y-1.5 pt-1">
            {/* PROFILE & SHELF */}
            <div
              data-testid="explainer-app-profile"
              onClick={() => {
                playClickSound();
                onOpenProfile?.();
              }}
              className="flex items-start gap-2.5 p-2 rounded border border-gray-300 hover:border-blue-700 hover:bg-blue-50/60 cursor-pointer transition-colors"
            >
              <User size={16} className="text-blue-900 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="font-bold font-mono text-w95-blue">GITSMITH / PROFILE / SHELF</span>
                  <span className="text-[10px] text-gray-500 font-mono">Open &rarr;</span>
                </div>
                <p className="text-gray-700 leading-normal mt-0.5">
                  Your identity, keys, owned licenses, and earnings.
                </p>
              </div>
            </div>

            {/* TERMINAL & CHAT */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              <div
                data-testid="explainer-app-terminal"
                onClick={() => {
                  playClickSound();
                  onOpenTerminal?.();
                }}
                className="flex items-start gap-2 p-2 rounded border border-gray-300 hover:border-blue-700 hover:bg-blue-50/60 cursor-pointer transition-colors"
              >
                <Terminal size={16} className="text-green-700 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="font-bold font-mono text-w95-blue">TERMINAL</span>
                    <span className="text-[10px] text-gray-500 font-mono">&rarr;</span>
                  </div>
                  <p className="text-gray-700 leading-normal mt-0.5">
                    An in-browser shell.
                  </p>
                </div>
              </div>

              <div
                data-testid="explainer-app-chat"
                onClick={() => {
                  playClickSound();
                  onOpenChat?.();
                }}
                className="flex items-start gap-2 p-2 rounded border border-gray-300 hover:border-blue-700 hover:bg-blue-50/60 cursor-pointer transition-colors"
              >
                <MessageSquare size={16} className="text-yellow-600 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="font-bold font-mono text-w95-blue">CHAT</span>
                    <span className="text-[10px] text-gray-500 font-mono">&rarr;</span>
                  </div>
                  <p className="text-gray-700 leading-normal mt-0.5">
                    A live room.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Action Footer */}
      <div className="pt-2.5 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => {
            playClickSound();
            onDismiss?.();
          }}
          className="btn-w95 text-xs py-1 px-3 font-bold"
        >
          ✕ Close
        </button>
        <div className="flex items-center gap-2">
          {onOpenWhitepapers && (
            <button
              type="button"
              onClick={() => {
                playClickSound();
                onOpenWhitepapers();
              }}
              className="btn-w95 text-xs py-1 px-2.5 flex items-center gap-1"
            >
              <BookOpen size={12} />
              <span>White Papers</span>
            </button>
          )}
          {onOpenHotwire && (
            <button
              type="button"
              onClick={() => {
                playClickSound();
                onOpenHotwire();
              }}
              className="btn-w95 btn-w95-primary text-xs py-1 px-3 font-bold flex items-center gap-1"
            >
              <Flame size={12} className="text-orange-500" />
              <span>Browse HOTWIRE Drops &rarr;</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
