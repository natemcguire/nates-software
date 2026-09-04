import * as fs from 'node:fs';
import * as path from 'node:path';
import type { GatewayConfig, GatewayHealthStatus, GatewayReadinessStatus } from './types.ts';
import { checkGitCapabilities } from './gitStorage.ts';
import { ForgeOutboxDispatcher } from './outboxDispatcher.ts';

export class GatewayHealthChecker {
  private readonly startTime = Date.now();
  private transportStatus: GatewayReadinessStatus['checks']['transport'] = {
    protocol: 'ssh', configured: false, active: false, error: 'SSH transport is not configured.'
  };

  public setTransportStatus(status: GatewayReadinessStatus['checks']['transport']): void {
    this.transportStatus = status;
  }

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

    const gitCaps = checkGitCapabilities();

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

    const dispatcherStats = dispatcher ? dispatcher.getStats() : { running: false, processedCount: 0, lastPolledAt: null };

    const transportConfigured = config.sshEnabled === true && Boolean(config.sshHost?.trim());
    const transportActive = transportConfigured && this.transportStatus.active;
    const transportError = transportActive ? undefined : (this.transportStatus.error || 'SSH transport is not active.');

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
        },
        transport: {
          protocol: 'ssh',
          configured: transportConfigured,
          active: transportActive,
          host: this.transportStatus.host || config.sshHost || undefined,
          port: this.transportStatus.port || config.sshPublicPort || config.sshPort,
          error: transportError
        }
      },
      timestamp: new Date().toISOString()
    };
  }
}
