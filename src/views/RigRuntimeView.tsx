import React, { useState, useEffect, useRef } from 'react';
import {
  Cpu,
  ShieldCheck,
  AlertTriangle,
  Play,
  Square,
  RotateCcw,
  Trash2,
  HardDrive,
  Clock,
  Activity,
  Layers,
  Flame,
  Zap,
  Info,
  Server
} from 'lucide-react';
import {
  type RigInstance,
  type RigLifecycleState,
  type RigRuntimeAdapterKind,
  type RigStorageKind,
  type RigStoragePersistence,
  type RigSpec,
  formatDuration
} from '../lib/rigDomain';
import { RigControlPlane } from '../lib/rigBackend';
import { createRigInstance, deleteRigInstance, getRigInstanceLogs, listRigInstances, mutateRigInstance } from '../lib/rigClient';
import { useAuth } from '../context/AuthContext';

export const RigRuntimeView: React.FC = () => {
  const { user, openAuthModal } = useAuth();
  // Deterministic control-plane instance
  const controlPlaneRef = useRef<RigControlPlane>(new RigControlPlane());
  const [instances, setInstances] = useState<RigInstance[]>([]);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);

  // Configuration Form State (Empty initial first-run)
  const [appId, setAppId] = useState('dronehunter');
  const [appName, setAppName] = useState('DroneHunter Telemetry');
  const [adapter, setAdapter] = useState<RigRuntimeAdapterKind>('docker');
  const [buildCommand, setBuildCommand] = useState('npm run build');
  const [startCommand, setStartCommand] = useState('node dist/server.js');
  const [healthEndpoint, setHealthEndpoint] = useState('/healthz');
  const [storageKind, setStorageKind] = useState<RigStorageKind | 'none'>('none');
  const [storagePath, setStoragePath] = useState('/data');
  const [storagePersistence, setStoragePersistence] = useState<RigStoragePersistence>('ephemeral');
  const [storageSizeMb, setStorageSizeMb] = useState<number>(64);
  const [memoryCapMb, setMemoryCapMb] = useState<number>(256);
  const [ttlSeconds, setTtlSeconds] = useState<number>(900); // 15m default
  const [autoProgress, setAutoProgress] = useState<boolean>(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [providerState, setProviderState] = useState<'checking' | 'ready' | 'unavailable'>('checking');
  const [providerMessage, setProviderMessage] = useState('Checking the production provider gateway…');
  const [fleetMode, setFleetMode] = useState<'provider' | 'simulation'>('simulation');
  const [imageDigest, setImageDigest] = useState('');
  const [isWorking, setIsWorking] = useState(false);
  const [liveLogs, setLiveLogs] = useState<string | null>(null);

  // Fix 2 (RIG spec): deploy-readiness preflight. Gates the "Launch Isolated
  // Provider Instance" publish control — a live app launch is never offered
  // as available until GET /api/product-readiness?appId=...&deploy=1 reports
  // ready:true. Fails closed: unknown/unchecked/error states never enable
  // the control, they only ever show honest blocking reasons.
  const [deployPreflight, setDeployPreflight] = useState<{
    status: 'idle' | 'checking' | 'ready' | 'not-ready' | 'error';
    reasons: string[];
  }>({ status: 'idle', reasons: [] });

  const timersRef = useRef<NodeJS.Timeout[]>([]);

  const refreshState = () => {
    const list = controlPlaneRef.current.listInstances();
    setInstances([...list]);
    if (selectedInstanceId && !list.some(i => i.spec.id === selectedInstanceId)) {
      setSelectedInstanceId(list.length > 0 ? list[0].spec.id : null);
    } else if (!selectedInstanceId && list.length > 0) {
      setSelectedInstanceId(list[0].spec.id);
    }
  };

  const applyProviderFleet = (list: RigInstance[]) => {
    setInstances(list);
    setSelectedInstanceId(current => list.some(instance => instance.spec.id === current) ? current : list[0]?.spec.id || null);
  };

  const refreshProviderFleet = async () => {
    const list = await listRigInstances();
    applyProviderFleet(list);
  };

  useEffect(() => {
    refreshState();
    const controller = new AbortController();
    fetch('/api/rig?action=readiness', { cache: 'no-store', credentials: 'same-origin', signal: controller.signal })
      .then(async response => ({ response, body: await response.json().catch(() => null) }))
      .then(({ response, body }) => {
        if (response.ok && body?.ready === true) {
          setProviderState('ready');
          setFleetMode('provider');
          setProviderMessage('Production Docker gateway proved its isolation, resource-cap, and cleanup contract.');
          if (user) void refreshProviderFleet().catch(error => setFormError(error.message));
        } else {
          setProviderState('unavailable');
          setProviderMessage(body?.error || 'No production provider gateway is available.');
        }
      })
      .catch(error => {
        if (error?.name !== 'AbortError') {
          setProviderState('unavailable');
          setProviderMessage('The production provider readiness check failed.');
        }
      });
    return () => {
      controller.abort();
      timersRef.current.forEach(t => clearTimeout(t));
      timersRef.current = [];
    };
  }, [user?.id]);

  // Fix 2 (RIG spec): re-check deploy readiness whenever provider mode is
  // active and the target appId changes. Never offer the live launch control
  // as available while this is 'checking', 'not-ready', or 'error' — only an
  // explicit ready:true from the server flips it.
  useEffect(() => {
    const cleanAppId = appId.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-');
    if (fleetMode !== 'provider' || !cleanAppId) {
      setDeployPreflight({ status: 'idle', reasons: [] });
      return;
    }
    const controller = new AbortController();
    setDeployPreflight({ status: 'checking', reasons: [] });
    fetch(`/api/product-readiness?appId=${encodeURIComponent(cleanAppId)}&deploy=1`, {
      cache: 'no-store', credentials: 'same-origin', signal: controller.signal
    })
      .then(async response => ({ response, body: await response.json().catch(() => null) }))
      .then(({ response, body }) => {
        const deploy = body?.readiness?.deploy;
        if (!response.ok || !body?.success || !deploy) {
          setDeployPreflight({ status: 'error', reasons: [body?.error || 'Deploy readiness could not be determined.'] });
          return;
        }
        setDeployPreflight({ status: deploy.ready ? 'ready' : 'not-ready', reasons: deploy.reasons || [] });
      })
      .catch(error => {
        if (error?.name !== 'AbortError') {
          setDeployPreflight({ status: 'error', reasons: ['The deploy readiness preflight request failed.'] });
        }
      });
    return () => controller.abort();
  }, [fleetMode, appId]);

  const handleLaunchPlan = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!appId.trim()) {
      setFormError('App ID is required.');
      return;
    }
    if (!startCommand.trim()) {
      setFormError('Start command is required.');
      return;
    }

    try {
      const cleanAppId = appId.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-');
      const specId = `rig-${cleanAppId}-${Date.now().toString(36).slice(-4)}`;

      const storageMounts =
        storageKind !== 'none'
          ? [
              {
                name: 'default-storage',
                kind: storageKind,
                mountPath: storagePath.trim() || '/data',
                sizeMb: storageSizeMb,
                persistence: storagePersistence
              }
            ]
          : undefined;

      if (fleetMode === 'provider' && !user) {
        openAuthModal('login');
        setFormError('Sign in before launching a live RIG instance.');
        return;
      }
      if (fleetMode === 'provider' && adapter !== 'docker') {
        setFormError('The commissioned live provider currently accepts only the Docker adapter.');
        return;
      }
      if (fleetMode === 'provider' && deployPreflight.status !== 'ready') {
        setFormError(deployPreflight.reasons[0] || 'The deploy readiness preflight has not passed for this app; publish is not available yet.');
        return;
      }
      if (fleetMode === 'provider' && !imageDigest.trim()) {
        setFormError('A content-addressed OCI image digest is required for a live launch.');
        return;
      }

      const newSpec: RigSpec = {
        id: specId,
        appId: cleanAppId,
        name: appName.trim() || cleanAppId,
        runtime: {
          adapter,
          buildCommand: buildCommand.trim() || undefined,
          startCommand: startCommand.trim(),
          healthEndpoint: healthEndpoint.trim() || undefined,
          imageDigest: fleetMode === 'provider' ? imageDigest.trim() : undefined,
          networkPolicy: 'none'
        },
        resources: {
          memoryCapMb,
          cpuCores: 1
        },
        storage: storageMounts,
        ttlSeconds,
        source: fleetMode === 'provider' ? 'provider' : 'demo',
        createdAt: new Date().toISOString()
      };

      if (fleetMode === 'provider') {
        setIsWorking(true);
        const instance = await createRigInstance(newSpec);
        await refreshProviderFleet();
        setSelectedInstanceId(instance.spec.id);
        return;
      }

      const instance = controlPlaneRef.current.createInstance(newSpec);
      refreshState();
      setSelectedInstanceId(instance.spec.id);

      // Auto-progress through lifecycle states if enabled
      if (autoProgress) {
        // Step 1: building
        const t1 = setTimeout(() => {
          try {
            controlPlaneRef.current.transitionState(
              specId,
              'building',
              buildCommand.trim()
                ? `Simulated build phase; command plan: ${buildCommand.trim()}`
                : 'Simulated build phase; command plan: none'
            );
            refreshState();
          } catch {}
        }, 600);
        timersRef.current.push(t1);

        // Step 2: starting
        const t2 = setTimeout(() => {
          try {
            controlPlaneRef.current.transitionState(
              specId,
              'starting',
              `Simulated start phase; command plan: ${startCommand.trim()}`
            );
            controlPlaneRef.current.updateMemory(specId, 32);
            refreshState();
          } catch {}
        }, 1300);
        timersRef.current.push(t2);

        // Step 3: healthy
        const t3 = setTimeout(() => {
          try {
            controlPlaneRef.current.transitionState(
              specId,
              'healthy',
              'Simulated healthy observation; no probe executed'
            );
            refreshState();
          } catch {}
        }, 2000);
        timersRef.current.push(t3);
      }
    } catch (err: any) {
      setFormError(err.message || 'Failed to create instance.');
    } finally {
      setIsWorking(false);
    }
  };

  const handleStepTransition = (id: string, targetState: RigLifecycleState, reason?: string) => {
    try {
      controlPlaneRef.current.transitionState(id, targetState, reason);
      refreshState();
    } catch (err: any) {
      alert(`Transition error: ${err.message}`);
    }
  };

  const handleStop = async (id: string) => {
    if (fleetMode === 'provider') {
      setIsWorking(true);
      setFormError(null);
      try { await mutateRigInstance('stop', id); await refreshProviderFleet(); }
      catch (error: any) { setFormError(error.message); }
      finally { setIsWorking(false); }
      return;
    }
    try {
      controlPlaneRef.current.stopInstance(id, 'Simulated stop by operator');
      refreshState();
    } catch (err: any) {
      alert(`Stop error: ${err.message}`);
    }
  };

  const handleRestart = async (id: string) => {
    if (fleetMode === 'provider') {
      setIsWorking(true);
      setFormError(null);
      try { await mutateRigInstance('restart', id); await refreshProviderFleet(); }
      catch (error: any) { setFormError(error.message); }
      finally { setIsWorking(false); }
      return;
    }
    try {
      controlPlaneRef.current.restartInstance(id);
      refreshState();

      if (autoProgress) {
        const t1 = setTimeout(() => {
          try {
            controlPlaneRef.current.transitionState(id, 'building', 'Simulated build phase; command plan: rebuild');
            refreshState();
          } catch {}
        }, 400);
        timersRef.current.push(t1);

        const t2 = setTimeout(() => {
          try {
            controlPlaneRef.current.transitionState(id, 'starting', 'Simulated start phase; command plan: restart');
            controlPlaneRef.current.updateMemory(id, 28);
            refreshState();
          } catch {}
        }, 900);
        timersRef.current.push(t2);

        const t3 = setTimeout(() => {
          try {
            controlPlaneRef.current.transitionState(id, 'healthy', 'Simulated healthy observation; no probe executed');
            refreshState();
          } catch {}
        }, 1400);
        timersRef.current.push(t3);
      }
    } catch (err: any) {
      alert(`Restart error: ${err.message}`);
    }
  };

  const handleSimulateOOM = (id: string) => {
    try {
      const inst = controlPlaneRef.current.getInstance(id);
      const exceedMb = (inst?.spec.resources.memoryCapMb || 256) + 128;
      controlPlaneRef.current.updateMemory(id, exceedMb);
      refreshState();
    } catch (err: any) {
      alert(`OOM error: ${err.message}`);
    }
  };

  const handleSimulateCrash = (id: string) => {
    try {
      controlPlaneRef.current.transitionState(id, 'crashed', 'Simulated crash; exit code 1');
      refreshState();
    } catch (err: any) {
      alert(`Crash simulation error: ${err.message}`);
    }
  };

  const handleSimulateExpiry = (id: string) => {
    try {
      // Force expiry by checking with future timestamp
      const inst = controlPlaneRef.current.getInstance(id);
      if (inst) {
        controlPlaneRef.current.transitionState(
          id,
          'expired',
          `Simulated TTL expiry after ${inst.spec.ttlSeconds}s boundary`
        );
        refreshState();
      }
    } catch (err: any) {
      alert(`Expiry simulation error: ${err.message}`);
    }
  };

  const handleDelete = async (id: string) => {
    if (fleetMode === 'provider') {
      setIsWorking(true);
      setFormError(null);
      try { await deleteRigInstance(id); await refreshProviderFleet(); setLiveLogs(null); }
      catch (error: any) { setFormError(error.message); }
      finally { setIsWorking(false); }
      return;
    }
    controlPlaneRef.current.deleteInstance(id);
    refreshState();
  };

  const localSummary = controlPlaneRef.current.getStatusSummary();
  const providerPorts = instances.flatMap(instance => instance.observed.allocatedPort ? [instance.observed.allocatedPort] : []);
  const summary = fleetMode === 'provider' ? {
    totalInstances: instances.length,
    activePorts: providerPorts,
    availablePorts: Array.from({ length: 10 }, (_, index) => 3001 + index).filter(port => !providerPorts.includes(port)),
    fleetStats: {
      totalUsedMb: instances.reduce((sum, instance) => sum + instance.observed.memoryMb, 0),
      totalCapMb: instances.reduce((sum, instance) => sum + instance.spec.resources.memoryCapMb, 0)
    }
  } : localSummary;
  const selectedInstance = instances.find(i => i.spec.id === selectedInstanceId);

  const getStatusBadge = (state: RigLifecycleState) => {
    switch (state) {
      case 'queued':
        return <span className="bg-blue-100 text-blue-800 border border-blue-400 font-mono font-bold px-2 py-0.5 rounded text-[10px]">QUEUED</span>;
      case 'building':
        return <span className="bg-amber-100 text-amber-900 border border-amber-400 font-mono font-bold px-2 py-0.5 rounded text-[10px] animate-pulse">BUILDING...</span>;
      case 'starting':
        return <span className="bg-purple-100 text-purple-800 border border-purple-400 font-mono font-bold px-2 py-0.5 rounded text-[10px] animate-pulse">STARTING...</span>;
      case 'healthy':
        return <span className="bg-green-100 text-green-800 border border-green-500 font-mono font-bold px-2 py-0.5 rounded text-[10px]">● HEALTHY</span>;
      case 'degraded':
        return <span className="bg-yellow-100 text-yellow-900 border border-yellow-500 font-mono font-bold px-2 py-0.5 rounded text-[10px]">▲ DEGRADED</span>;
      case 'crashed':
        return <span className="bg-red-100 text-red-800 border border-red-500 font-mono font-bold px-2 py-0.5 rounded text-[10px]">✕ CRASHED</span>;
      case 'oom':
        return <span className="bg-rose-100 text-rose-900 border border-rose-500 font-mono font-bold px-2 py-0.5 rounded text-[10px]">⚠ OOM (CAP EXCEEDED)</span>;
      case 'expired':
        return <span className="bg-gray-200 text-gray-800 border border-gray-400 font-mono font-bold px-2 py-0.5 rounded text-[10px]">⏱ EXPIRED</span>;
      case 'stopped':
        return <span className="bg-slate-200 text-slate-700 border border-slate-400 font-mono font-bold px-2 py-0.5 rounded text-[10px]">■ STOPPED</span>;
      default:
        return <span className="bg-gray-100 text-gray-800 font-mono px-2 py-0.5 rounded text-[10px]">{state}</span>;
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#ece9d8] font-tahoma text-xs">
      {/* Top Header Navigation */}
      <div className="bg-gradient-to-r from-gray-900 via-blue-950 to-gray-900 text-white p-2.5 flex items-center justify-between border-b-2 border-gray-700 flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Cpu size={16} className="text-cyan-400" />
          <span className="font-bold text-sm text-cyan-300 font-mono">RIG.EXE CONTROL-PLANE PREVIEW</span>
          <span className="bg-blue-950 text-cyan-200 text-[10px] font-bold px-2 py-0.5 rounded border border-cyan-600 font-mono">
            RUNTIME &amp; STORAGE AGNOSTIC
          </span>
          {user?.username ? (
            <span className="bg-emerald-950/90 text-emerald-300 text-[10px] font-bold px-2 py-0.5 rounded border border-emerald-500/80 font-mono">
              @{user.username}'s fleet
            </span>
          ) : (
            <span className="bg-slate-900 text-slate-400 text-[10px] font-bold px-2 py-0.5 rounded border border-slate-700 font-mono">
              Guest fleet
            </span>
          )}
        </div>

        {/* Boundary Indicator */}
        <div className="flex items-center gap-2">
          <span className={`${providerState === 'ready' ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/80' : providerState === 'checking' ? 'bg-blue-950/80 text-blue-300 border-blue-500/80' : 'bg-amber-950/80 text-amber-300 border-amber-500/80'} border px-2 py-0.5 rounded text-[10px] font-mono flex items-center gap-1`}>
            {providerState === 'ready' ? <ShieldCheck size={11} /> : <AlertTriangle size={11} />}
            PROVIDER STATUS: {providerState === 'ready' ? 'GATEWAY READY' : providerState === 'checking' ? 'CHECKING' : 'UNAVAILABLE'}
          </span>
        </div>
      </div>

      {/* Honest Boundary Notice Banner */}
      <div className="bg-amber-50 border-b border-amber-300 px-3 py-1.5 text-[11px] text-amber-900 flex items-center justify-between flex-wrap gap-1">
        <div className="flex items-center gap-1.5">
          <Info size={13} className="text-amber-700 shrink-0" />
          <span>
            <strong>Deterministic State Machine Preview:</strong> This manifest builder remains a local simulation and never represents simulated lifecycle events as provider observations. {providerMessage}
          </span>
        </div>
        <div className="text-[10px] text-amber-800 font-mono">
          Allocated Ports: {summary.activePorts.length > 0 ? summary.activePorts.join(', ') : 'None'} | Available: {summary.availablePorts.length}
        </div>
      </div>

      {/* Main Responsive Grid */}
      <div className="flex-1 p-3 overflow-y-auto grid grid-cols-1 lg:grid-cols-12 gap-3">
        {/* Left Column: Spec Configuration & Plan Builder Form */}
        <div className="lg:col-span-5 flex flex-col gap-3">
          <div className="bg-white border-2 border-gray-800 p-3 rounded shadow-sm">
            <div className="border-b pb-1.5 mb-2.5 flex items-center justify-between">
              <span className="font-bold text-xs text-w95-blue flex items-center gap-1.5">
                <Layers size={13} /> Runtime Manifest Builder
              </span>
              <span className="text-[10px] bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded border border-gray-300 font-mono">
                source: {fleetMode === 'provider' ? 'provider' : 'simulation'}
              </span>
            </div>

            <form onSubmit={handleLaunchPlan} className="space-y-2.5">
              {formError && (
                <div className="p-2 bg-red-50 border border-red-400 text-red-700 text-xs rounded">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-1 rounded border border-gray-400 bg-gray-100 p-1" aria-label="Fleet source">
                <button
                  type="button"
                  disabled={providerState !== 'ready'}
                  onClick={() => {
                    setFleetMode('provider');
                    setLiveLogs(null);
                    if (user) void refreshProviderFleet().catch(error => setFormError(error.message));
                  }}
                  className={`${fleetMode === 'provider' ? 'btn-w95-primary' : 'btn-w95'} py-1 text-[10px] font-bold disabled:opacity-50`}
                >
                  Live Provider {providerState === 'ready' ? 'Ready' : 'Unavailable'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFleetMode('simulation');
                    setLiveLogs(null);
                    refreshState();
                  }}
                  className={`${fleetMode === 'simulation' ? 'btn-w95-primary' : 'btn-w95'} py-1 text-[10px] font-bold`}
                >
                  Offline Manifest Simulator
                </button>
              </div>

              {/* App ID and Display Name */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-gray-700 mb-0.5">App ID</label>
                  <input
                    type="text"
                    value={appId}
                    onChange={e => setAppId(e.target.value)}
                    className="w-full p-1.5 border border-gray-400 font-mono text-xs rounded bg-white"
                    placeholder="e.g. dronehunter"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-gray-700 mb-0.5">Display Name</label>
                  <input
                    type="text"
                    value={appName}
                    onChange={e => setAppName(e.target.value)}
                    className="w-full p-1.5 border border-gray-400 text-xs rounded bg-white"
                    placeholder="e.g. DroneHunter"
                  />
                </div>
              </div>

              {/* Runtime Adapter Selection */}
              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-0.5">Runtime Adapter</label>
                <select
                  value={adapter}
                  onChange={e => setAdapter(e.target.value as RigRuntimeAdapterKind)}
                  className="w-full p-1.5 border border-gray-400 text-xs rounded bg-white font-mono"
                >
                  <option value="docker">Docker Container (docker)</option>
                  <option value="process" disabled={fleetMode === 'provider'}>Direct Process (process)</option>
                  <option value="wasm" disabled={fleetMode === 'provider'}>WebAssembly Sandbox (wasm)</option>
                  <option value="custom" disabled={fleetMode === 'provider'}>Custom Adapter (custom)</option>
                  <option value="simulation" disabled={fleetMode === 'provider'}>Local Simulation (simulation)</option>
                </select>
              </div>

              {fleetMode === 'provider' && (
                <div>
                  <label className="block text-[11px] font-bold text-gray-700 mb-0.5">Immutable OCI Image Digest</label>
                  <input
                    type="text"
                    value={imageDigest}
                    onChange={event => setImageDigest(event.target.value)}
                    className="w-full p-1.5 border border-gray-400 font-mono text-[10px] rounded bg-white"
                    placeholder="registry.example/app@sha256:64-hex-digest"
                    required
                  />
                  <p className="mt-0.5 text-[10px] text-gray-500">Floating tags such as latest are rejected by the gateway.</p>
                </div>
              )}

              {/* Build and Start Commands */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-gray-700 mb-0.5">
                    {fleetMode === 'provider' ? 'Build Command (Not run by provider)' : 'Build Command (Simulation Plan)'}
                  </label>
                  <input
                    type="text"
                    value={buildCommand}
                    onChange={e => setBuildCommand(e.target.value)}
                    disabled={fleetMode === 'provider'}
                    className="w-full p-1.5 border border-gray-400 font-mono text-xs rounded bg-white disabled:bg-gray-100 disabled:text-gray-500"
                    placeholder="e.g. npm run build"
                  />
                  {fleetMode === 'provider' && <p className="mt-0.5 text-[10px] text-gray-500">Build and verify before publishing the image digest.</p>}
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-gray-700 mb-0.5">Start Command</label>
                  <input
                    type="text"
                    value={startCommand}
                    onChange={e => setStartCommand(e.target.value)}
                    className="w-full p-1.5 border border-gray-400 font-mono text-xs rounded bg-white"
                    placeholder="e.g. node dist/server.js"
                    required
                  />
                </div>
              </div>

              {/* Health Endpoint */}
              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-0.5">Health Check Endpoint</label>
                <input
                  type="text"
                  value={healthEndpoint}
                  onChange={e => setHealthEndpoint(e.target.value)}
                  className="w-full p-1.5 border border-gray-400 font-mono text-xs rounded bg-white"
                  placeholder="/healthz"
                />
              </div>

              {/* Storage Mode (Runtime & Storage Freedom) */}
              <div className="bg-gray-50 border border-gray-300 p-2 rounded space-y-1.5">
                <div className="font-bold text-gray-800 text-[11px] flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    <HardDrive size={12} className="text-gray-600" /> Storage Declaration (Generic Mount)
                  </span>
                  <span className="text-[10px] text-gray-500 font-normal">Optional</span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] text-gray-600 mb-0.5">Storage Kind</label>
                    <select
                      value={storageKind}
                      onChange={e => setStorageKind(e.target.value as RigStorageKind)}
                      className="w-full p-1 border border-gray-400 text-xs rounded bg-white"
                    >
                      <option value="none">None (Stateless)</option>
                      <option value="sqlite">SQLite Database</option>
                      <option value="volume">Generic Volume</option>
                      <option value="directory">Directory Mount</option>
                      <option value="ephemeral">Ephemeral tmpfs</option>
                      <option value="block">Block Storage</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-600 mb-0.5">Persistence Policy</label>
                    <select
                      value={storagePersistence}
                      disabled={storageKind === 'none'}
                      onChange={e => setStoragePersistence(e.target.value as RigStoragePersistence)}
                      className="w-full p-1 border border-gray-400 text-xs rounded bg-white disabled:bg-gray-100"
                    >
                      <option value="persistent">Persistent</option>
                      <option value="ephemeral">Ephemeral (Wipe on stop)</option>
                      <option value="retained">Retained</option>
                    </select>
                  </div>
                </div>

                {storageKind !== 'none' && (
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div>
                      <label className="block text-[10px] text-gray-600 mb-0.5">Mount Path</label>
                      <input
                        type="text"
                        value={storagePath}
                        onChange={e => setStoragePath(e.target.value)}
                        className="w-full p-1 border border-gray-400 font-mono text-xs rounded bg-white"
                        placeholder="/data"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-gray-600 mb-0.5">Size Limit (MB)</label>
                      <input
                        type="number"
                        value={storageSizeMb}
                        onChange={e => setStorageSizeMb(Number(e.target.value) || 64)}
                        className="w-full p-1 border border-gray-400 font-mono text-xs rounded bg-white"
                        min="1"
                        max="256"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Resource Limits and TTL */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-gray-700 mb-0.5">Memory Cap</label>
                  <select
                    value={memoryCapMb}
                    onChange={e => setMemoryCapMb(Number(e.target.value))}
                    className="w-full p-1.5 border border-gray-400 text-xs rounded bg-white font-mono"
                  >
                    <option value="128">128 MB</option>
                    <option value="256">256 MB (Standard)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-gray-700 mb-0.5">TTL / Auto-Expiry</label>
                  <select
                    value={ttlSeconds}
                    onChange={e => setTtlSeconds(Number(e.target.value))}
                    className="w-full p-1.5 border border-gray-400 text-xs rounded bg-white font-mono"
                  >
                    <option value="300">5 Minutes (300s)</option>
                    <option value="900">15 Minutes (900s)</option>
                    <option value="1800">30 Minutes (1800s)</option>
                    <option value="3600">1 Hour (3600s)</option>
                  </select>
                </div>
              </div>

              {/* Options */}
              {fleetMode === 'simulation' && <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="autoProgress"
                  checked={autoProgress}
                  onChange={e => setAutoProgress(e.target.checked)}
                  className="rounded text-blue-600"
                />
                <label htmlFor="autoProgress" className="text-[11px] text-gray-700 cursor-pointer">
                  Auto-step lifecycle: <span className="font-mono text-[10px] text-gray-500">queued &rarr; building &rarr; starting &rarr; healthy</span>
                </label>
              </div>}

              {/* Deploy-readiness preflight (Fix 2, RIG spec): honest blocking
                  reasons shown BEFORE the publish control is offered — never a
                  dead-end publish attempt. */}
              {fleetMode === 'provider' && deployPreflight.status !== 'idle' && (
                <div
                  data-testid="deploy-preflight-panel"
                  className={`border rounded p-2 text-[10px] space-y-1 ${
                    deployPreflight.status === 'ready'
                      ? 'bg-green-50 border-green-400 text-green-800'
                      : deployPreflight.status === 'checking'
                        ? 'bg-gray-50 border-gray-300 text-gray-600'
                        : 'bg-yellow-50 border-yellow-400 text-yellow-900'
                  }`}
                >
                  <div className="font-bold flex items-center gap-1">
                    {deployPreflight.status === 'ready' && <>✓ DEPLOY PREFLIGHT: READY</>}
                    {deployPreflight.status === 'checking' && <>Checking deploy readiness…</>}
                    {deployPreflight.status === 'not-ready' && <><AlertTriangle size={11} /> DEPLOY PREFLIGHT: NOT READY</>}
                    {deployPreflight.status === 'error' && <><AlertTriangle size={11} /> DEPLOY PREFLIGHT: UNKNOWN</>}
                  </div>
                  {deployPreflight.reasons.length > 0 && (
                    <ul className="list-disc list-inside space-y-0.5">
                      {deployPreflight.reasons.map(reason => <li key={reason}>{reason}</li>)}
                    </ul>
                  )}
                </div>
              )}

              {/* Launch Action */}
              <button
                type="submit"
                disabled={isWorking || (fleetMode === 'provider' && (providerState === 'checking' || deployPreflight.status !== 'ready'))}
                className="btn-w95 btn-w95-primary w-full py-2 text-xs flex items-center justify-center gap-1.5 font-bold shadow"
              >
                <Play size={13} /> {isWorking ? 'Working…' : fleetMode === 'provider' ? 'Launch Isolated Provider Instance' : 'Launch Demo Plan (Simulation)'}
              </button>
            </form>
          </div>

          {/* Fleet Statistics */}
          <div className="bg-white border-2 border-gray-800 p-2.5 rounded shadow-sm text-[11px] space-y-1.5">
            <div className="font-bold text-gray-800 flex items-center justify-between border-b pb-1">
              <span className="flex items-center gap-1">
                <Activity size={12} className="text-blue-700" /> Control Plane Metrics
              </span>
              <span className="text-[10px] font-mono text-gray-500">
                {summary.totalInstances} instance{summary.totalInstances !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center pt-1 font-mono">
              <div className="bg-gray-50 p-1.5 rounded border border-gray-200">
                <div className="text-gray-500 text-[9px]">ACTIVE MEMORY</div>
                <div className="font-bold text-gray-800">{summary.fleetStats.totalUsedMb} MB</div>
              </div>
              <div className="bg-gray-50 p-1.5 rounded border border-gray-200">
                <div className="text-gray-500 text-[9px]">TOTAL CAP</div>
                <div className="font-bold text-gray-800">{summary.fleetStats.totalCapMb} MB</div>
              </div>
              <div className="bg-gray-50 p-1.5 rounded border border-gray-200">
                <div className="text-gray-500 text-[9px]">ACTIVE PORTS</div>
                <div className="font-bold text-blue-700">{summary.activePorts.length} / 10</div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Instances List & Detail HUD */}
        <div className="lg:col-span-7 flex flex-col gap-3">
          {instances.length === 0 ? (
            /* Empty First-Run State */
            <div className="bg-white border-2 border-gray-800 p-8 rounded shadow-sm text-center flex flex-col items-center justify-center h-full min-h-[360px]">
              <div className="w-14 h-14 bg-blue-50 border-2 border-blue-200 rounded-full flex items-center justify-center text-blue-700 mb-3">
                <Server size={28} />
              </div>
              <h3 className="font-bold text-sm text-gray-900 mb-1">No Active RIG Instances</h3>
              <p className="text-gray-600 text-xs max-w-md mb-4">
                {fleetMode === 'provider'
                  ? user
                    ? 'Your live provider fleet is empty. Supply an immutable image digest and launch an isolated instance; the gateway owns its real lifecycle and cleanup.'
                    : 'The production provider is ready. Sign in, then supply an immutable image digest to launch your first isolated instance.'
                  : 'The offline simulator is empty. Configure a manifest and launch a demo plan to inspect lifecycle rules without executing commands or creating a container.'}
              </p>
              <div className="bg-gray-50 border border-gray-300 p-3 rounded text-left text-xs max-w-md space-y-1.5">
                <div className="font-bold text-gray-800 flex items-center gap-1">
                  <ShieldCheck size={13} className="text-green-600" /> Truthful Guarantees:
                </div>
                <ul className="list-disc list-inside text-[11px] text-gray-600 space-y-0.5">
                  <li>Zero hardcoded or fabricated initial fleet containers</li>
                  <li>Runtime &amp; storage agnostic (stateless, SQLite, or generic volumes)</li>
                  <li>Deterministic 9-state lifecycle machine with legal transitions</li>
                  <li>{fleetMode === 'provider' ? 'Gateway observations only; no browser-fabricated health state' : 'Simulation events stay explicitly separate from provider evidence'}</li>
                </ul>
              </div>
            </div>
          ) : (
            /* Active Instances & Detail View */
            <div className="flex flex-col gap-3 h-full">
              {/* Instance Selector Tabs */}
              <div className="flex items-center gap-1 overflow-x-auto bg-gray-200 p-1 rounded border border-gray-400">
                {instances.map(inst => (
                  <button
                    key={inst.spec.id}
                    onClick={() => setSelectedInstanceId(inst.spec.id)}
                    className={`btn-w95 text-xs py-1 px-2.5 flex items-center gap-1.5 whitespace-nowrap ${
                      selectedInstanceId === inst.spec.id ? 'btn-w95-primary' : 'text-black'
                    }`}
                    title={`Owner: @${user?.username || 'guest'}`}
                  >
                    <span>{inst.spec.name}</span>
                    <span className="text-[10px] opacity-75 font-mono">(@{user?.username || 'guest'})</span>
                    {getStatusBadge(inst.observed.lifecycle)}
                  </button>
                ))}
              </div>

              {selectedInstance && (
                <div className="bg-white border-2 border-gray-800 p-3.5 rounded shadow-sm flex flex-col justify-between flex-1 gap-3">
                  {/* Instance Header */}
                  <div>
                    <div className="flex items-center justify-between border-b pb-2 mb-2.5 flex-wrap gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-gray-900">{selectedInstance.spec.name}</span>
                          <span className="text-[10px] font-mono text-gray-500">({selectedInstance.spec.id})</span>
                          {getStatusBadge(selectedInstance.observed.lifecycle)}
                        </div>
                        <div className="text-[11px] text-gray-500 font-mono mt-0.5">
                          App: {selectedInstance.spec.appId} | Owner: @{user?.username || 'guest'} | Source: {selectedInstance.spec.source} | Adapter: {selectedInstance.spec.runtime.adapter}
                        </div>
                      </div>

                      {/* Status Badges */}
                      <div className="flex items-center gap-1.5 font-mono text-xs">
                        <span className="bg-gray-100 text-gray-800 px-2 py-0.5 rounded border border-gray-300">
                          Port: {selectedInstance.observed.allocatedPort ? (
                            <strong className="text-blue-700">{selectedInstance.observed.allocatedPort}</strong>
                          ) : (
                            <span className="text-gray-500">None (Released)</span>
                          )}
                        </span>
                        <span className="bg-gray-100 text-gray-800 px-2 py-0.5 rounded border border-gray-300">
                          Mem: <strong>{selectedInstance.observed.memoryMb}</strong> / {selectedInstance.spec.resources.memoryCapMb} MB
                        </span>
                      </div>
                    </div>

                    {/* Spec Summary Card */}
                    <div className="grid grid-cols-2 gap-2 bg-gray-50 border border-gray-300 p-2 rounded text-[11px] mb-3">
                      <div>
                        <span className="text-gray-500 font-bold block text-[10px]">COMMANDS</span>
                        <div className="font-mono text-gray-800 truncate">
                          {selectedInstance.spec.runtime.buildCommand && (
                            <div>Build: <code className="bg-gray-200 px-1">{selectedInstance.spec.runtime.buildCommand}</code></div>
                          )}
                          <div>Start: <code className="bg-gray-200 px-1">{selectedInstance.spec.runtime.startCommand}</code></div>
                          {selectedInstance.spec.runtime.healthEndpoint && (
                            <div>Health: <code className="bg-gray-200 px-1">{selectedInstance.spec.runtime.healthEndpoint}</code></div>
                          )}
                        </div>
                      </div>
                      <div>
                        <span className="text-gray-500 font-bold block text-[10px]">STORAGE &amp; TTL</span>
                        <div className="font-mono text-gray-800">
                          {selectedInstance.spec.storage && selectedInstance.spec.storage.length > 0 ? (
                            selectedInstance.spec.storage.map((s, idx) => (
                              <div key={idx} className="truncate">
                                {s.kind}: {s.mountPath} ({s.persistence}{s.sizeMb ? `, ${s.sizeMb}MB` : ''})
                              </div>
                            ))
                          ) : (
                            <div className="text-gray-500">Stateless (No volume mounted)</div>
                          )}
                          <div>TTL: {formatDuration(selectedInstance.spec.ttlSeconds)}</div>
                        </div>
                      </div>
                    </div>

                    {/* Interactive Control-Plane Actions */}
                    <div className="space-y-1 mb-3">
                      <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide block">
                        {fleetMode === 'provider' ? 'Authenticated Provider Actions' : 'Deterministic Simulation Actions'}
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {/* Progressive State Advancers */}
                        {fleetMode === 'simulation' && selectedInstance.observed.lifecycle === 'queued' && (
                          <button
                            onClick={() => handleStepTransition(selectedInstance.spec.id, 'building', 'Simulated build phase; no command executed')}
                            className="btn-w95 text-xs py-1 px-2.5 flex items-center gap-1 font-bold"
                          >
                            <Play size={11} /> Step &rarr; Building
                          </button>
                        )}
                        {fleetMode === 'simulation' && selectedInstance.observed.lifecycle === 'building' && (
                          <button
                            onClick={() => handleStepTransition(selectedInstance.spec.id, 'starting', 'Simulated start phase; no process started')}
                            className="btn-w95 text-xs py-1 px-2.5 flex items-center gap-1 font-bold"
                          >
                            <Play size={11} /> Step &rarr; Starting
                          </button>
                        )}
                        {fleetMode === 'simulation' && selectedInstance.observed.lifecycle === 'starting' && (
                          <button
                            onClick={() => handleStepTransition(selectedInstance.spec.id, 'healthy', 'Simulated healthy observation; no probe executed')}
                            className="btn-w95 text-xs py-1 px-2.5 flex items-center gap-1 font-bold text-green-700"
                          >
                            <Play size={11} /> Step &rarr; Healthy
                          </button>
                        )}

                        {/* Standard Lifecycle Actions */}
                        <button
                          onClick={() => handleRestart(selectedInstance.spec.id)}
                          disabled={isWorking}
                          className="btn-w95 text-xs py-1 px-2 flex items-center gap-1"
                        >
                          <RotateCcw size={11} /> Restart
                        </button>
                        <button
                          onClick={() => handleStop(selectedInstance.spec.id)}
                          disabled={isWorking || selectedInstance.observed.lifecycle === 'stopped'}
                          className="btn-w95 text-xs py-1 px-2 flex items-center gap-1 disabled:opacity-50"
                        >
                          <Square size={11} /> Stop
                        </button>

                        {/* Fault Injection Simulation Controls */}
                        {fleetMode === 'simulation' && <>
                        <button
                          onClick={() => handleSimulateOOM(selectedInstance.spec.id)}
                          disabled={selectedInstance.observed.lifecycle === 'stopped' || selectedInstance.observed.lifecycle === 'oom'}
                          className="btn-w95 text-xs py-1 px-2 flex items-center gap-1 text-rose-700 disabled:opacity-50"
                          title="Simulate memory allocation beyond cap to observe honest OOM state and port release"
                        >
                          <Flame size={11} /> Simulate OOM
                        </button>
                        <button
                          onClick={() => handleSimulateCrash(selectedInstance.spec.id)}
                          disabled={selectedInstance.observed.lifecycle === 'stopped' || selectedInstance.observed.lifecycle === 'crashed'}
                          className="btn-w95 text-xs py-1 px-2 flex items-center gap-1 text-red-700 disabled:opacity-50"
                          title="Simulate sudden process crash"
                        >
                          <Zap size={11} /> Simulate Crash
                        </button>
                        <button
                          onClick={() => handleSimulateExpiry(selectedInstance.spec.id)}
                          disabled={selectedInstance.observed.lifecycle === 'expired' || selectedInstance.observed.lifecycle === 'stopped'}
                          className="btn-w95 text-xs py-1 px-2 flex items-center gap-1 text-gray-700 disabled:opacity-50"
                          title="Simulate TTL timeout and resource reclamation"
                        >
                          <Clock size={11} /> Simulate Expiry
                        </button>
                        </>}
                        {fleetMode === 'provider' && (
                          <button
                            onClick={async () => {
                              setIsWorking(true);
                              setFormError(null);
                              try { setLiveLogs(await getRigInstanceLogs(selectedInstance.spec.id)); }
                              catch (error: any) { setFormError(error.message); }
                              finally { setIsWorking(false); }
                            }}
                            disabled={isWorking}
                            className="btn-w95 text-xs py-1 px-2 flex items-center gap-1"
                          >
                            <Activity size={11} /> Fetch Bounded Logs
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(selectedInstance.spec.id)}
                          disabled={isWorking}
                          className="btn-w95 text-xs py-1 px-2 flex items-center gap-1 text-red-800 ml-auto"
                        >
                          <Trash2 size={11} /> Destroy
                        </button>
                      </div>
                    </div>

                    {fleetMode === 'provider' && liveLogs !== null && (
                      <div className="mb-3 rounded border border-gray-700 bg-black p-2.5 font-mono text-[11px] text-green-300 max-h-[180px] overflow-auto whitespace-pre-wrap select-text">
                        <div className="text-gray-400 border-b border-gray-800 pb-1 mb-1 text-[10px]">BOUNDED PROVIDER LOGS · MAX 200 LINES</div>
                        {liveLogs || '[No log output returned]'}
                      </div>
                    )}

                    {/* Chronological Event Timeline */}
                    <div className="bg-black text-green-400 p-2.5 rounded border border-gray-700 font-mono text-[11px] space-y-1 max-h-[220px] overflow-y-auto">
                      <div className="text-gray-400 border-b border-gray-800 pb-1 mb-1 text-[10px] flex items-center justify-between">
                        <span>LIFECYCLE &amp; CONTROL AUDIT TIMELINE</span>
                        <span>{selectedInstance.observed.events.length} event{selectedInstance.observed.events.length !== 1 ? 's' : ''}</span>
                      </div>
                      {selectedInstance.observed.events.map((evt, idx) => (
                        <div key={idx} className="leading-tight flex items-start gap-1.5">
                          <span className="text-gray-500 shrink-0">
                            [{new Date(evt.timestamp).toLocaleTimeString()}]
                          </span>
                          <span className="text-yellow-300 font-bold shrink-0">
                            [{evt.toState.toUpperCase()}]
                          </span>
                          <span className="text-green-300">
                            {evt.reason || `Transitioned to ${evt.toState}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Footer status summary */}
                  <div className="pt-2 border-t border-gray-300 flex items-center justify-between text-[10px] text-gray-600">
                    <span>
                      Created: {new Date(selectedInstance.spec.createdAt).toLocaleTimeString()}
                    </span>
                    <span>
                      Expires: {selectedInstance.observed.expiresAt ? new Date(selectedInstance.observed.expiresAt).toLocaleTimeString() : 'N/A'}
                    </span>
                    <span className="font-mono font-bold text-gray-800">
                      Truth Source: {selectedInstance.spec.source}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
