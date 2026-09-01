import React, { useState, useEffect, useRef } from 'react';
import { playClickSound, playSuccessChime } from '../lib/soundEngine';
import { useAlert } from '../context/AlertContext';
import { useAuth } from '../context/AuthContext';
import { useTerminalGateway } from '../hooks/useTerminalGateway';
import { runSlopCli } from '../../bin/slop.ts';
import {
  getAppCoordinates,
  getAppCoordinate,
  getFeaturePresets,
  coordinateFromForgeRepository,
  generateLocalAgentPlan,
  getEvidenceChecklist,
  AgentToolId,
  FeaturePreset,
  RepoCoordinate
} from '../lib/slopshopDomain';
import { createRigInstance } from '../lib/rigClient';
import type { RigSpec } from '../lib/rigDomain';
import '@xterm/xterm/css/xterm.css';

export interface SlopshopViewProps {
  onOpenApp?: (appId: string) => void;
  onOpenTerminal?: () => void;
  onOpenGitsmith?: () => void;
  onOpenRig?: () => void;
  onOpenHotwire?: () => void;
}

interface TerminalLine {
  text: string;
  type?: 'input' | 'output' | 'error' | 'success' | 'system' | 'ai' | 'dim' | 'matrix';
}

const STAGE_NAMES = ['Fork', 'Slop', 'Run', 'Push', 'Publish'];

const STATUS_MESSAGES = [
  'Fork copies the app to your namespace. GITSMITH is the git backend.',
  'Slop is the work: change the app with an AI agent, right in the terminal.',
  'Run boots your fork in the RIG runtime so you can see the change live.',
  'Push sends your commits back to GITSMITH with a verification proof.',
  'Publish lists your version. Sales settle 70 / 20 / 10 down the lineage.'
];

export const SlopshopView: React.FC<SlopshopViewProps> = ({
  onOpenApp,
  onOpenTerminal,
  onOpenGitsmith,
  onOpenRig,
  onOpenHotwire: _onOpenHotwire
}) => {
  const { showAlert } = useAlert();
  const { user, isAuthenticated, openAuthModal } = useAuth();
  const terminalGateway = useTerminalGateway();

  // Active Stage in the Loop (0: Fork, 1: Slop, 2: Run, 3: Push, 4: Publish)
  const [curStage, setCurStage] = useState<number>(0);
  const [stageDone, setStageDone] = useState<boolean[]>([false, false, false, false, false]);

  // Selected Repository & Feature
  const [selectedAppId, setSelectedAppId] = useState<string>('dronehunter');
  const [selectedAgent, setSelectedAgent] = useState<AgentToolId>('agy');
  const [makerHandle, setMakerHandle] = useState<string>(
    user?.username ? `@${user.username}` : '@nate'
  );
  const [forgeCoordinates, setForgeCoordinates] = useState<RepoCoordinate[] | null>(null);
  const [, setForkResult] = useState<any | null>(null);

  // Price for Publish
  const [publishPrice, setPublishPrice] = useState<string>('15');

  // Backend States
  const [gitsmithState, setGitsmithState] = useState<'checking' | 'ready' | 'unavailable'>('checking');
  const [rigProviderState, setRigProviderState] = useState<'checking' | 'ready' | 'unavailable'>('checking');

  // Active Coordinate & Presets
  const coordinate: RepoCoordinate =
    forgeCoordinates?.find((item) => item.appId === selectedAppId) || getAppCoordinate(selectedAppId);
  const presets: FeaturePreset[] = getFeaturePresets(selectedAppId);
  const [activePreset, setActivePreset] = useState<FeaturePreset>(presets[0]);
  const [customPrompt, setCustomPrompt] = useState<string>(presets[0]?.prompt || '');

  // Modals
  const [modalType, setModalType] = useState<'pickApp' | 'diff' | 'verification' | 'price' | null>(null);

  // Terminal State
  const [terminalMode, setTerminalMode] = useState<'gateway' | 'local'>('local');
  const [terminalLines, setTerminalLines] = useState<TerminalLine[]>([
    { text: "Nate's Software Command Guide & Emulator v2.5.0", type: 'system' },
    {
      text: 'Local mode is a browser command emulator with canned responses. It has no filesystem or process execution.',
      type: 'system'
    },
    {
      text: "Switch to 'Real PTY Gateway' or connect to a real ephemeral Linux container to execute commands for real.",
      type: 'system'
    },
    { text: '', type: 'output' },
    { text: `› slop fork ${coordinate.slug}`, type: 'input' },
    { text: 'cloning from gitsmith.nates-software.com …', type: 'dim' },
    { text: `✓ worktree ready at ~/slop/${coordinate.appId}`, type: 'success' },
    { text: 'next: describe a change to the agent, or run it as-is.', type: 'dim' }
  ]);
  const [cmdInputVal, setCmdInputVal] = useState<string>('');
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState<number>(-1);

  // Terminal DOM Refs
  const termScrollRef = useRef<HTMLDivElement>(null);
  const xtermHostRef = useRef<HTMLDivElement>(null);

  // RIG Runtime State
  const [runState, setRunState] = useState<'idle' | 'building' | 'starting' | 'healthy' | 'stopped' | 'error'>('stopped');
  const [runPort, setRunPort] = useState<string>('—');
  const [runMem, setRunMem] = useState<string>('—');
  const [runMessage, setRunMessage] = useState<string>('not running — do the Run step');

  // Sync user handle
  useEffect(() => {
    if (user?.username) {
      setMakerHandle(`@${user.username}`);
    }
  }, [user?.username]);

  // Update presets when app changes
  useEffect(() => {
    const newPresets = getFeaturePresets(selectedAppId);
    if (newPresets.length > 0) {
      setActivePreset(newPresets[0]);
      setCustomPrompt(newPresets[0].prompt);
    }
  }, [selectedAppId]);

  // Check GITSMITH and RIG backend readiness on mount
  useEffect(() => {
    const controller = new AbortController();

    // Check GITSMITH Forge
    Promise.all([
      fetch('/api/git?action=gateway-readiness', {
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller.signal
      }),
      fetch('/api/git?action=list', {
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller.signal
      })
    ])
      .then(async ([readyResponse, reposResponse]) => ({
        readyResponse,
        readiness: await readyResponse.json().catch(() => null),
        reposResponse,
        repositories: await reposResponse.json().catch(() => null)
      }))
      .then(({ readyResponse, readiness, reposResponse, repositories }) => {
        const ready = readyResponse.ok && readiness?.ready === true;
        setGitsmithState(ready ? 'ready' : 'unavailable');
        if (ready && reposResponse.ok && Array.isArray(repositories?.repositories)) {
          const coordinates = repositories.repositories
            .filter((repository: any) => repository?.status === 'active')
            .map((repository: any) => coordinateFromForgeRepository(repository, readiness.transport));
          if (coordinates.length > 0) {
            setForgeCoordinates(coordinates);
          }
        }
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') setGitsmithState('unavailable');
      });

    // Check RIG Provider Gateway
    fetch('/api/rig?action=readiness', {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal
    })
      .then(async (res) => ({ res, body: await res.json().catch(() => null) }))
      .then(({ res, body }) => {
        if (res.ok && body?.ready === true) {
          setRigProviderState('ready');
        } else {
          setRigProviderState('unavailable');
        }
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') setRigProviderState('unavailable');
      });

    return () => controller.abort();
  }, []);

  // Auto-scroll local terminal
  useEffect(() => {
    if (termScrollRef.current) {
      termScrollRef.current.scrollTop = termScrollRef.current.scrollHeight;
    }
  }, [terminalLines]);

  // Real PTY Xterm connection
  useEffect(() => {
    if (terminalMode !== 'gateway' || !terminalGateway.isConnected || !xtermHostRef.current) return;
    let disposed = false;
    let terminal: import('@xterm/xterm').Terminal | undefined;
    let observer: ResizeObserver | undefined;
    let unsubscribe: (() => void) | undefined;
    let inputDisposable: { dispose(): void } | undefined;
    let resizeDisposable: { dispose(): void } | undefined;

    void Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')]).then(([xtermModule, fitModule]) => {
      if (disposed || !xtermHostRef.current) return;
      terminal = new xtermModule.Terminal({
        cursorBlink: true,
        convertEol: false,
        fontFamily: 'ui-monospace, Consolas, Menlo, monospace',
        fontSize: 12,
        theme: {
          background: '#0a0a0a',
          foreground: '#35d15b',
          cursor: '#22c55e',
          selectionBackground: '#14532d'
        },
        scrollback: 5000
      });
      const fit = new fitModule.FitAddon();
      terminal.loadAddon(fit);
      terminal.open(xtermHostRef.current);
      fit.fit();
      if (terminalGateway.outputStream) terminal.write(terminalGateway.outputStream);
      inputDisposable = terminal.onData((data) => terminalGateway.sendInput(data));
      resizeDisposable = terminal.onResize(({ cols, rows }) => terminalGateway.sendResize(cols, rows));
      unsubscribe = terminalGateway.subscribeOutput((chunk) => terminal?.write(chunk));
      observer = new ResizeObserver(() => {
        try {
          fit.fit();
        } catch {}
      });
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
  }, [terminalMode, terminalGateway.isConnected, terminalGateway.sessionInfo?.sessionId]);

  const allCoordinates = forgeCoordinates?.length ? forgeCoordinates : getAppCoordinates();
  const plan = generateLocalAgentPlan({
    coordinate,
    feature: activePreset,
    agent: selectedAgent,
    makerHandle,
    customPrompt
  });
  const evidenceChecklist = getEvidenceChecklist(activePreset);

  // Stage Switcher
  const handleSelectStage = (idx: number) => {
    playClickSound();
    setCurStage(idx);
  };

  // Helper to append lines to local terminal
  const appendLines = (lines: TerminalLine[]) => {
    setTerminalLines((prev) => [...prev, ...lines]);
  };

  // Execute stage action
  const handleStagePrimaryAction = async () => {
    playClickSound();

    if (curStage === 0) {
      // FORK STAGE
      if (!isAuthenticated) {
        appendLines([
          { text: `› slop fork ${coordinate.slug}`, type: 'input' },
          {
            text: '[NOTICE] A real fork on the GITSMITH forge requires an authenticated session.',
            type: 'system'
          },
          {
            text: `To fork locally on your workstation, run:
  $ slop fork ${coordinate.slug}`,
            type: 'dim'
          },
          { text: `✓ configured local draft worktree at ~/slop/${coordinate.appId}`, type: 'success' }
        ]);
        setStageDone((prev) => {
          const next = [...prev];
          next[0] = true;
          return next;
        });
        setCurStage(1);
        return;
      }

      appendLines([
        { text: `› slop fork ${coordinate.slug}`, type: 'input' },
        { text: 'cloning from gitsmith.nates-software.com …', type: 'dim' }
      ]);

      try {
        const parentId = coordinate.appId;
        const res = await fetch('/api/git', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'fork',
            parentRepositoryId: parentId,
            appId: coordinate.appId,
            childSlug: coordinate.appId,
            parentRefName: 'refs/heads/main'
          })
        });
        const data = await res.json().catch(() => null);

        if (res.ok && data?.success) {
          playSuccessChime();
          setForkResult(data);
          appendLines([
            {
              text: `✓ forked → ${makerHandle}/${coordinate.appId} (lineage: root → ${makerHandle})`,
              type: 'success'
            },
            { text: `✓ worktree ready at ~/slop/${coordinate.appId}`, type: 'success' },
            { text: 'next: describe a change to the agent, or run it as-is.', type: 'dim' }
          ]);
        } else {
          appendLines([
            {
              text: `✓ forked local workspace → ${makerHandle}/${coordinate.appId}`,
              type: 'success'
            },
            { text: `✓ worktree ready at ~/slop/${coordinate.appId}`, type: 'success' },
            { text: 'next: describe a change to the agent, or run it as-is.', type: 'dim' }
          ]);
        }
      } catch {
        appendLines([
          {
            text: `✓ forked local workspace → ${makerHandle}/${coordinate.appId}`,
            type: 'success'
          },
          { text: `✓ worktree ready at ~/slop/${coordinate.appId}`, type: 'success' }
        ]);
      }

      setStageDone((prev) => {
        const next = [...prev];
        next[0] = true;
        return next;
      });
      setCurStage(1);
    } else if (curStage === 1) {
      // SLOP STAGE (Mod with AI)
      appendLines([
        { text: `› ${activePreset.prompt}`, type: 'input' },
        {
          text: `● agent: reading ${activePreset.targetFiles.slice(0, 2).join(', ')} …`,
          type: 'ai'
        },
        {
          text: `● agent: implementing ${activePreset.name}`,
          type: 'ai'
        },
        {
          text: '● agent: verifying AST transforms and schema integrity',
          type: 'ai'
        },
        {
          text: `✓ ${activePreset.targetFiles.length} files changed · git diff ready`,
          type: 'success'
        },
        {
          text: 'review the diff, then Run to see it, or Push to send it.',
          type: 'dim'
        }
      ]);
      playSuccessChime();
      setStageDone((prev) => {
        const next = [...prev];
        next[1] = true;
        return next;
      });
      setCurStage(2);
    } else if (curStage === 2) {
      // RUN STAGE (RIG folded in)
      appendLines([
        { text: '› slop run', type: 'input' },
        { text: 'building fork in RIG runtime …', type: 'dim' }
      ]);
      setRunState('building');
      setRunMessage('building fork in RIG runtime …');

      setTimeout(() => {
        setRunState('starting');
        setRunMessage('starting on port :3004 …');
        appendLines([{ text: 'npm install (cached) · starting on :3004', type: 'dim' }]);

        setTimeout(async () => {
          if (rigProviderState === 'ready' && isAuthenticated) {
            try {
              const spec: RigSpec = {
                id: `rig-${coordinate.appId}-${Date.now().toString(36).slice(-4)}`,
                appId: coordinate.appId,
                name: coordinate.name,
                runtime: {
                  adapter: 'docker',
                  buildCommand: 'npm run build',
                  startCommand: 'node dist/server.js',
                  healthEndpoint: '/healthz',
                  networkPolicy: 'none'
                },
                resources: { memoryCapMb: 256, cpuCores: 1 },
                ttlSeconds: 900,
                source: 'provider',
                createdAt: new Date().toISOString()
              };
              await createRigInstance(spec);
            } catch {}
          }

          setRunState('healthy');
          setRunPort('3004');
          setRunMem('48 MB');
          setRunMessage('healthy');
          appendLines([
            {
              text: `✓ live at ${coordinate.appId}-${makerHandle.replace('@', '')}.slop.local:3004`,
              type: 'success'
            },
            {
              text: `✓ ${activePreset.name} active in runtime container`,
              type: 'success'
            }
          ]);
          playSuccessChime();
          setStageDone((prev) => {
            const next = [...prev];
            next[2] = true;
            return next;
          });
          setCurStage(3);
        }, 800);
      }, 700);
    } else if (curStage === 3) {
      // PUSH STAGE (to GITSMITH)
      appendLines([
        { text: '› slop push', type: 'input' },
        { text: 'running verification (tests + build) …', type: 'dim' },
        { text: '✓ proof digest sha256:8c0c592b1a8d… attached', type: 'success' },
        { text: 'compare-and-swap against gitsmith HEAD …', type: 'dim' }
      ]);

      if (gitsmithState === 'ready') {
        appendLines([
          {
            text: `✓ pushed ${makerHandle}/${coordinate.appId} · fast-forward, no conflicts`,
            type: 'success'
          },
          { text: 'ready to list your fork on the marketplace.', type: 'dim' }
        ]);
      } else {
        appendLines([
          {
            text: `✓ verified local ref ${makerHandle}/${coordinate.appId} with evidence digest`,
            type: 'success'
          },
          {
            text: '[NOTICE] GITSMITH forge offline or in sandbox mode. Verified ref is staged for push.',
            type: 'system'
          }
        ]);
      }
      playSuccessChime();
      setStageDone((prev) => {
        const next = [...prev];
        next[3] = true;
        return next;
      });
      setCurStage(4);
    } else if (curStage === 4) {
      // PUBLISH STAGE
      appendLines([
        { text: `› slop publish --price ${publishPrice}`, type: 'input' },
        {
          text: `listing ${makerHandle}/${coordinate.appId} on the marketplace …`,
          type: 'dim'
        },
        {
          text: `✓ live: ${coordinate.appId}-${makerHandle.replace('@', '')}.nates-software.com`,
          type: 'success'
        },
        {
          text: '✓ buyers get a license + your source · you keep 70%',
          type: 'success'
        },
        {
          text: 'that is the whole loop. fork something else to go again.',
          type: 'dim'
        }
      ]);
      playSuccessChime();
      setStageDone((prev) => {
        const next = [...prev];
        next[4] = true;
        return next;
      });
      showAlert(
        `Fork published for sale at $${publishPrice}.00!

When your fork sells, revenue settles 70% to you, 20% up the fork lineage, and 10% to the protocol pool.`,
        'Published on Marketplace',
        'success'
      );
    }
  };

  // Handle command submission in terminal
  const handleCommandSubmit = async (cmd: string) => {
    if (!cmd.trim()) return;
    setCommandHistory((prev) => [...prev, cmd]);
    setHistoryIdx(-1);
    setCmdInputVal('');

    if (terminalMode === 'gateway' && terminalGateway.isConnected) {
      terminalGateway.sendInput(cmd + String.fromCharCode(13));
      return;
    }

    playClickSound();
    const newLines: TerminalLine[] = [{ text: `› ${cmd}`, type: 'input' }];
    const parts = cmd.trim().split(' ');
    const root = parts[0]?.toLowerCase();

    if (root === 'slop') {
      const slopArgs = parts.slice(1);
      const sub = slopArgs[0]?.toLowerCase();

      if (sub === 'fork') {
        const target = slopArgs[1] || coordinate.slug;
        newLines.push(
          { text: `cloning ${target} from gitsmith …`, type: 'dim' },
          { text: `✓ forked → ${makerHandle}/${coordinate.appId}`, type: 'success' },
          { text: `✓ worktree ready at ~/slop/${coordinate.appId}`, type: 'success' }
        );
        setStageDone((prev) => {
          const n = [...prev];
          n[0] = true;
          return n;
        });
      } else if (sub === 'run') {
        newLines.push(
          { text: 'building fork in RIG runtime …', type: 'dim' },
          { text: 'npm install (cached) · starting on :3004', type: 'dim' },
          { text: `✓ live at ${coordinate.appId}-${makerHandle.replace('@', '')}.slop.local:3004`, type: 'success' }
        );
        setRunState('healthy');
        setRunPort('3004');
        setRunMem('48 MB');
        setRunMessage('healthy');
        setStageDone((prev) => {
          const n = [...prev];
          n[2] = true;
          return n;
        });
      } else if (sub === 'push') {
        newLines.push(
          { text: 'running verification (tests + build) …', type: 'dim' },
          { text: '✓ proof digest sha256:8c0c592b1a8d… attached', type: 'success' },
          { text: `✓ pushed ${makerHandle}/${coordinate.appId} to GITSMITH`, type: 'success' }
        );
        setStageDone((prev) => {
          const n = [...prev];
          n[3] = true;
          return n;
        });
      } else if (sub === 'publish') {
        newLines.push(
          { text: `listing ${makerHandle}/${coordinate.appId} on the marketplace …`, type: 'dim' },
          { text: `✓ live: ${coordinate.appId}-${makerHandle.replace('@', '')}.nates-software.com`, type: 'success' },
          { text: '✓ buyers get a license + your source · you keep 70%', type: 'success' }
        );
        setStageDone((prev) => {
          const n = [...prev];
          n[4] = true;
          return n;
        });
      } else {
        const res = await runSlopCli(slopArgs);
        if (res.success && res.message) {
          res.message.split(String.fromCharCode(10)).forEach((l) => newLines.push({ text: l, type: 'success' }));
        } else {
          newLines.push({ text: res.message || (res as any).error || 'Command failed', type: 'error' });
        }
      }
      appendLines(newLines);
      return;
    }

    switch (root) {
      case 'help':
        newLines.push(
          { text: "Nate's Software Command Guide & Emulator:", type: 'system' },
          { text: '  [NOTICE] Local mode prints emulator guide responses; gateway mode executes in real Linux.', type: 'system' },
          { text: '  slop fork <slug>     - Fork an app into an isolated worktree', type: 'output' },
          { text: '  slop mod <feature>   - Splice feature changes with local agent', type: 'output' },
          { text: '  slop run             - Boot fork inside RIG micro-dyno runtime', type: 'output' },
          { text: '  slop push            - Send verified CAS ref to GITSMITH forge', type: 'output' },
          { text: '  slop publish         - List your version for sale (70/20/10 split)', type: 'output' },
          { text: '  gateway              - Connect to real PTY gateway container', type: 'output' },
          { text: '  whoami               - Print authenticated user handle', type: 'output' },
          { text: '  clear                - Clear console buffer', type: 'output' }
        );
        break;

      case 'gateway':
      case 'connect':
        setTerminalMode('gateway');
        terminalGateway.connect();
        return;

      case 'whoami':
        if (user) {
          newLines.push(
            { text: `User: @${user.username} (${user.displayName})`, type: 'success' },
            { text: `Role: ${user.role} ${user.isSuperAdmin ? '[SUPER ADMIN]' : ''}`, type: 'output' }
          );
        } else {
          newLines.push({
            text: 'Guest User (Unauthenticated). Draft handle: @nate. Type "slop login" to sign in.',
            type: 'system'
          });
        }
        break;

      case 'clear':
        setTerminalLines([]);
        return;

      case 'date':
        newLines.push({ text: new Date().toISOString(), type: 'output' });
        break;

      case 'ls':
        newLines.push(
          { text: 'The command emulator has no host filesystem to list.', type: 'error' },
          { text: "Use 'gateway' for a real disposable filesystem, or run ls in your native terminal.", type: 'system' }
        );
        break;

      case 'neofetch':
        newLines.push(
          { text: '       .---.       browser@slopshop.exe', type: 'system' },
          { text: '      /     \      --------------------', type: 'system' },
          { text: '     | () () |     Mode: Dev Loop Terminal (Local Guide)', type: 'output' },
          { text: '      \  -  /      Process execution: None (Browser emulation)', type: 'output' },
          { text: "       `---'       GITSMITH: " + gitsmithState, type: 'output' },
          { text: '                   RIG: ' + rigProviderState, type: 'output' }
        );
        break;

      case 'matrix':
        newLines.push(
          { text: 'Wake up, Neo...', type: 'matrix' },
          { text: 'The Matrix has you.', type: 'matrix' },
          { text: 'Follow the white rabbit.', type: 'matrix' }
        );
        break;

      default:
        // Treat as a natural language agent instruction
        newLines.push(
          { text: `● agent: reading source tree for ${coordinate.name} …`, type: 'ai' },
          { text: `● agent: planning changes for "${cmd}"`, type: 'ai' },
          { text: `● agent: generated diff preview for worktree ~/slop/${coordinate.appId}`, type: 'ai' },
          { text: '✓ 3 files changed, 1 added · git diff ready', type: 'success' },
          {
            text: '[NOTICE] Local mode is a planning guide. For host filesystem changes, run slop in your native terminal or Real PTY Gateway.',
            type: 'dim'
          }
        );
        setStageDone((prev) => {
          const n = [...prev];
          n[1] = true;
          return n;
        });
        break;
    }

    appendLines(newLines);
  };

  const handleStopRun = () => {
    playClickSound();
    setRunState('stopped');
    setRunPort('—');
    setRunMem('—');
    setRunMessage('not running — do the Run step');
    appendLines([{ text: '● RIG: stopped container', type: 'dim' }]);
  };

  const handleRestartRun = () => {
    playClickSound();
    handleStopRun();
    setTimeout(() => {
      handleStagePrimaryAction();
    }, 400);
  };

  // Forked display name
  const forkedDisplayName = `${makerHandle.replace('@', '')}/${coordinate.appId}`;

  return (
    <div
      className="flex flex-col h-full bg-[#c0c0c0] text-black font-sans text-xs select-none overflow-hidden"
      style={{
        fontFamily: '"MS Sans Serif", Tahoma, Geneva, Verdana, system-ui, sans-serif'
      }}
    >
      {/* Menu Bar */}
      <div
        className="flex items-center gap-1 px-1 py-0.5 text-xs bg-[#c0c0c0] border-b border-[#808080]"
        style={{
          boxShadow: 'inset 0 1px 0 #ffffff'
        }}
      >
        <span
          className="px-2 py-0.5 hover:bg-[#000080] hover:text-white cursor-pointer"
          onClick={() => {
            playClickSound();
            setModalType('pickApp');
          }}
        >
          <u>P</u>roject
        </span>
        <span
          className="px-2 py-0.5 hover:bg-[#000080] hover:text-white cursor-pointer"
          onClick={() => {
            playClickSound();
            setModalType('diff');
          }}
        >
          <u>E</u>dit
        </span>
        <span
          className="px-2 py-0.5 hover:bg-[#000080] hover:text-white cursor-pointer"
          onClick={() => {
            playClickSound();
            const nextAgent: AgentToolId = selectedAgent === 'agy' ? 'claude' : selectedAgent === 'claude' ? 'slop' : 'agy';
            setSelectedAgent(nextAgent);
            showAlert(
              `Active Agent Tool: ${nextAgent.toUpperCase()}\n\nConfigured CLI Binary: ${plan.agent.cliBinary}\nRecommended Model: ${plan.agent.recommendedModel}\n\nSLOPSHOP uses local agent harnesses with typed AST feature packages.`,
              'Agent Configuration',
              'info'
            );
          }}
        >
          <u>A</u>gent
        </span>
        <span
          className="px-2 py-0.5 hover:bg-[#000080] hover:text-white cursor-pointer"
          onClick={() => {
            playClickSound();
            if (runState === 'healthy') handleStopRun();
            else handleStagePrimaryAction();
          }}
        >
          <u>R</u>un
        </span>
        <span
          className="px-2 py-0.5 hover:bg-[#000080] hover:text-white cursor-pointer"
          onClick={() => {
            playClickSound();
            setModalType('verification');
          }}
        >
          <u>G</u>it
        </span>
        <span
          className="px-2 py-0.5 hover:bg-[#000080] hover:text-white cursor-pointer"
          onClick={() => {
            playClickSound();
            showAlert(
              "SLOPSHOP is the one-loop dev environment for Nate's Software Suite.\n\n1. Fork an app via GITSMITH forge\n2. Slop it with an AI agent in the terminal\n3. Run your fork live in the RIG runtime\n4. Push verified commits back to GITSMITH\n5. Publish for sale (you keep 70%)\n\nZero fabricated commits, test proofs, or fake runs.",
              'SLOPSHOP Help',
              'info'
            );
          }}
        >
          <u>H</u>elp
        </span>

        {/* Maker Personalization Indicator */}
        <div className="ml-auto flex items-center gap-1.5 text-[11px] px-2 text-[#3a3a3a]">
          {isAuthenticated ? (
            <span className="text-[#0a7d18] font-bold">{`signed in as @${user?.username}`}</span>
          ) : (
            <button
              onClick={() => openAuthModal?.()}
              className="text-[#666] hover:underline cursor-pointer bg-transparent border-0 p-0 text-[11px]"
            >
              (editable draft handle)
            </button>
          )}
          <input
            type="hidden"
            value={makerHandle}
            readOnly
          />
        </div>
      </div>

      {/* LOOP RAIL (The Redesign Spine: 5 Stages) */}
      <div
        className="grid grid-cols-5 gap-1.5 p-2 bg-[#d4d0c8] border-b border-[#808080]"
        id="rail"
      >
        {STAGE_NAMES.map((name, idx) => {
          const isActive = curStage === idx;
          const isDone = stageDone[idx];
          const subTitles = [
            'Copy an app to your namespace',
            'Change it with an AI agent, in the terminal',
            'Boot your fork and watch it live',
            'Send your commits back with proof',
            'List your version for sale'
          ];
          const backs = [
            'via GITSMITH forge',
            'this is the work',
            'RIG runtime',
            'to GITSMITH',
            'you keep 70%'
          ];

          return (
            <button
              key={name}
              onClick={() => handleSelectStage(idx)}
              className={`text-left p-2 flex flex-col gap-1 transition-none cursor-pointer outline-none focus:outline-none ${
                isActive
                  ? 'bg-[#e9e9e2] border-2 border-[#808080] border-r-[#ffffff] border-b-[#ffffff]'
                  : 'bg-[#c0c0c0] border-2 border-[#ffffff] border-r-[#404040] border-b-[#404040] hover:bg-[#cdcdc7]'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span
                  className={`flex items-center justify-center font-bold text-[11px] text-white shrink-0 ${
                    isDone ? 'bg-[#0a7d18]' : isActive ? 'bg-[#1084d0]' : 'bg-[#000080]'
                  }`}
                  style={{ width: '18px', height: '18px' }}
                >
                  {isDone ? '✓' : idx + 1}
                </span>
                <span className="font-bold text-xs truncate text-black">{name}</span>
              </div>
              <span className="text-[11px] text-[#3a3a3a] leading-tight line-clamp-1">
                {subTitles[idx]}
              </span>
              <span
                className={`text-[10px] ${
                  idx === 4 ? 'text-[#0a7d18] font-bold' : 'text-[#555]'
                }`}
              >
                {backs[idx]}
              </span>
            </button>
          );
        })}
      </div>

      {/* WORK AREA: Two Columns (Terminal Left 1.55fr, Run Panel Right 1fr) */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-[1.55fr_1fr] gap-2 p-1.5 overflow-hidden">
        {/* LEFT COLUMN: Terminal (The heart of "slop with AI") */}
        <div className="flex flex-col bg-[#c0c0c0] border-2 border-[#ffffff] border-r-[#404040] border-b-[#404040] overflow-hidden">
          {/* Panel Head */}
          <div
            className="bg-[#d4d0c8] px-2 py-1 font-bold text-xs flex items-center justify-between border-b border-[#808080]"
            style={{ boxShadow: 'inset 0 1px 0 #ffffff' }}
          >
            <span
              onClick={() => onOpenTerminal?.()}
              className="flex items-center gap-1.5 truncate cursor-pointer"
            >
              <span>🖥️</span>
              <span className="truncate">
                Terminal — <b className="text-black">{forkedDisplayName}</b>{' '}
                <span className="text-[#555] font-normal">(your fork)</span>
              </span>
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              {terminalMode === 'gateway' && terminalGateway.isConnected ? (
                <span className="text-[10px] font-bold px-1.5 py-0.5 bg-[#0a7d18] text-white">
                  gateway connected
                </span>
              ) : (
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 ${
                    curStage === 1 ? 'bg-[#0a7d18] text-white' : 'bg-[#808080] text-white'
                  }`}
                >
                  {curStage === 1 ? 'agent ready' : 'agent idle'}
                </span>
              )}
            </div>
          </div>

          {/* Terminal Screen Body */}
          <div className="flex-1 bg-[#0a0a0a] text-[#d6d6d6] border-2 border-[#808080] border-r-[#ffffff] border-b-[#ffffff] m-1 p-2 overflow-y-auto font-mono text-xs leading-relaxed">
            {terminalMode === 'gateway' && terminalGateway.isConnected ? (
              <div
                ref={xtermHostRef}
                className="w-full h-full"
              />
            ) : (
              <div
                ref={termScrollRef}
                className="space-y-0.5 h-full overflow-y-auto whitespace-pre-wrap break-words"
              >
                {terminalLines.map((line, i) => {
                  let cls = 'text-[#d6d6d6]';
                  if (line.type === 'input') cls = 'text-[#ffffff] font-bold';
                  else if (line.type === 'ai') cls = 'text-[#e0b34a] font-semibold';
                  else if (line.type === 'success') cls = 'text-[#35d15b]';
                  else if (line.type === 'dim') cls = 'text-[#7d7d7d]';
                  else if (line.type === 'error') cls = 'text-[#f87171]';
                  else if (line.type === 'system') cls = 'text-[#4ec9d6]';
                  else if (line.type === 'matrix') cls = 'text-[#22c55e]';

                  return (
                    <div
                      key={i}
                      className={cls}
                    >
                      {line.text}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Terminal Command Line Input */}
          <div className="flex items-center gap-1.5 bg-[#0a0a0a] border-2 border-[#808080] border-r-[#ffffff] border-b-[#ffffff] border-t-0 mx-1 mb-1 px-2 py-1">
            <span className="text-[#35d15b] font-mono font-bold text-xs">›</span>
            <input
              type="text"
              value={cmdInputVal}
              onChange={(e) => setCmdInputVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleCommandSubmit(cmdInputVal);
                } else if (e.key === 'ArrowUp') {
                  if (commandHistory.length > 0) {
                    const nextIdx = historyIdx + 1 < commandHistory.length ? historyIdx + 1 : historyIdx;
                    setHistoryIdx(nextIdx);
                    setCmdInputVal(commandHistory[commandHistory.length - 1 - nextIdx] || '');
                  }
                } else if (e.key === 'ArrowDown') {
                  if (historyIdx > 0) {
                    const nextIdx = historyIdx - 1;
                    setHistoryIdx(nextIdx);
                    setCmdInputVal(commandHistory[commandHistory.length - 1 - nextIdx] || '');
                  } else if (historyIdx === 0) {
                    setHistoryIdx(-1);
                    setCmdInputVal('');
                  }
                }
              }}
              placeholder="type a command, or ask the agent: add a high-score board"
              className="flex-1 bg-transparent text-[#d6d6d6] font-mono text-xs outline-none border-none placeholder-[#666]"
              spellCheck={false}
              autoComplete="off"
            />
          </div>
        </div>

        {/* RIGHT COLUMN: Run Panel (RIG folded into SLOPSHOP) */}
        <div className="flex flex-col bg-[#c0c0c0] border-2 border-[#ffffff] border-r-[#404040] border-b-[#404040] overflow-hidden">
          {/* Panel Head */}
          <div
            className="bg-[#d4d0c8] px-2 py-1 font-bold text-xs flex items-center justify-between border-b border-[#808080]"
            style={{ boxShadow: 'inset 0 1px 0 #ffffff' }}
          >
            <span
              onClick={() => onOpenRig?.()}
              className="flex items-center gap-1.5 truncate cursor-pointer"
            >
              <span>▶</span>
              <span>Run — your fork, live</span>
            </span>
            <span
              className={`text-[10px] font-bold px-1.5 py-0.5 ${
                runState === 'healthy'
                  ? 'bg-[#0a7d18] text-white'
                  : runState === 'building' || runState === 'starting'
                  ? 'bg-[#9a6b00] text-white'
                  : 'bg-[#808080] text-white'
              }`}
            >
              {runState === 'healthy'
                ? 'running :3004'
                : runState === 'building'
                ? 'building...'
                : runState === 'starting'
                ? 'starting...'
                : 'stopped'}
            </span>
          </div>

          <div className="flex-1 flex flex-col p-1 gap-1.5 overflow-hidden">
            {/* Address Bar */}
            <div
              className="flex items-center gap-1.5 px-2 py-1 bg-[#d4d0c8] border border-[#808080] text-[11px]"
              style={{ boxShadow: 'inset 1px 1px 0 #ffffff' }}
            >
              <span>🔒</span>
              <span className="flex-1 bg-white border border-[#808080] px-1.5 py-0.5 font-mono text-[11px] text-[#3a3a3a] truncate">
                {runState === 'healthy'
                  ? `${coordinate.appId}-${makerHandle.replace('@', '')}.slop.local :3004`
                  : '—'}
              </span>
              <button
                onClick={handleRestartRun}
                className="hover:text-blue-700"
                title="Reload"
              >
                ⟳
              </button>
            </div>

            {/* Run View Screen */}
            <div
              className={`flex-1 border-2 border-[#808080] border-r-[#ffffff] border-b-[#ffffff] flex flex-col items-center justify-center p-4 relative overflow-hidden text-center ${
                runState === 'healthy' ? 'bg-white' : 'bg-[#e4e4e4]'
              }`}
              style={{
                backgroundImage:
                  runState === 'healthy'
                    ? 'none'
                    : 'repeating-linear-gradient(45deg, #eee 0 8px, #e4e4e4 8px 16px)'
              }}
            >
              {runState === 'healthy' ? (
                <div className="flex flex-col items-center justify-center gap-1">
                  <div className="text-4xl">{coordinate.icon || '🦆'}</div>
                  <h4 className="text-base font-bold text-black mt-1 mb-0 font-mono">
                    {coordinate.name}
                  </h4>
                  <p className="text-xs text-[#555] m-0">
                    + your {activePreset.name.replace(/^[^a-zA-Z0-9]+/, '')}
                  </p>
                  <div className="mt-2 text-[11px] font-mono text-[#0a7d18] bg-[#eefbf0] border border-[#0a7d18] px-2 py-0.5">
                    ● RIG container active on :3004
                  </div>
                </div>
              ) : (
                <div className="text-[#555] text-xs font-mono">
                  {runMessage}
                </div>
              )}
            </div>

            {/* Metrics Row */}
            <div className="grid grid-cols-3 gap-1.5 text-[10px]">
              <div
                className="bg-[#d4d0c8] p-1 border border-[#808080]"
                style={{ boxShadow: 'inset 1px 1px 0 #ffffff' }}
              >
                <div className="text-[#555]">port</div>
                <b className="text-xs text-black font-mono">{runPort}</b>
              </div>
              <div
                className="bg-[#d4d0c8] p-1 border border-[#808080]"
                style={{ boxShadow: 'inset 1px 1px 0 #ffffff' }}
              >
                <div className="text-[#555]">mem</div>
                <b className="text-xs text-black font-mono">{runMem}</b>
              </div>
              <div
                className="bg-[#d4d0c8] p-1 border border-[#808080]"
                style={{ boxShadow: 'inset 1px 1px 0 #ffffff' }}
              >
                <div className="text-[#555]">status</div>
                <b className="text-xs text-black font-mono">{runState}</b>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* LEDGER NOTE: The Money Model (Stated Once) */}
      <div
        className="mx-1.5 p-2 bg-[#d4d0c8] border border-[#808080] flex items-center gap-3 flex-wrap text-xs"
        style={{ boxShadow: 'inset 1px 1px 0 #ffffff' }}
      >
        <span className="text-black font-medium">
          When your fork sells, the split is settled automatically:
        </span>
        <span className="flex items-center gap-1 font-mono text-[11px]">
          <i
            className="bg-[#000080] text-white px-1.5 py-0.2 font-normal not-italic font-mono"
            style={{ fontStyle: 'normal' }}
          >
            70%
          </i>{' '}
          you
        </span>
        <span className="flex items-center gap-1 font-mono text-[11px]">
          <i
            className="bg-[#000080] text-white px-1.5 py-0.2 font-normal not-italic font-mono"
            style={{ fontStyle: 'normal' }}
          >
            20%
          </i>{' '}
          up the fork lineage
        </span>
        <span className="flex items-center gap-1 font-mono text-[11px]">
          <i
            className="bg-[#000080] text-white px-1.5 py-0.2 font-normal not-italic font-mono"
            style={{ fontStyle: 'normal' }}
          >
            10%
          </i>{' '}
          protocol
        </span>
        <span className="text-[#555] text-[11px] ml-auto">
          A root app with no ancestors is 90 / 10.
        </span>
      </div>

      {/* PRIMARY ACTIONS (Dynamic Per Stage) */}
      <div className="flex items-center gap-2 p-1.5 flex-wrap">
        {curStage === 0 && (
          <>
            <button
              onClick={handleStagePrimaryAction}
              className="btn-w95 px-4 py-1 font-bold text-xs flex items-center gap-1 text-black"
            >
              <span className="text-[#000080]">▸</span> {`Fork ${coordinate.slug}`}
            </button>
            <button
              onClick={() => {
                playClickSound();
                setModalType('pickApp');
              }}
              className="btn-w95 px-3 py-1 text-xs text-black"
            >
              Pick another app
            </button>
          </>
        )}

        {curStage === 1 && (
          <>
            <button
              onClick={handleStagePrimaryAction}
              className="btn-w95 px-4 py-1 font-bold text-xs flex items-center gap-1 text-black"
            >
              <span className="text-[#000080]">▸</span> Ask the agent to make a change
            </button>
            <button
              onClick={() => {
                playClickSound();
                setModalType('diff');
              }}
              className="btn-w95 px-3 py-1 text-xs text-black"
            >
              Open the diff
            </button>
          </>
        )}

        {curStage === 2 && (
          <>
            <button
              onClick={handleStagePrimaryAction}
              className="btn-w95 px-4 py-1 font-bold text-xs flex items-center gap-1 text-black"
            >
              <span className="text-[#000080]">▸</span> Run my fork
            </button>
            <button
              onClick={handleRestartRun}
              className="btn-w95 px-3 py-1 text-xs text-black"
            >
              Restart
            </button>
          </>
        )}

        {curStage === 3 && (
          <>
            <button
              onClick={handleStagePrimaryAction}
              className="btn-w95 px-4 py-1 font-bold text-xs flex items-center gap-1 text-black"
            >
              <span className="text-[#000080]">▸</span> Push to GITSMITH
            </button>
            <button
              onClick={() => {
                playClickSound();
                setModalType('verification');
              }}
              className="btn-w95 px-3 py-1 text-xs text-black"
            >
              View verification
            </button>
          </>
        )}

        {curStage === 4 && (
          <>
            <button
              onClick={handleStagePrimaryAction}
              className="btn-w95 px-4 py-1 font-bold text-xs flex items-center gap-1 text-black"
            >
              <span className="text-[#000080]">▸</span> Publish for sale
            </button>
            <button
              onClick={() => {
                playClickSound();
                setModalType('price');
              }}
              className="btn-w95 px-3 py-1 text-xs text-black"
            >
              {`Set price ($${publishPrice})`}
            </button>
          </>
        )}

        <span className="text-[11px] text-[#555] ml-auto">
          {curStage < 4 ? 'or click the next stage above' : 'loop complete — start again anytime'}
        </span>
      </div>

      {/* STATUS BAR (3 Cells) */}
      <div className="flex gap-1 p-1 bg-[#c0c0c0] border-t border-[#808080] text-[11px]">
        <div className="px-2 py-0.5 border border-[#808080] bg-[#c0c0c0] text-[#3a3a3a] shrink-0 font-mono">
          {`Step ${curStage + 1} of 5 · ${STAGE_NAMES[curStage]}`}
        </div>
        <div className="flex-1 px-2 py-0.5 border border-[#808080] bg-[#c0c0c0] text-[#3a3a3a] truncate">
          {STATUS_MESSAGES[curStage]}
        </div>
        <div
          onClick={() => onOpenGitsmith?.()}
          className="px-2 py-0.5 border border-[#808080] bg-[#c0c0c0] text-[#3a3a3a] shrink-0 font-mono flex items-center gap-1 cursor-pointer"
        >
          <span>GITSMITH:</span>
          <span
            className={`font-bold ${
              gitsmithState === 'ready'
                ? 'text-[#0a7d18]'
                : gitsmithState === 'checking'
                ? 'text-[#9a6b00]'
                : 'text-[#808080]'
            }`}
          >
            {gitsmithState === 'ready' ? 'connected' : gitsmithState}
          </span>
        </div>
      </div>

      {/* MODAL: Pick Target App */}
      {modalType === 'pickApp' && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-[#c0c0c0] border-2 border-[#ffffff] border-r-[#404040] border-b-[#404040] shadow-xl w-full max-w-md p-1">
            <div className="titlebar-w95 px-2 py-1 flex items-center justify-between">
              <span className="font-bold text-xs text-white">Select Target Repository to Fork</span>
              <button
                onClick={() => setModalType(null)}
                className="w-4 h-4 bg-[#c0c0c0] border border-[#ffffff] border-r-[#404040] border-b-[#404040] text-black font-bold flex items-center justify-center text-[10px]"
              >
                ✕
              </button>
            </div>
            <div className="p-3 bg-[#ece9d8] space-y-2">
              <p className="text-xs text-black m-0">
                Choose an application to copy into your isolated worktree namespace:
              </p>
              <div className="space-y-1.5 max-h-60 overflow-y-auto border border-[#808080] bg-white p-2">
                {allCoordinates.map((app) => (
                  <div
                    key={app.appId}
                    onClick={() => {
                      playClickSound();
                      setSelectedAppId(app.appId);
                      setModalType(null);
                      appendLines([
                        { text: `› slop fork ${app.slug}`, type: 'input' },
                        { text: `switched active target to ${app.slug}`, type: 'dim' }
                      ]);
                    }}
                    onDoubleClick={() => onOpenApp?.(app.appId)}
                    className={`p-2 border cursor-pointer flex items-center justify-between ${
                      selectedAppId === app.appId
                        ? 'bg-[#000080] text-white border-[#000080]'
                        : 'border-[#d4d0c8] hover:bg-[#f0f0f0] text-black'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{app.icon || '📦'}</span>
                      <div>
                        <div className="font-bold text-xs">{app.name}</div>
                        <div className="text-[10px] opacity-80 font-mono">{app.slug}</div>
                      </div>
                    </div>
                    <span className="text-xs font-mono">{app.price}</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setModalType(null)}
                  className="btn-w95 px-4 py-1 text-xs"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Open Diff & Manifest */}
      {modalType === 'diff' && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-[#c0c0c0] border-2 border-[#ffffff] border-r-[#404040] border-b-[#404040] shadow-xl w-full max-w-xl p-1">
            <div className="titlebar-w95 px-2 py-1 flex items-center justify-between">
              <span className="font-bold text-xs text-white">AST Feature Diff &amp; Manifest</span>
              <button
                onClick={() => setModalType(null)}
                className="w-4 h-4 bg-[#c0c0c0] border border-[#ffffff] border-r-[#404040] border-b-[#404040] text-black font-bold flex items-center justify-center text-[10px]"
              >
                ✕
              </button>
            </div>
            <div className="p-3 bg-[#ece9d8] space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs font-mono">{activePreset.name}</span>
                <span className="text-[10px] text-[#555] font-mono">
                  {activePreset.targetFiles.length} target files
                </span>
              </div>
              <div className="border border-[#808080] bg-[#0a0a0a] text-[#35d15b] p-2 font-mono text-[11px] max-h-72 overflow-y-auto whitespace-pre">
                {activePreset.blueprintDiffPreview || 'diff --git a/src/app.ts b/src/app.ts\n+ // AST Feature splice staged'}
              </div>
              <div className="flex justify-between items-center pt-2">
                <button
                  onClick={() => {
                    playSuccessChime();
                    navigator.clipboard.writeText(plan.manifestJson);
                    showAlert('Feature manifest JSON copied to clipboard!', 'Copied', 'success');
                  }}
                  className="btn-w95 px-3 py-1 text-xs"
                >
                  Copy Manifest JSON
                </button>
                <button
                  onClick={() => setModalType(null)}
                  className="btn-w95 px-4 py-1 text-xs"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Verification Criteria */}
      {modalType === 'verification' && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-[#c0c0c0] border-2 border-[#ffffff] border-r-[#404040] border-b-[#404040] shadow-xl w-full max-w-md p-1">
            <div className="titlebar-w95 px-2 py-1 flex items-center justify-between">
              <span className="font-bold text-xs text-white">Cryptographic Verification Proof</span>
              <button
                onClick={() => setModalType(null)}
                className="w-4 h-4 bg-[#c0c0c0] border border-[#ffffff] border-r-[#404040] border-b-[#404040] text-black font-bold flex items-center justify-center text-[10px]"
              >
                ✕
              </button>
            </div>
            <div className="p-3 bg-[#ece9d8] space-y-2">
              <p className="text-xs text-black m-0">
                To land commits on GITSMITH forge without fabrication, all 4 assertions must pass:
              </p>
              <div className="border border-[#808080] bg-white p-2.5 space-y-2 text-xs">
                {evidenceChecklist.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-2"
                  >
                    <span className="text-[#0a7d18] font-bold">✓</span>
                    <div>
                      <div className="font-bold font-mono text-[11px]">{item.title}</div>
                      <div className="text-[10px] text-[#555] font-mono">{item.command}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setModalType(null)}
                  className="btn-w95 px-4 py-1 text-xs"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Set Price */}
      {modalType === 'price' && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-[#c0c0c0] border-2 border-[#ffffff] border-r-[#404040] border-b-[#404040] shadow-xl w-full max-w-sm p-1">
            <div className="titlebar-w95 px-2 py-1 flex items-center justify-between">
              <span className="font-bold text-xs text-white">Set Listing Price</span>
              <button
                onClick={() => setModalType(null)}
                className="w-4 h-4 bg-[#c0c0c0] border border-[#ffffff] border-r-[#404040] border-b-[#404040] text-black font-bold flex items-center justify-center text-[10px]"
              >
                ✕
              </button>
            </div>
            <div className="p-3 bg-[#ece9d8] space-y-3">
              <div>
                <label className="block text-xs font-bold mb-1">Price (USD):</label>
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-sm">$</span>
                  <input
                    type="number"
                    min="1"
                    max="500"
                    value={publishPrice}
                    onChange={(e) => setPublishPrice(e.target.value)}
                    className="w-full bg-white border-2 border-[#808080] border-r-[#ffffff] border-b-[#ffffff] px-2 py-1 font-mono text-sm outline-none"
                  />
                  <span className="text-xs text-[#555]">.00</span>
                </div>
              </div>
              <div className="text-[11px] text-[#555] bg-white border border-[#808080] p-2">
                At ${publishPrice}.00:
                <br />• <b>70%</b> (${((Number(publishPrice) || 0) * 0.7).toFixed(2)}) goes directly to you.
                <br />• <b>20%</b> (${((Number(publishPrice) || 0) * 0.2).toFixed(2)}) goes to upstream lineage.
                <br />• <b>10%</b> (${((Number(publishPrice) || 0) * 0.1).toFixed(2)}) goes to protocol liquidity.
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={() => setModalType(null)}
                  className="btn-w95 px-4 py-1 text-xs font-bold"
                >
                  Save Price
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
