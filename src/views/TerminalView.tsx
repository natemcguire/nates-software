import React, { useState, useRef, useEffect } from 'react';
import { Terminal as TerminalIcon, Sparkles } from 'lucide-react';
import { playClickSound, playSuccessChime, playErrorBeep } from '../lib/soundEngine';

interface TerminalLine {
  text: string;
  type?: 'input' | 'output' | 'error' | 'success' | 'system';
}

export const TerminalView: React.FC = () => {
  const [history, setHistory] = useState<TerminalLine[]>([
    { text: "Nate's Software Suite DOS/UNIX Shell v2.4.0 (x86_64-apple-darwin)", type: 'system' },
    { text: "Type 'help' for a list of available commands. SQLite WAL mode active.", type: 'system' },
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

  const executeCommand = (cmd: string) => {
    if (!cmd) return;

    playClickSound();
    setCommandHistory(prev => [...prev, cmd]);
    setHistoryIdx(-1);

    const newLines: TerminalLine[] = [{ text: `$ ${cmd}`, type: 'input' }];
    const parts = cmd.split(' ');
    const root = parts[0]?.toLowerCase();

    switch (root) {
      case 'help':
        newLines.push(
          { text: "Available Commands:", type: 'system' },
          { text: "  status                 - Display active micro-containers and memory load", type: 'output' },
          { text: "  ls [/data]             - List files in current sovereign volume", type: 'output' },
          { text: "  sqlite3 <path> <query> - Execute arbitrary SQL query against single-file SQLite", type: 'output' },
          { text: "  hotwire [list|drop]    - Query daily 12:01 AM batch drop listings", type: 'output' },
          { text: "  dyno [--bench]         - Run workstation AI throughput benchmark", type: 'output' },
          { text: "  whoami                 - Print current authenticated maker identity", type: 'output' },
          { text: "  clear                  - Clear terminal screen buffer", type: 'output' },
          { text: "  motd                   - Display Nate's Software manifesto", type: 'output' }
        );
        break;

      case 'clear':
        setHistory([]);
        setInputVal('');
        return;

      case 'status':
        newLines.push(
          { text: "[RIG.EXE] Active Containers: 3 micro-dynos running on port 3001..3003", type: 'success' },
          { text: "  ● nate/wallart    (Port 3002) - 48MB / 256MB [WAL Active]", type: 'output' },
          { text: "  ● sam/retro-calc  (Port 3001) - 24MB / 256MB [WAL Active]", type: 'output' },
          { text: "  ● nate/sailtrack  (Port 3003) - 38MB / 256MB [WAL Active]", type: 'output' },
          { text: "Zero port or database lock collisions detected.", type: 'success' }
        );
        break;

      case 'ls':
        const targetPath = parts[1] || '.';
        if (targetPath.includes('/data')) {
          newLines.push(
            { text: "total 3", type: 'output' },
            { text: "-rw-r--r--  1 nate  staff  15518920 Aug 25 18:45 wallart.sqlite", type: 'output' },
            { text: "-rw-r--r--  1 sam   staff   1468006 Aug 25 18:40 app.sqlite", type: 'output' },
            { text: "-rw-r--r--  1 nate  staff   4404019 Aug 25 18:30 telemetry.sqlite", type: 'output' }
          );
        } else {
          newLines.push(
            { text: "bin/   data/   dist/   functions/   migrations/   src/   package.json   wrangler.toml", type: 'output' }
          );
        }
        break;

      case 'whoami':
        newLines.push(
          { text: "User: @nate (Nate McGuire)", type: 'success' },
          { text: "Identity: Verified Maker #001 · Founder at East Bay Projects", type: 'output' },
          { text: "SSH Key: ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGxY8... (Authenticated)", type: 'output' }
        );
        break;

      case 'sqlite3':
        const query = cmd.substring(cmd.indexOf('"') + 1, cmd.lastIndexOf('"')) || 'SELECT 1;';
        newLines.push(
          { text: `SQLite 3.45.0 (WASM Engine) Executing: ${query}`, type: 'system' },
          { text: `+-----------------------+---------------------+-------------------+`, type: 'output' },
          { text: `| id                    | preset              | status            |`, type: 'output' },
          { text: `+-----------------------+---------------------+-------------------+`, type: 'output' },
          { text: `| job-981               | 24x36 Walnut Hero   | COMPLETED (300DPI)|`, type: 'output' },
          { text: `| job-982               | 3-Piece Triptych    | COMPLETED (300DPI)|`, type: 'output' },
          { text: `+-----------------------+---------------------+-------------------+`, type: 'output' },
          { text: `2 rows in set (0.003 sec)`, type: 'success' }
        );
        playSuccessChime();
        break;

      case 'dyno':
        newLines.push(
          { text: "[DYNO] Running local Metal Performance Shaders benchmark...", type: 'system' },
          { text: "  CPU: Apple M4 Max (16-Core)", type: 'output' },
          { text: "  Memory: 64 GB Unified (Bandwidth: 410 GB/s)", type: 'output' },
          { text: "  Throughput: 167.4 tok/s (TTFT: 42ms)", type: 'success' },
          { text: "  Cache Hit Rate: 94.8% · Needle Recall: 99.2%", type: 'success' },
          { text: "  Grade: Grade A+ (M4 Max Velocity)", type: 'success' }
        );
        playSuccessChime();
        break;

      case 'hotwire':
        newLines.push(
          { text: "HOTWIRE 12:01 AM Daily Drops Board (Batch #84):", type: 'system' },
          { text: "  1. WallArt Canvas Pro (v2.4.0) by @nate - 384 upvotes · 112 forks", type: 'output' },
          { text: "  2. RetroCalc Pro (v1.2.0) by @sam - 248 upvotes · 84 forks", type: 'output' },
          { text: "  3. SailTrack GPS (v2.1.0) by @nate - 192 upvotes · 46 forks", type: 'output' }
        );
        break;

      case 'motd':
        newLines.push(
          { text: "=== NATE'S SOFTWARE SUITE MANIFESTO ===", type: 'system' },
          { text: "1. No SaaS rental traps. Users hold title to the software they buy.", type: 'output' },
          { text: "2. Single-file SQLite databases. Never trap data in proprietary clouds.", type: 'output' },
          { text: "3. Sovereign moddability. If you own it, you have the right to fork and weld features with AI.", type: 'output' },
          { text: "4. Lineage royalties. Ancestors get paid 20% on every downstream fork sale.", type: 'output' }
        );
        break;

      default:
        newLines.push({ text: `command not found: ${root}. Type 'help' for available commands.`, type: 'error' });
        playErrorBeep();
        break;
    }

    setHistory(prev => [...prev, ...newLines]);
    setInputVal('');
  };

  return (
    <div className="flex flex-col h-full bg-black text-green-400 font-mono text-xs p-3 overflow-hidden select-text">
      {/* Top Terminal Info Bar */}
      <div className="border-b border-gray-800 pb-2 mb-2 flex items-center justify-between text-gray-500 text-[11px]">
        <span className="flex items-center gap-1.5 text-yellow-400">
          <TerminalIcon size={13} /> TERMINAL.EXE — INTERACTIVE SHELL
        </span>
        <span className="flex items-center gap-1 text-green-500 font-mono">
          <Sparkles size={11} /> 1000 BAUD · VT100
        </span>
      </div>

      {/* Output Stream */}
      <div className="flex-1 overflow-y-auto space-y-1 pr-1">
        {history.map((line, idx) => (
          <div
            key={idx}
            className={`leading-relaxed whitespace-pre-wrap ${
              line.type === 'input'
                ? 'text-white font-bold'
                : line.type === 'error'
                ? 'text-red-400 font-bold'
                : line.type === 'success'
                ? 'text-green-300 font-bold'
                : line.type === 'system'
                ? 'text-cyan-300 font-bold'
                : 'text-gray-300'
            }`}
          >
            {line.text}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input Prompt Line */}
      <div className="pt-2 border-t border-gray-800 flex items-center gap-2">
        <span className="text-green-400 font-bold">$</span>
        <input
          type="text"
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
          className="flex-1 bg-transparent text-green-300 font-mono text-xs focus:outline-none"
          placeholder="Type command ('help', 'status', 'dyno', 'motd')..."
        />
      </div>
    </div>
  );
};
