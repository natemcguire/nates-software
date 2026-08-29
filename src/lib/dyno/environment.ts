// Local Environment Detection for DYNO benchmark runner
// Captures host machine, OS, CPU, memory, and runtime manifest deterministically.

import { platform, release, arch, cpus, totalmem } from 'node:os';
import { DynoEnvironmentRecord, DynoNetworkPolicy } from './types';
import { sha256Json } from './crypto';

export function detectLocalEnvironment(networkPolicy: DynoNetworkPolicy = 'none'): DynoEnvironmentRecord {
  const osName = platform();
  const osVersion = release();
  const cpuList = cpus();
  const cpuModel = cpuList.length > 0 ? cpuList[0].model : 'Unknown CPU';
  const memoryBytes = totalmem();
  const architecture = arch();

  const runtimeManifestObj = {
    nodeVersion: process.version,
    platform: osName,
    arch: architecture,
    cpuCount: cpuList.length,
    totalMemoryBytes: memoryBytes
  };

  const runtimeManifest = JSON.stringify(runtimeManifestObj);
  const containerImageDigest = sha256Json({
    type: 'local_workstation',
    os: osName,
    arch: architecture,
    runtime: runtimeManifestObj
  });

  const envId = `env_${osName}_${architecture}_${sha256Json({ cpuModel, memoryBytes }).slice(0, 8)}`;

  return {
    id: envId,
    os_name: osName,
    os_version: osVersion,
    architecture,
    cpu_model: cpuModel,
    accelerator_model: null,
    memory_bytes: memoryBytes,
    container_image_digest: containerImageDigest,
    runtime_manifest: runtimeManifest,
    network_policy: networkPolicy,
    created_at: new Date().toISOString()
  };
}
