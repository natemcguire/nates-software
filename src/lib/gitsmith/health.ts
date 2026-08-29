// Health and Readiness Check System for GITSMITH Gateway
// Truthfully distinguishes between 'configured' and 'active' state.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { GatewayConfig, GatewayHealthStatus, GatewayReadinessStatus } from './types.ts';
import { checkGitCapabilities } from './gitStorage.ts';
import { ForgeOutboxDispatcher } from './outboxDispatcher.ts';

export class GatewayHealthChecker {
  private readonly startTime = Date.now();

  public getHealth(): GatewayHealthStatus {
    const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);
    return {
      status: 'ok',
      uptimeSeconds,
      timestamp: new Date().toISOString()
    };
  }

  public async getReadiness(
    config: GatewayConfig,
    dispatcher?: ForgeOutboxDispatcher | null,
    probeControlPlane = false,
    fetchOverride?: typeof fetch
  ): Promise<GatewayReadinessStatus> {
    const fetchImpl = fetchOverride || globalThis.fetch;

    // 1. Probe Git binary capabilities
    const gitCaps = checkGitCapabilities();

    // 2. Probe Storage configuration and filesystem writability
    let storageConfigured = false;
    let storageExists = false;
    let storageWritable = false;
    let storageError: string | undefined;

    if (config.reposRoot && typeof config.reposRoot === 'string' && config.reposRoot.trim()) {
      storageConfigured = true;
      const cleanRoot = path.resolve(config.reposRoot.trim());
      try {
        storageExists = fs.existsSync(cleanRoot);
        if (storageExists) {
          fs.accessSync(cleanRoot, fs.constants.W_OK | fs.constants.R_OK);
          storageWritable = true;
        }
      } catch (err: any) {
        storageError = `Storage root not writable: ${err.message}`;
      }
    } else {
      storageError = 'reposRoot is not configured.';
    }

    // 3. Probe Control Plane configuration and connectivity
    let cpConfigured = false;
    let cpReachable = false;
    let cpError: string | undefined;

    if (config.controlPlaneUrl && config.gatewayToken) {
      cpConfigured = true;
      try {
        const url = new URL(config.controlPlaneUrl.trim());
        if (url.protocol === 'http:' || url.protocol === 'https:') {
          if (probeControlPlane) {
            try {
              const pingUrl = `${config.controlPlaneUrl.replace(/\/$/, '')}/api/git`;
              const res = await fetchImpl(pingUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.gatewayToken}` },
                body: JSON.stringify({ action: 'gateway-status' })
              });
              const body = await res.json().catch(() => ({}));
              cpReachable = res.ok && body?.success === true;
              if (!cpReachable) cpError = body?.error || `Control plane returned HTTP ${res.status}`;
            } catch (err: any) {
              cpError = `Control plane network probe failed: ${err.message}`;
            }
          }
        } else {
          cpError = 'controlPlaneUrl must use http or https.';
        }
      } catch (err: any) {
        cpError = `Invalid controlPlaneUrl: ${err.message}`;
      }
    } else {
      cpError = 'controlPlaneUrl or gatewayToken is not configured.';
    }

    // 4. Probe Dispatcher stats
    const dispatcherStats = dispatcher ? dispatcher.getStats() : { running: false, processedCount: 0, lastPolledAt: null };

    // Truthful distinction between configured and active
    const isConfigured = storageConfigured && cpConfigured && Boolean(config.gatewayToken);
    const isActive =
      isConfigured &&
      gitCaps.gitAvailable &&
      storageWritable &&
      cpReachable &&
      dispatcherStats.running;

    const isReady = isConfigured && isActive;

    return {
      ready: isReady,
      configured: isConfigured,
      active: isActive,
      checks: {
        git: {
          available: gitCaps.gitAvailable,
          version: gitCaps.gitVersion,
          supportsSha1: gitCaps.supportsSha1,
          supportsSha256: gitCaps.supportsSha256,
          error: gitCaps.error
        },
        storage: {
          configured: storageConfigured,
          root: config.reposRoot,
          exists: storageExists,
          writable: storageWritable,
          error: storageError
        },
        controlPlane: {
          configured: cpConfigured,
          url: config.controlPlaneUrl,
          reachable: cpReachable,
          error: cpError
        },
        dispatcher: {
          running: dispatcherStats.running,
          processedCount: dispatcherStats.processedCount,
          lastPolledAt: dispatcherStats.lastPolledAt || undefined
        }
      },
      timestamp: new Date().toISOString()
    };
  }
}
