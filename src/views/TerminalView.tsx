import React, { useState, useRef, useEffect } from 'react';
import { Terminal as TerminalIcon, ShieldCheck, ShieldAlert, Cpu, RefreshCw, Radio } from 'lucide-react';
import { playClickSound, playSuccessChime, playErrorBeep } from '../lib/soundEngine';
import { runSlopCli } from '../../bin/slop.ts';
import { useAuth } from '../context/AuthContext';
import { useTerminalGateway } from '../hooks/useTerminalGateway';
import '@xterm/xterm/css/xterm.css';

interface TerminalLine {
  text: string;
  type?: 'input' | 'output' | 'error' | 'success' | 'system' | 'matrix';
}

export const TerminalView: React.FC = () => {
  const { user, openAuthModal } = useAuth();
  const gateway = useTerminalGateway();

  const [activeMode, setActiveMode] = useState<'gateway' | 'local'>('gateway');

  const [history, setHistory] = useState<TerminalLine[]>([
    { text: "Nate's Software Command Guide & Emulator v2.5.0", type: 'system' },
    { text: "Local mode is a browser command emulator with canned responses. It has no filesystem or process execution.", type: 'system' },
    { text: "Switch to 'Real PTY Gateway' mode or type 'gateway' to connect to a real ephemeral Linux container.", type: 'system' },
    { text: "", type: 'output' }
  ]);
  const [localInputVal, setLocalInputVal] = useState('');
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState<number>(-1);

  const bottomRef = useRef<HTMLDivElement>(null);
  const xtermHostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  useEffect(() => {
    if (!gateway.isConnected || !xtermHostRef.current) return;
    let disposed = false;
    let terminal: import('@xterm/xterm').Terminal | undefined;
    let observer: ResizeObserver | undefined;
    let unsubscribe: (() => void) | undefined;
    let inputDisposable: { dispose(): void } | undefined;
    let resizeDisposable: { dispose(): void } | undefined;
    void Promise.all([
      import('@xterm/xterm'),
      import('@xterm/addon-fit')
    ]).then(([xtermModule, fitModule]) => {
      if (disposed || !xtermHostRef.current) return;
      terminal = new xtermModule.Terminal({
        cursorBlink: true,
        convertEol: false,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        fontSize: 12,
        theme: { background: '#000000', foreground: '#4ade80', cursor: '#22c55e', selectionBackground: '#14532d' },
        scrollback: 5000
      });
      const fit = new fitModule.FitAddon();
      terminal.loadAddon(fit);
      terminal.open(xtermHostRef.current);
      fit.fit();
      if (gateway.outputStream) terminal.write(gateway.outputStream);
      inputDisposable = terminal.onData(data => gateway.sendInput(data));
      resizeDisposable = terminal.onResize(({ cols, rows }) => gateway.sendResize(cols, rows));
      unsubscribe = gateway.subscribeOutput(chunk => terminal?.write(chunk));
      observer = new ResizeObserver(() => { try { fit.fit(); } catch {} });
      observer.observe(xtermHostRef.current);
      terminal.focus();
    });
    return () => {
      disposed = true;
      observer?.disconnect();
      unsubscribe?.();
      inputDisposable?.dispose();
      resizeDisposable?.dispose();
      terminal?.dispose();
    };
  }, [gateway.isConnected, gateway.sessionInfo?.sessionId]);

  const handleLocalKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      executeLocalCommand(localInputVal.trim());
    } else if (e.key === 'ArrowUp') {
      if (commandHistory.length > 0) {
        const nextIdx = historyIdx + 1 < commandHistory.length ? historyIdx + 1 : historyIdx;
        setHistoryIdx(nextIdx);
        setLocalInputVal(commandHistory[commandHistory.length - 1 - nextIdx] || '');
      }
    } else if (e.key === 'ArrowDown') {
      if (historyIdx > 0) {
        const nextIdx = historyIdx - 1;
        setHistoryIdx(nextIdx);
        setLocalInputVal(commandHistory[commandHistory.length - 1 - nextIdx] || '');
      } else if (historyIdx === 0) {
        setHistoryIdx(-1);
        setLocalInputVal('');
      }
    }
  };

  const executeLocalCommand = async (cmd: string) => {
    if (!cmd) return;

    playClickSound();
    setCommandHistory(prev => [...prev, cmd]);
    setHistoryIdx(-1);

    const newLines: TerminalLine[] = [{ text: `$ ${cmd}`, type: 'input' }];
    const parts = cmd.split(' ');
    const root = parts[0]?.toLowerCase();

    if (root === 'slop') {
      const slopArgs = parts.slice(1);
      if (slopArgs[0]?.toLowerCase() === 'fork') {
        playErrorBeep();
        newLines.push(
          { text: 'A real fork needs a host filesystem, Git, Node/npm, and your local LLM credentials.', type: 'error' },
          { text: `Run this in your native terminal or Real PTY Gateway: slop fork ${slopArgs[1] || 'nate/dronehunter'}`, type: 'system' },
          { text: 'After installation completes, SLOP will ask: Start your engines?', type: 'output' }
        );
        setHistory(prev => [...prev, ...newLines]);
        setLocalInputVal('');
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
      setLocalInputVal('');
      return;
    }

    switch (root) {
      case 'help':
        newLines.push(
          { text: "Nate's Software Command Guide & Emulator Help Index:", type: 'system' },
          { text: "  [NOTICE] Local mode prints canned emulator responses; only gateway mode executes for real.", type: 'system' },
          { text: "  gateway                - Connect to real ephemeral Linux PTY gateway", type: 'output' },
          { text: "  slop <command>         - Preview browser-safe SLOP commands", type: 'output' },
          { text: "    slop fork <slug>     - Fork an app into an isolated worktree", type: 'output' },
          { text: "    slop mod <feature>   - Splice AST feature package into project", type: 'output' },
          { text: "    slop dyno [--bench]  - Benchmark model + harness + tools on dev tasks", type: 'output' },
          { text: "    slop test            - Run Local-First runtime verification test proofs", type: 'output' },
          { text: "    slop status          - Inspect micro-containers & active ports (3001..3010)", type: 'output' },
          { text: "    slop list            - Query 12:01 AM daily drops on Cloudflare D1", type: 'output' },
          { text: "    slop shelf           - Display owned software titles & license keys", type: 'output' },
          { text: "  whoami                 - Print authenticated user handle & permissions", type: 'output' },
          { text: "  ls [/data]             - List files in current volume (emulator canned message)", type: 'output' },
          { text: "  neofetch               - Display system hardware & OS telemetry", type: 'output' },
          { text: "  matrix                 - Render falling code matrix stream", type: 'output' },
          { text: "  clear                  - Clear emulator buffer", type: 'output' },
          { text: "  date                   - Output current ISO timestamp", type: 'output' }
        );
        break;

      case 'gateway':
      case 'connect':
        setActiveMode('gateway');
        gateway.connect();
        return;

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
          { text: `The command emulator cannot run '${root}'.`, type: 'error' },
          { text: "Connect to the real PTY gateway when available, or run in your native terminal.", type: 'system' },
          { text: "SLOP asks which engine to start only after an app finishes installing; it never auto-launches AGY.", type: 'output' }
        );
        break;

      case 'clear':
        setHistory([]);
        setLocalInputVal('');
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
        newLines.push(
          { text: 'The command emulator has no filesystem to list.', type: 'error' },
          { text: "Use 'gateway' for a real disposable filesystem, or run ls in your native terminal.", type: 'system' }
        );
        break;

      case 'date':
        newLines.push({ text: new Date().toISOString(), type: 'output' });
        break;

      case 'neofetch':
        newLines.push(
          { text: "       .---.       browser@terminal.exe", type: 'system' },
          { text: "      /     \\      --------------------", type: 'system' },
          { text: "     | () () |     Mode: Command guide / emulator (canned responses)", type: 'output' },
          { text: "      \\  -  /      Process execution: None (browser emulation only)", type: 'output' },
          { text: "       `---'       Filesystem: None", type: 'output' },
          { text: "                   Real PTY Gateway: Disconnected", type: 'output' }
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
          text: `Command not found: '${cmd}'. Type 'help' or 'slop help' for command guide.`,
          type: 'error'
        });
        break;
    }

    setHistory(prev => [...prev, ...newLines]);
    setLocalInputVal('');
  };

  const isolationBadge = () => {
    if (activeMode === 'local') {
      return (
        <span className="bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded text-[10px] border border-zinc-700 font-mono">
          LOCAL EMULATOR (CANNED RESPONSES)
        </span>
      );
    }

    if (!gateway.isConnected || !gateway.sessionInfo) {
      if (gateway.gatewayReadiness && !gateway.gatewayReadiness.ready) {
        return (
          <span className="bg-red-950 text-red-300 px-2 py-0.5 rounded text-[10px] border border-red-800 font-mono flex items-center gap-1 font-bold">
            <ShieldAlert size={11} /> REAL TERMINAL OFFLINE
          </span>
        );
      }
      return (
        <span className="bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded text-[10px] border border-zinc-700 font-mono">
          OFFLINE (GATEWAY DISCONNECTED)
        </span>
      );
    }

    const { isolationType, isProductionVps } = gateway.sessionInfo;
    if (isolationType === 'vps' && isProductionVps) {
      return (
        <span className="bg-amber-950 text-amber-300 px-2 py-0.5 rounded text-[10px] border border-amber-700 font-bold flex items-center gap-1">
          <ShieldCheck size={11} /> PRODUCTION VPS ISOLATION
        </span>
      );
    }

    if (isolationType === 'container') {
      return (
        <span className="bg-cyan-950 text-cyan-300 px-2 py-0.5 rounded text-[10px] border border-cyan-800 flex items-center gap-1">
          <Cpu size={11} /> CONTAINER ISOLATION
        </span>
      );
    }

    return (
      <span className="bg-emerald-950 text-emerald-300 px-2 py-0.5 rounded text-[10px] border border-emerald-800 flex items-center gap-1">
        <Radio size={11} className="animate-pulse text-emerald-400" /> DEV PROCESS ISOLATION (EPHEMERAL PTY)
      </span>
    );
  };

  const renderGatewayStatusBanner = () => {
    if (activeMode !== 'gateway' || gateway.isConnected) return null;

    const isOffline = gateway.gatewayReadiness && !gateway.gatewayReadiness.ready;
    const isReady = gateway.gatewayReadiness && gateway.gatewayReadiness.ready;

    if (isOffline) {
      return (
        <div className="bg-red-950/40 border border-red-800/80 text-red-300 p-2 mb-2 rounded text-[11px] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldAlert size={14} className="text-red-400 shrink-0" />
            <div>
              <span className="font-bold text-red-200">Real Terminal Offline</span> — {gateway.gatewayReadiness?.error || gateway.lastError || 'Ephemeral terminal service is unavailable.'}
              <span className="block text-[10px] text-red-400 mt-0.5">
                Local mode provides a command guide/emulator with canned responses. Real process execution requires an active gateway.
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => gateway.probeReadiness()}
              disabled={gateway.isProbing}
              className="flex items-center gap-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-700 px-2 py-1 rounded text-[10px] font-mono"
            >
              <RefreshCw size={10} className={gateway.isProbing ? 'animate-spin' : ''} />
              {gateway.isProbing ? 'Checking...' : 'Re-check Service'}
            </button>
            <button
              onClick={() => {
                playClickSound();
                setActiveMode('local');
              }}
              className="bg-green-950 hover:bg-green-900 text-green-300 border border-green-800 px-2 py-1 rounded text-[10px] font-mono font-bold"
            >
              Use Emulator
            </button>
          </div>
        </div>
      );
    }

    if (isReady) {
      return (
        <div className="bg-emerald-950/40 border border-emerald-800/80 text-emerald-300 p-2 mb-2 rounded text-[11px] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Radio size={14} className="text-emerald-400 shrink-0 animate-pulse" />
            <div>
              <span className="font-bold text-emerald-200">Real Terminal Gateway Online</span> — Ephemeral Linux container session ready to launch.
            </div>
          </div>
          <button
            onClick={() => user ? gateway.connect() : openAuthModal('login')}
            disabled={gateway.isConnecting}
            className="flex items-center gap-1 bg-emerald-900 hover:bg-emerald-800 text-emerald-100 border border-emerald-600 px-2.5 py-1 rounded text-[10px] shrink-0 font-bold font-mono"
          >
            <RefreshCw size={10} className={gateway.isConnecting ? 'animate-spin' : ''} />
            {gateway.isConnecting ? 'Starting Session...' : user ? 'Start Real Session' : 'Log In to Start'}
          </button>
        </div>
      );
    }

    return (
      <div className="bg-zinc-900/90 border border-zinc-700 text-zinc-300 p-2 mb-2 rounded text-[11px] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <RefreshCw size={14} className={`text-zinc-400 shrink-0 ${gateway.isProbing || gateway.isConnecting ? 'animate-spin' : ''}`} />
          <div>
            <span className="font-bold text-zinc-200">Ephemeral Terminal</span> — {gateway.isProbing ? 'Checking gateway service availability...' : user ? 'Probing real terminal gateway readiness...' : 'Log in to connect to real terminal gateway.'}
            {gateway.lastError && <span className="block text-red-300 mt-0.5">{gateway.lastError}</span>}
          </div>
        </div>
        <button
          onClick={() => user ? (gateway.gatewayReadiness ? gateway.connect() : gateway.probeReadiness()) : openAuthModal('login')}
          disabled={gateway.isConnecting || gateway.isProbing}
          className="flex items-center gap-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-600 px-2 py-1 rounded text-[10px] shrink-0 font-bold font-mono"
        >
          <RefreshCw size={10} className={gateway.isConnecting || gateway.isProbing ? 'animate-spin' : ''} />
          {gateway.isConnecting ? 'Connecting...' : gateway.isProbing ? 'Checking...' : user ? 'Check & Connect' : 'Log In'}
        </button>
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col bg-black text-green-400 font-mono text-xs p-3 overflow-hidden select-text">
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-green-900/60 text-[11px] text-green-600 select-none">
        <div className="flex items-center gap-1.5">
          <TerminalIcon size={13} className="text-green-500" />
          <span className="font-bold tracking-wide">
            TERMINAL.EXE {activeMode === 'gateway' ? (gateway.isConnected ? '(REAL EPHEMERAL PTY)' : '(REAL PTY GATEWAY)') : '(COMMAND GUIDE / EMULATOR)'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {isolationBadge()}

          <button
            onClick={() => {
              playClickSound();
              if (activeMode === 'local') {
                setActiveMode('gateway');
              } else {
                setActiveMode('local');
              }
            }}
            className="px-2 py-0.5 rounded text-[10px] border border-green-800 bg-green-950/60 hover:bg-green-900 text-green-300 transition-colors"
          >
            {activeMode === 'gateway' ? 'Switch to Command Guide / Emulator' : 'Switch to Real PTY Gateway'}
          </button>
        </div>
      </div>

      {renderGatewayStatusBanner()}

      {activeMode === 'gateway' && gateway.isConnected && gateway.sessionInfo && (
        <div className="bg-green-950/40 border border-green-900/80 text-green-300 p-1.5 mb-2 rounded text-[10px] flex flex-wrap items-center justify-between">
          <div>
            <span className="text-green-500 font-bold">WORKSPACE:</span> {gateway.sessionInfo.workspacePath}
          </div>
          <div className="text-green-600">
            TTL: {gateway.sessionInfo.ttlSeconds}s · Auto-clean on disconnect
          </div>
          {gateway.capabilities?.availableTools?.length ? (
            <div className="basis-full mt-1 text-green-500 break-words">
              <span className="font-bold">INSTALLED:</span> {gateway.capabilities.availableTools.join(' · ')}
            </div>
          ) : null}
        </div>
      )}

      {activeMode === 'gateway' && gateway.isConnected ? (
        <div ref={xtermHostRef} className="flex-1 min-h-0 overflow-hidden bg-black" aria-label="Interactive ephemeral Linux terminal" />
      ) : (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
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

          <div className="flex items-center gap-2 pt-2 border-t border-green-900/60 mt-1">
            <span className="text-green-500 font-bold shrink-0">$</span>
            <input
              type="text"
              value={localInputVal}
              onChange={(e) => setLocalInputVal(e.target.value)}
              onKeyDown={handleLocalKeyDown}
              placeholder="type 'help' for emulator guide or 'gateway' to connect..."
              className="flex-1 bg-transparent text-green-300 font-mono outline-none text-xs caret-green-400"
              autoFocus
              spellCheck={false}
              autoComplete="off"
            />
          </div>
        </div>
      )}
    </div>
  );
};
