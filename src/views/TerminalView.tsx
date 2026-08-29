import React, { useState, useRef, useEffect } from 'react';
import { Terminal as TerminalIcon } from 'lucide-react';
import { playClickSound, playSuccessChime, playErrorBeep } from '../lib/soundEngine';
import { runSlopCli } from '../../bin/slop.ts';
import { useAuth } from '../context/AuthContext';

interface TerminalLine {
  text: string;
  type?: 'input' | 'output' | 'error' | 'success' | 'system' | 'matrix';
}

export const TerminalView: React.FC = () => {
  const { user } = useAuth();
  const [history, setHistory] = useState<TerminalLine[]>([
    { text: "Nate's Software Browser Command Console v2.5.0", type: 'system' },
    { text: "This is not a host shell: Git, npm, and local LLM CLIs run in your native terminal.", type: 'system' },
    { text: "", type: 'output' }
  ]);

  const [inputVal, setInputVal] = useState('');
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState<number>(-1);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      executeCommand(inputVal.trim());
    } else if (e.key === 'ArrowUp') {
      if (commandHistory.length > 0) {
        const nextIdx = historyIdx + 1 < commandHistory.length ? historyIdx + 1 : historyIdx;
        setHistoryIdx(nextIdx);
        setInputVal(commandHistory[commandHistory.length - 1 - nextIdx] || '');
      }
    } else if (e.key === 'ArrowDown') {
      if (historyIdx > 0) {
        const nextIdx = historyIdx - 1;
        setHistoryIdx(nextIdx);
        setInputVal(commandHistory[commandHistory.length - 1 - nextIdx] || '');
      } else if (historyIdx === 0) {
        setHistoryIdx(-1);
        setInputVal('');
      }
    }
  };

  const executeCommand = async (cmd: string) => {
    if (!cmd) return;

    playClickSound();
    setCommandHistory(prev => [...prev, cmd]);
    setHistoryIdx(-1);

    const newLines: TerminalLine[] = [{ text: `$ ${cmd}`, type: 'input' }];
    const parts = cmd.split(' ');
    const root = parts[0]?.toLowerCase();

    // 1. SLOP CLI Direct Command Bridge
    if (root === 'slop') {
      const slopArgs = parts.slice(1);
      if (slopArgs[0]?.toLowerCase() === 'fork') {
        playErrorBeep();
        newLines.push(
          { text: 'A real fork needs a host filesystem, Git, Node/npm, and your local LLM credentials.', type: 'error' },
          { text: `Run this in your native terminal: slop fork ${slopArgs[1] || 'nate/dronehunter'}`, type: 'system' },
          { text: 'After installation completes, SLOP will ask: Start your engines?', type: 'output' }
        );
        setHistory(prev => [...prev, ...newLines]);
        setInputVal('');
        return;
      }
      const resOrPromise = runSlopCli(slopArgs);
      const res = resOrPromise instanceof Promise ? await resOrPromise : resOrPromise;
      
      if (res.success) {
        playSuccessChime();
        if (res.message) {
          const lines = res.message.split('\n');
          lines.forEach(l => newLines.push({ text: l, type: 'success' }));
        }
      } else {
        playErrorBeep();
        newLines.push({ text: res.message || (res as any).error || 'Command failed', type: 'error' });
      }
      setHistory(prev => [...prev, ...newLines]);
      setInputVal('');
      return;
    }

    // 2. Builtin DOS/UNIX Commands
    switch (root) {
      case 'help':
        newLines.push(
          { text: "Nate's Software Terminal Help Index:", type: 'system' },
          { text: "  slop <command>         - Preview browser-safe SLOP commands", type: 'output' },
          { text: "    slop fork <slug>     - Requires the native CLI; this browser cannot create a host worktree", type: 'output' },
          { text: "    slop mod <feature>   - Splice AST feature package into project", type: 'output' },
          { text: "    slop dyno [--bench]  - Benchmark model + harness + tools on common dev tasks (independent suite)", type: 'output' },
          { text: "    slop test            - Run Local-First runtime verification test proofs", type: 'output' },
          { text: "    slop status          - Inspect micro-containers & active ports (3001..3010)", type: 'output' },
          { text: "    slop list            - Query 12:01 AM daily drops on Cloudflare D1", type: 'output' },
          { text: "    slop shelf           - Display owned software titles & license keys", type: 'output' },
          { text: "  whoami                 - Print authenticated user handle & permissions", type: 'output' },
          { text: "  ls [/data]             - List files in current Local-First volume", type: 'output' },
          { text: "  neofetch               - Display system hardware & OS telemetry", type: 'output' },
          { text: "  matrix                 - Render falling code matrix stream", type: 'output' },
          { text: "  clear                  - Clear terminal buffer", type: 'output' },
          { text: "  date                   - Output current ISO timestamp", type: 'output' }
        );
        break;

      case 'git':
      case 'npm':
      case 'npx':
      case 'node':
      case 'agy':
      case 'claude':
      case 'aider':
      case 'cursor':
        playErrorBeep();
        newLines.push(
          { text: `${root} is not available in this browser command console.`, type: 'error' },
          { text: `Open your native terminal, verify '${root} --version', then run: slop fork nate/dronehunter`, type: 'system' },
          { text: "SLOP will install the fork first and ask which LLM/IDE to start at the end.", type: 'output' }
        );
        break;

      case 'clear':
        setHistory([]);
        setInputVal('');
        return;

      case 'whoami':
        if (user) {
          newLines.push(
            { text: `User: @${user.username} (${user.displayName})`, type: 'success' },
            { text: `Role: ${user.role} ${user.isSuperAdmin ? '[SUPER ADMIN]' : ''}`, type: 'output' },
            { text: `Avatar: ${user.avatar}`, type: 'output' }
          );
        } else {
          newLines.push({ text: "Guest User (Unauthenticated). Type 'slop login' or click Log In.", type: 'system' });
        }
        break;

      case 'ls':
        const targetPath = parts[1] || '.';
        if (targetPath.includes('/data') || targetPath.includes('data')) {
          newLines.push(
            { text: "total 3", type: 'output' },
            { text: "-rw-r--r--  1 nate  staff  15518920 Aug 26 08:00 dronehunter.sqlite", type: 'output' },
            { text: "-rw-r--r--  1 nate  staff   1468006 Aug 26 08:00 certified-mailer.sqlite", type: 'output' },
            { text: "-rw-r--r--  1 nate  staff   4404019 Aug 26 08:00 picfitai.sqlite", type: 'output' }
          );
        } else {
          newLines.push(
            { text: "bin/   data/   dist/   functions/   migrations/   src/   package.json   wrangler.toml", type: 'output' }
          );
        }
        break;

      case 'date':
        newLines.push({ text: new Date().toISOString(), type: 'output' });
        break;

      case 'neofetch':
        newLines.push(
          { text: "       .---.       nate@macmini", type: 'system' },
          { text: "      /     \      ------------", type: 'system' },
          { text: "     | () () |     OS: Nate's Software Web OS 95", type: 'output' },
          { text: "      \  -  /      Host: Apple Mac mini (M4 Max)", type: 'output' },
          { text: "       `---'       Kernel: Runtime & Storage Independent", type: 'output' },
          { text: "                   Uptime: 99.98% (Scale-to-Zero)", type: 'output' },
          { text: "                   Packages: 3 Shareware Apps (dronehunter, certified-mailer, picfitai)", type: 'output' },
          { text: "                   Shell: SLOP CLI v1.0.0", type: 'output' },
          { text: "                   Memory: 48MB / 256MB Cap Enforced", type: 'success' }
        );
        break;

      case 'matrix':
        newLines.push(
          { text: "Wake up, Neo...", type: 'matrix' },
          { text: "The Matrix has you.", type: 'matrix' },
          { text: "Follow the white rabbit.", type: 'matrix' },
          { text: "Knock, knock, Neo.", type: 'matrix' }
        );
        break;

      default:
        playErrorBeep();
        newLines.push({
          text: `Command not found: '${cmd}'. Type 'help' or 'slop help' for valid commands.`,
          type: 'error'
        });
        break;
    }

    setHistory(prev => [...prev, ...newLines]);
    setInputVal('');
  };

  return (
    <div className="h-full flex flex-col bg-black text-green-400 font-mono text-xs p-3 overflow-hidden select-text">
      {/* Top terminal badge */}
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-green-900/60 text-[11px] text-green-600 select-none">
        <div className="flex items-center gap-1.5">
          <TerminalIcon size={13} className="text-green-500" />
          <span>TERMINAL.EXE (BROWSER COMMAND CONSOLE)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="bg-green-950 text-green-300 px-2 py-0.5 rounded text-[10px] border border-green-800">
            BROWSER SANDBOX
          </span>
          <span className="text-green-700">80x25 ANSI</span>
        </div>
      </div>

      {/* Terminal scroll buffer */}
      <div className="flex-1 overflow-y-auto space-y-1 pr-1 font-mono">
        {history.map((line, idx) => (
          <div
            key={idx}
            className={`whitespace-pre-wrap leading-relaxed ${
              line.type === 'input'
                ? 'text-white font-bold'
                : line.type === 'error'
                ? 'text-red-400'
                : line.type === 'success'
                ? 'text-emerald-400'
                : line.type === 'system'
                ? 'text-cyan-400'
                : line.type === 'matrix'
                ? 'text-emerald-300 font-bold animate-pulse'
                : 'text-green-400'
            }`}
          >
            {line.text}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input Prompt */}
      <div className="flex items-center gap-2 pt-2 border-t border-green-900/60 mt-1">
        <span className="text-green-500 font-bold shrink-0">$</span>
        <input
          type="text"
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="type 'slop help' or 'help'..."
          className="flex-1 bg-transparent text-green-300 font-mono outline-none text-xs caret-green-400"
          autoFocus
          spellCheck={false}
          autoComplete="off"
        />
      </div>
    </div>
  );
};
