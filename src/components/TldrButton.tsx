import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { playClickSound } from '../lib/soundEngine';

const AGENT_PROMPT = `I'm exploring "Nate's Software" (https://nates-software.com) — a marketplace where you buy software once and own the source (the full source and a real license key), instead of renting SaaS. You can fork any app to run or mod for yourself; reselling a fork requires the author to have enabled resale. Each maker sets one royalty rate when they list; when you fork and sell, every maker you built on earns the rate they set — frozen the day you forked, so it can't change on you — and the platform takes a flat 10%. All sales are final, and nothing goes on sale until it's proven to run. It runs as a retro Windows-95-style desktop with these apps: HOTWIRE (daily drop board), SLOPSHOP (fork + AI-mod an app, then the platform builds and runs it for you), GITSMITH (git forge over SSH), INBOX (a live window onto your local AI agents emailing each other), DYNO (AI-agent benchmark), and PROFILE/Shelf (your account, earnings, and owned apps). Full explainer: https://nates-software.com/vision.md. Help me understand it, try it, or fork and build something on it.`;

export const TldrButton: React.FC = () => {
  const [copied, setCopied] = useState(false);

  const copyPrompt = () => {
    playClickSound();
    const done = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(AGENT_PROMPT).then(done).catch(done);
    } else {
      done();
    }
  };

  return (
    <div className="flex items-center bg-[#c0c0c0] border-2 border-white border-r-gray-800 border-b-gray-800 text-black text-[11px] font-tahoma">
      <button
        data-testid="tldr-copy-prompt"
        onClick={copyPrompt}
        className="flex items-center gap-1.5 px-2.5 py-1 font-bold cursor-pointer hover:bg-[#d0d0d0]"
        title="Copy a ready-made prompt to paste into your AI coding agent so it understands this site"
      >
        {copied ? <Check size={12} className="text-green-700" /> : <Copy size={12} className="text-blue-900" />}
        <span>{copied ? 'Prompt copied!' : 'TL;DR: Copy prompt for my agent'}</span>
      </button>
      <a
        href="/vision.md"
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => playClickSound()}
        className="px-2 py-1 text-blue-900 hover:text-black hover:bg-[#d0d0d0] border-l border-gray-400 font-bold"
        title="Read the plain-words explainer: what this is, the vision, and every app"
      >
        Read it →
      </a>
    </div>
  );
};
