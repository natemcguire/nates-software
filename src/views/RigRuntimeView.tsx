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

export const RigRuntimeView: React.FC = () => {
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
  const [storageKind, setStorageKind] = useState<RigStorageKind | 'none'>('sqlite');
  const [storagePath, setStoragePath] = useState('/data/app.sqlite');
  const [storagePersistence, setStoragePersistence] = useState<RigStoragePersistence>('persistent');
  const [storageSizeMb, setStorageSizeMb] = useState<number>(64);
  const [memoryCapMb, setMemoryCapMb] = useState<number>(256);
  const [ttlSeconds, setTtlSeconds] = useState<number>(900); // 15m default
  const [autoProgress, setAutoProgress] = useState<boolean>(true);
  const [formError, setFormError] = useState<string | null>(null);

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

  useEffect(() => {
    refreshState();
    return () => {
      timersRef.current.forEach(t => clearTimeout(t));
      timersRef.current = [];
    };
  }, []);

  const handleLaunchPlan = (e: React.FormEvent) => {
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
                mountPath: storagePath.trim() || `/data/${cleanAppId}.sqlite`,
                sizeMb: storageSizeMb,
                persistence: storagePersistence
              }
            ]
          : undefined;

      const newSpec: RigSpec = {
        id: specId,
        appId: cleanAppId,
        name: appName.trim() || cleanAppId,
        runtime: {
          adapter,
          buildCommand: buildCommand.trim() || undefined,
          startCommand: startCommand.trim(),
          healthEndpoint: healthEndpoint.trim() || undefined
        },
        resources: {
          memoryCapMb,
          cpuCores: 1
        },
        storage: storageMounts,
        ttlSeconds,
        source: 'demo',
        createdAt: new Date().toISOString()
      };

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

  const handleStop = (id: string) => {
    try {
      controlPlaneRef.current.stopInstance(id, 'Simulated stop by operator');
      refreshState();
    } catch (err: any) {
      alert(`Stop error: ${err.message}`);
    }
  };

  const handleRestart = (id: string) => {
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

  const handleDelete = (id: string) => {
    controlPlaneRef.current.deleteInstance(id);
    refreshState();
  };

  const summary = controlPlaneRef.current.getStatusSummary();
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
        <div className="flex items-center gap-2">
          <Cpu size={16} className="text-cyan-400" />
          <span className="font-bold text-sm text-cyan-300 font-mono">RIG.EXE CONTROL-PLANE PREVIEW</span>
          <span className="bg-blue-950 text-cyan-200 text-[10px] font-bold px-2 py-0.5 rounded border border-cyan-600 font-mono">
            RUNTIME &amp; STORAGE AGNOSTIC
          </span>
        </div>

        {/* Boundary Indicator */}
        <div className="flex items-center gap-2">
          <span className="bg-amber-950/80 text-amber-300 border border-amber-500/80 px-2 py-0.5 rounded text-[10px] font-mono flex items-center gap-1">
            <AlertTriangle size={11} className="text-amber-400" />
            PROVIDER STATUS: DISCONNECTED (SIMULATION ONLY)
          </span>
        </div>
      </div>

      {/* Honest Boundary Notice Banner */}
      <div className="bg-amber-50 border-b border-amber-300 px-3 py-1.5 text-[11px] text-amber-900 flex items-center justify-between flex-wrap gap-1">
        <div className="flex items-center gap-1.5">
          <Info size={13} className="text-amber-700 shrink-0" />
          <span>
            <strong>Deterministic State Machine Preview:</strong> No external cloud provider or live container daemon is attached. Specs, state transitions, port allocations, and resource limits run in local simulation.
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
                source: demo
              </span>
            </div>

            <form onSubmit={handleLaunchPlan} className="space-y-2.5">
              {formError && (
                <div className="p-2 bg-red-50 border border-red-400 text-red-700 text-xs rounded">
                  {formError}
                </div>
              )}

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
                  <option value="process">Direct Process (process)</option>
                  <option value="wasm">WebAssembly Sandbox (wasm)</option>
                  <option value="custom">Custom Adapter (custom)</option>
                  <option value="simulation">Local Simulation (simulation)</option>
                </select>
              </div>

              {/* Build and Start Commands */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-gray-700 mb-0.5">Build Command (Optional)</label>
                  <input
                    type="text"
                    value={buildCommand}
                    onChange={e => setBuildCommand(e.target.value)}
                    className="w-full p-1.5 border border-gray-400 font-mono text-xs rounded bg-white"
                    placeholder="e.g. npm run build"
                  />
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
                        placeholder="/data/app.sqlite"
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
                        max="4096"
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
                    <option value="512">512 MB</option>
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
              <div className="flex items-center gap-2 pt-1">
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
              </div>

              {/* Launch Action */}
              <button
                type="submit"
                className="btn-w95 btn-w95-primary w-full py-2 text-xs flex items-center justify-center gap-1.5 font-bold shadow"
              >
                <Play size={13} /> Launch Demo Plan (Simulation)
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
                The control plane is currently empty. Configure a runtime manifest on the left and click <strong>Launch Demo Plan</strong> to observe lifecycle transitions, port allocation, and resource governance in a deterministic simulation.
              </p>
              <div className="bg-gray-50 border border-gray-300 p-3 rounded text-left text-xs max-w-md space-y-1.5">
                <div className="font-bold text-gray-800 flex items-center gap-1">
                  <ShieldCheck size={13} className="text-green-600" /> Truthful Guarantees:
                </div>
                <ul className="list-disc list-inside text-[11px] text-gray-600 space-y-0.5">
                  <li>Zero hardcoded or fabricated initial fleet containers</li>
                  <li>Runtime &amp; storage agnostic (stateless, SQLite, or generic volumes)</li>
                  <li>Deterministic 9-state lifecycle machine with legal transitions</li>
                  <li>Safe port allocation &amp; automatic release on stop/expiry</li>
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
                  >
                    <span>{inst.spec.name}</span>
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
                          App: {selectedInstance.spec.appId} | Source: {selectedInstance.spec.source} | Adapter: {selectedInstance.spec.runtime.adapter}
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
                        Deterministic Control Actions
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {/* Progressive State Advancers */}
                        {selectedInstance.observed.lifecycle === 'queued' && (
                          <button
                            onClick={() => handleStepTransition(selectedInstance.spec.id, 'building', 'Simulated build phase; no command executed')}
                            className="btn-w95 text-xs py-1 px-2.5 flex items-center gap-1 font-bold"
                          >
                            <Play size={11} /> Step &rarr; Building
                          </button>
                        )}
                        {selectedInstance.observed.lifecycle === 'building' && (
                          <button
                            onClick={() => handleStepTransition(selectedInstance.spec.id, 'starting', 'Simulated start phase; no process started')}
                            className="btn-w95 text-xs py-1 px-2.5 flex items-center gap-1 font-bold"
                          >
                            <Play size={11} /> Step &rarr; Starting
                          </button>
                        )}
                        {selectedInstance.observed.lifecycle === 'starting' && (
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
                          className="btn-w95 text-xs py-1 px-2 flex items-center gap-1"
                        >
                          <RotateCcw size={11} /> Restart
                        </button>
                        <button
                          onClick={() => handleStop(selectedInstance.spec.id)}
                          disabled={selectedInstance.observed.lifecycle === 'stopped'}
                          className="btn-w95 text-xs py-1 px-2 flex items-center gap-1 disabled:opacity-50"
                        >
                          <Square size={11} /> Stop
                        </button>

                        {/* Fault Injection Simulation Controls */}
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
                        <button
                          onClick={() => handleDelete(selectedInstance.spec.id)}
                          className="btn-w95 text-xs py-1 px-2 flex items-center gap-1 text-red-800 ml-auto"
                        >
                          <Trash2 size={11} /> Destroy
                        </button>
                      </div>
                    </div>

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
