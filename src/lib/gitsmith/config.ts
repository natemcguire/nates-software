// Configuration and Production Startup Validator for GITSMITH Git Gateway

import * as path from 'node:path';
import * as fs from 'node:fs';
import type { GatewayConfig } from './types.ts';

export class ProductionStartupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProductionStartupError';
  }
}

export const DEFAULT_DEV_CONFIG: GatewayConfig = {
  reposRoot: path.resolve(process.cwd(), '.gitsmith-repos'),
  controlPlaneUrl: 'http://localhost:8788',
  gatewayToken: '',
  sshEnabled: false,
  sshHost: '',
  sshPort: 22,
  sshPublicPort: 22,
  productionEnabled: false,
  isProduction: false,
  port: 8789,
  pollIntervalMs: 1000,
  maxAttempts: 5,
  leaseDurationSeconds: 60,
  baseBackoffSeconds: 2,
  maxBackoffSeconds: 300
};

/**
 * Validates production startup invariants. Fails closed if any required parameter is missing.
 * Does not mutate filesystem during validation.
 */
export function validateProductionStartup(config: GatewayConfig): void {
  const isProduction =
    config.isProduction === true ||
    process.env.NODE_ENV === 'production' ||
    config.productionEnabled === true;

  if (!isProduction) {
    return;
  }

  // 1. Explicit production enable flag must be true
  if (config.productionEnabled !== true && process.env.GITSMITH_PRODUCTION_ENABLED !== 'true') {
    throw new ProductionStartupError(
      'Production startup rejected: GITSMITH_PRODUCTION_ENABLED=true must be explicitly configured.'
    );
  }

  // 2. Explicit, valid, non-root reposRoot
  if (!config.reposRoot || typeof config.reposRoot !== 'string' || !config.reposRoot.trim()) {
    throw new ProductionStartupError(
      'Production startup rejected: GITSMITH_REPOS_ROOT must be explicitly configured.'
    );
  }

  const cleanRoot = path.resolve(config.reposRoot.trim());
  if (!path.isAbsolute(cleanRoot)) {
    throw new ProductionStartupError(
      'Production startup rejected: GITSMITH_REPOS_ROOT must be an absolute path.'
    );
  }

  const rootParsed = path.parse(cleanRoot);
  if (cleanRoot === rootParsed.root || cleanRoot === '/tmp' || cleanRoot === '/private/tmp') {
    throw new ProductionStartupError(
      'Production startup rejected: GITSMITH_REPOS_ROOT cannot be system root or raw /tmp directory in production.'
    );
  }

  // Non-mutating check: Verify directory exists and is writable, or parent directory exists and is writable
  try {
    if (fs.existsSync(cleanRoot)) {
      fs.accessSync(cleanRoot, fs.constants.W_OK | fs.constants.R_OK);
    } else {
      const parentDir = path.dirname(cleanRoot);
      if (!fs.existsSync(parentDir)) {
        throw new Error(`Parent directory '${parentDir}' does not exist.`);
      }
      fs.accessSync(parentDir, fs.constants.W_OK | fs.constants.R_OK);
    }
  } catch (err: any) {
    throw new ProductionStartupError(
      `Production startup rejected: GITSMITH_REPOS_ROOT '${cleanRoot}' is not accessible or writable: ${err.message}`
    );
  }

  // 3. Control plane URL must be valid HTTPS URL in production (HTTP rejected)
  if (!config.controlPlaneUrl || typeof config.controlPlaneUrl !== 'string' || !config.controlPlaneUrl.trim()) {
    throw new ProductionStartupError(
      'Production startup rejected: GITSMITH_CONTROL_PLANE_URL must be explicitly configured.'
    );
  }

  try {
    const url = new URL(config.controlPlaneUrl.trim());
    if (url.protocol !== 'https:') {
      throw new Error('GITSMITH_CONTROL_PLANE_URL must use https:// in production mode.');
    }
  } catch (err: any) {
    throw new ProductionStartupError(
      `Production startup rejected: GITSMITH_CONTROL_PLANE_URL '${config.controlPlaneUrl}' is invalid: ${err.message}`
    );
  }

  // 4. Gateway token secret must be non-empty and reasonably secure
  if (!config.gatewayToken || typeof config.gatewayToken !== 'string' || !config.gatewayToken.trim()) {
    throw new ProductionStartupError(
      'Production startup rejected: GITSMITH_GATEWAY_TOKEN secret must be explicitly configured.'
    );
  }

  if (config.gatewayToken.trim().length < 16) {
    throw new ProductionStartupError(
      'Production startup rejected: GITSMITH_GATEWAY_TOKEN must be at least 16 characters long.'
    );
  }

  if (config.sshEnabled === true) {
    if (!config.sshHost?.trim()) {
      throw new ProductionStartupError(
        'Production startup rejected: GITSMITH_SSH_HOST is required when SSH transport is enabled.'
      );
    }
    if (!Number.isInteger(config.sshPort) || Number(config.sshPort) < 1 || Number(config.sshPort) > 65535) {
      throw new ProductionStartupError(
        'Production startup rejected: GITSMITH_SSH_PORT must be an integer between 1 and 65535.'
      );
    }
    if (!Number.isInteger(config.sshPublicPort) || Number(config.sshPublicPort) < 1 || Number(config.sshPublicPort) > 65535) {
      throw new ProductionStartupError(
        'Production startup rejected: GITSMITH_SSH_PUBLIC_PORT must be an integer between 1 and 65535.'
      );
    }
  }
}

/**
 * Validates configuration and returns diagnostic errors.
 */
export function validateGatewayConfig(config: Partial<GatewayConfig>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!config.reposRoot || typeof config.reposRoot !== 'string' || !config.reposRoot.trim()) {
    errors.push('reposRoot is required.');
  } else if (!path.isAbsolute(config.reposRoot.trim())) {
    errors.push('reposRoot must be an absolute path.');
  }

  if (!config.controlPlaneUrl || typeof config.controlPlaneUrl !== 'string' || !config.controlPlaneUrl.trim()) {
    errors.push('controlPlaneUrl is required.');
  } else {
    try {
      const url = new URL(config.controlPlaneUrl.trim());
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        errors.push('controlPlaneUrl must use http:// or https://.');
      }
    } catch {
      errors.push('controlPlaneUrl must be a valid URL.');
    }
  }

  if (!config.gatewayToken || typeof config.gatewayToken !== 'string' || !config.gatewayToken.trim()) {
    errors.push('gatewayToken is required.');
  }

  if (config.sshEnabled === true) {
    if (!config.sshHost?.trim()) errors.push('sshHost is required when SSH transport is enabled.');
    if (!Number.isInteger(config.sshPort) || Number(config.sshPort) < 1 || Number(config.sshPort) > 65535) {
      errors.push('sshPort must be an integer between 1 and 65535 when SSH transport is enabled.');
    }
    if (!Number.isInteger(config.sshPublicPort) || Number(config.sshPublicPort) < 1 || Number(config.sshPublicPort) > 65535) {
      errors.push('sshPublicPort must be an integer between 1 and 65535 when SSH transport is enabled.');
    }
  }

  // Numeric config range validations
  if (config.port !== undefined) {
    if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
      errors.push('port must be an integer between 1 and 65535.');
    }
  }

  if (config.pollIntervalMs !== undefined) {
    if (!Number.isInteger(config.pollIntervalMs) || config.pollIntervalMs < 100 || config.pollIntervalMs > 3600000) {
      errors.push('pollIntervalMs must be an integer between 100 and 3600000.');
    }
  }

  if (config.maxAttempts !== undefined) {
    if (!Number.isInteger(config.maxAttempts) || config.maxAttempts < 1 || config.maxAttempts > 100) {
      errors.push('maxAttempts must be an integer between 1 and 100.');
    }
  }

  if (config.leaseDurationSeconds !== undefined) {
    if (!Number.isInteger(config.leaseDurationSeconds) || config.leaseDurationSeconds < 5 || config.leaseDurationSeconds > 86400) {
      errors.push('leaseDurationSeconds must be an integer between 5 and 86400.');
    }
  }

  if (config.baseBackoffSeconds !== undefined) {
    if (!Number.isInteger(config.baseBackoffSeconds) || config.baseBackoffSeconds < 1 || config.baseBackoffSeconds > 3600) {
      errors.push('baseBackoffSeconds must be an integer between 1 and 3600.');
    }
  }

  if (config.maxBackoffSeconds !== undefined) {
    const minBackoff = config.baseBackoffSeconds || 1;
    if (!Number.isInteger(config.maxBackoffSeconds) || config.maxBackoffSeconds < minBackoff || config.maxBackoffSeconds > 86400) {
      errors.push(`maxBackoffSeconds must be an integer between ${minBackoff} and 86400.`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Loads gateway configuration from environment variables or custom overrides.
 */
export function loadGatewayConfigFromEnv(env: Record<string, string | undefined> = process.env): GatewayConfig {
  const isProd = env.NODE_ENV === 'production' || env.GITSMITH_PRODUCTION_ENABLED === 'true';

  const reposRoot = env.GITSMITH_REPOS_ROOT
    ? path.resolve(env.GITSMITH_REPOS_ROOT.trim())
    : (isProd ? '' : DEFAULT_DEV_CONFIG.reposRoot);

  const controlPlaneUrl = env.GITSMITH_CONTROL_PLANE_URL
    ? env.GITSMITH_CONTROL_PLANE_URL.trim()
    : (isProd ? '' : DEFAULT_DEV_CONFIG.controlPlaneUrl);

  const gatewayToken = env.GITSMITH_GATEWAY_TOKEN?.trim() || '';
  const sshEnabled = env.GITSMITH_SSH_ENABLED === 'true';
  const sshHost = env.GITSMITH_SSH_HOST?.trim() || '';
  const sshPort = env.GITSMITH_SSH_PORT ? parseInt(env.GITSMITH_SSH_PORT, 10) : 22;
  const sshPublicPort = env.GITSMITH_SSH_PUBLIC_PORT ? parseInt(env.GITSMITH_SSH_PUBLIC_PORT, 10) : sshPort;

  const productionEnabled = env.GITSMITH_PRODUCTION_ENABLED === 'true';

  const port = env.GITSMITH_PORT ? parseInt(env.GITSMITH_PORT, 10) : DEFAULT_DEV_CONFIG.port;
  const pollIntervalMs = env.GITSMITH_POLL_INTERVAL_MS ? parseInt(env.GITSMITH_POLL_INTERVAL_MS, 10) : DEFAULT_DEV_CONFIG.pollIntervalMs;
  const maxAttempts = env.GITSMITH_MAX_ATTEMPTS ? parseInt(env.GITSMITH_MAX_ATTEMPTS, 10) : DEFAULT_DEV_CONFIG.maxAttempts;
  const leaseDurationSeconds = env.GITSMITH_LEASE_DURATION_SECONDS ? parseInt(env.GITSMITH_LEASE_DURATION_SECONDS, 10) : DEFAULT_DEV_CONFIG.leaseDurationSeconds;
  const baseBackoffSeconds = env.GITSMITH_BASE_BACKOFF_SECONDS ? parseInt(env.GITSMITH_BASE_BACKOFF_SECONDS, 10) : DEFAULT_DEV_CONFIG.baseBackoffSeconds;
  const maxBackoffSeconds = env.GITSMITH_MAX_BACKOFF_SECONDS ? parseInt(env.GITSMITH_MAX_BACKOFF_SECONDS, 10) : DEFAULT_DEV_CONFIG.maxBackoffSeconds;

  return {
    reposRoot,
    controlPlaneUrl,
    gatewayToken,
    sshEnabled,
    sshHost,
    sshPort: isNaN(sshPort) ? 22 : sshPort,
    sshPublicPort: isNaN(sshPublicPort) ? (isNaN(sshPort) ? 22 : sshPort) : sshPublicPort,
    productionEnabled,
    isProduction: isProd,
    port: isNaN(port!) ? DEFAULT_DEV_CONFIG.port : port,
    pollIntervalMs: isNaN(pollIntervalMs!) ? DEFAULT_DEV_CONFIG.pollIntervalMs : pollIntervalMs,
    maxAttempts: isNaN(maxAttempts!) ? DEFAULT_DEV_CONFIG.maxAttempts : maxAttempts,
    leaseDurationSeconds: isNaN(leaseDurationSeconds!) ? DEFAULT_DEV_CONFIG.leaseDurationSeconds : leaseDurationSeconds,
    baseBackoffSeconds: isNaN(baseBackoffSeconds!) ? DEFAULT_DEV_CONFIG.baseBackoffSeconds : baseBackoffSeconds,
    maxBackoffSeconds: isNaN(maxBackoffSeconds!) ? DEFAULT_DEV_CONFIG.maxBackoffSeconds : maxBackoffSeconds
  };
}
