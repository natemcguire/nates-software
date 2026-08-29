// Durable Forge Outbox Dispatcher & Discrepancy Reconciler
// Claims due provisioning/fork events with finite conditional leases,
// enforces exponential backoff and dead-lettering, coordinates authenticated
// callbacks to /api/git, and reconciles Git bare state with D1 projections.

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import type {
  GatewayConfig,
  OutboxEventRecord,
  ProcessOutboxResult,
  ReconciliationIssueRecord,
  ReconciliationSummary
} from './types.ts';
import {
  cloneOrFetchForFork,
  initBareRepo,
  listAuthoritativeRefs,
  resolveRepoPath
} from './gitStorage.ts';
import { validateProductionStartup } from './config.ts';
import { validateGitOid } from '../forgeDomain.ts';

export function calculateBackoffSeconds(
  attempts: number,
  baseSeconds = 2,
  maxSeconds = 300
): number {
  if (!Number.isFinite(attempts) || attempts <= 1) {
    return baseSeconds;
  }
  const calculated = baseSeconds * Math.pow(2, attempts - 1);
  return Math.min(Math.max(calculated, baseSeconds), maxSeconds);
}

export interface DispatcherOptions {
  fetchOverride?: typeof fetch;
  db?: any;
}

export class ForgeOutboxDispatcher {
  public readonly config: GatewayConfig;
  private readonly fetchImpl: typeof fetch;
  private db: any;
  private isPolling = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private processedCount = 0;
  private lastPolledAt: string | null = null;

  constructor(config: GatewayConfig, options?: DispatcherOptions) {
    this.config = config;
    this.fetchImpl = options?.fetchOverride || globalThis.fetch;
    this.db = options?.db || null;
    validateProductionStartup(this.config);
  }

  public setDatabase(db: any): void {
    this.db = db;
  }

  public getStats() {
    return {
      running: this.isPolling,
      processedCount: this.processedCount,
      lastPolledAt: this.lastPolledAt
    };
  }

  /**
   * Claims due outbox events with a finite conditional lease.
   */
  public async claimDueEvents(limit = 10, leaseSeconds?: number): Promise<OutboxEventRecord[]> {
    if (!this.db) {
      const body = await this.postControlPlane({
        action: 'gateway-claim-outbox', limit,
        leaseSeconds: leaseSeconds || this.config.leaseDurationSeconds || 60,
        maxAttempts: this.config.maxAttempts || 5
      });
      return Array.isArray(body.claimed) ? body.claimed : [];
    }

    const lease = leaseSeconds || this.config.leaseDurationSeconds || 60;
    const maxAttempts = this.config.maxAttempts || 5;

    // Fetch candidate un-delivered, un-leased due events
    const candidatesRes = await this.db.prepare(`
      SELECT id, aggregate_type, aggregate_id, event_type, payload,
             attempts, available_at, delivered_at, last_error,
             claim_token, lease_expires_at, created_at
      FROM forge_outbox_events
      WHERE delivered_at IS NULL
        AND dead_lettered_at IS NULL
        AND (available_at IS NULL OR available_at <= CURRENT_TIMESTAMP)
        AND (lease_expires_at IS NULL OR lease_expires_at <= CURRENT_TIMESTAMP)
        AND attempts < ?
        AND event_type IN ('repository.provisioning_requested', 'repository.fork_requested')
      ORDER BY created_at ASC
      LIMIT ?
    `).bind(maxAttempts, limit).all();

    const candidates = candidatesRes.results || [];
    const claimedEvents: OutboxEventRecord[] = [];

    for (const event of candidates) {
      const claimToken = `clm_${crypto.randomUUID().replace(/-/g, '')}`;

      // Conditional atomic update to lock lease
      const updateRes = await this.db.prepare(`
        UPDATE forge_outbox_events
        SET claim_token = ?,
            lease_expires_at = datetime('now', '+' || ? || ' seconds'),
            available_at = datetime('now', '+' || ? || ' seconds'),
            attempts = attempts + 1
        WHERE id = ?
          AND delivered_at IS NULL
          AND dead_lettered_at IS NULL
          AND (lease_expires_at IS NULL OR lease_expires_at <= CURRENT_TIMESTAMP)
      `).bind(claimToken, lease, lease, event.id).run();

      const changes = updateRes?.meta?.changes ?? 0;
      if (changes > 0) {
        claimedEvents.push({
          ...event,
          claim_token: claimToken,
          attempts: Number(event.attempts) + 1
        });
      }
    }

    return claimedEvents;
  }

  /**
   * Releases an event claim on transient failure and sets exponential backoff.
   */
  public async releaseClaimWithBackoff(
    event: OutboxEventRecord,
    errorMessage: string
  ): Promise<void> {
    if (!this.db) {
      await this.postControlPlane({
        action: 'gateway-fail-outbox', eventId: event.id,
        claimToken: event.claim_token, error: errorMessage,
        maxAttempts: this.config.maxAttempts || 5,
        baseBackoffSeconds: this.config.baseBackoffSeconds || 2,
        maxBackoffSeconds: this.config.maxBackoffSeconds || 300
      });
      return;
    }

    const attempts = event.attempts;
    const maxAttempts = this.config.maxAttempts || 5;

    if (attempts >= maxAttempts) {
      // Mark dead-letter
      await this.db.prepare(`
        UPDATE forge_outbox_events
        SET claim_token = NULL,
            lease_expires_at = NULL,
            dead_lettered_at = CURRENT_TIMESTAMP,
            available_at = '9999-12-31 23:59:59',
            last_error = ?
        WHERE id = ? AND claim_token = ?
      `).bind(`Dead-letter: Max attempts reached (${attempts}). Last error: ${errorMessage}`, event.id, event.claim_token).run();

      // Insert reconciliation issue
      try {
        const issueId = `recon_dead_${crypto.randomUUID()}`;
        await this.db.prepare(`
          INSERT INTO forge_reconciliation_issues (
            id, repository_id, issue_type, status, detail, detected_at
          ) VALUES (?, ?, 'git_missing_in_d1', 'open', ?, CURRENT_TIMESTAMP)
        `).bind(
          issueId,
          event.aggregate_id,
          `Outbox event ${event.id} (${event.event_type}) dead-lettered after ${attempts} attempts: ${errorMessage}`
        ).run();
      } catch {}
      return;
    }

    const backoffSec = calculateBackoffSeconds(
      attempts,
      this.config.baseBackoffSeconds || 2,
      this.config.maxBackoffSeconds || 300
    );

    await this.db.prepare(`
      UPDATE forge_outbox_events
      SET claim_token = NULL,
          lease_expires_at = NULL,
          available_at = datetime('now', '+' || ? || ' seconds'),
          last_error = ?
      WHERE id = ? AND claim_token = ?
    `).bind(backoffSec, errorMessage, event.id, event.claim_token).run();
  }

  /**
   * Marks an outbox event as successfully delivered.
   */
  public async markDelivered(event: OutboxEventRecord): Promise<void> {
    if (!this.db) {
      await this.postControlPlane({
        action: 'gateway-complete-outbox', eventId: event.id,
        claimToken: event.claim_token
      });
      return;
    }

    await this.db.prepare(`
      UPDATE forge_outbox_events
      SET delivered_at = CURRENT_TIMESTAMP,
          claim_token = NULL,
          lease_expires_at = NULL,
          last_error = NULL
      WHERE id = ? AND claim_token = ?
    `).bind(event.id, event.claim_token).run();
  }

  /**
   * Processes a claimed outbox event.
   */
  public async processEvent(event: OutboxEventRecord): Promise<ProcessOutboxResult> {
    if (event.delivered_at) {
      return {
        success: true,
        eventId: event.id,
        eventType: event.event_type,
        skipped: true,
        details: 'Event already marked delivered'
      };
    }

    let payload: any;
    try {
      payload = JSON.parse(event.payload);
    } catch (parseErr: any) {
      const err = `Malformed JSON in outbox event payload: ${parseErr.message}`;
      await this.releaseClaimWithBackoff(event, err);
      return { success: false, eventId: event.id, eventType: event.event_type, terminal: true, error: err };
    }

    try {
      // 1. EVENT: repository.provisioning_requested
      if (event.event_type === 'repository.provisioning_requested') {
        const { repositoryId, storageKey, objectFormat = 'sha1', defaultRef = 'refs/heads/main' } = payload;
        if (!storageKey) {
          throw new Error('storageKey is missing from repository.provisioning_requested payload');
        }

        // Provision bare repository on disk
        const initRes = initBareRepo(this.config.reposRoot, {
          storageKey,
          objectFormat,
          defaultRef
        });

        if (!initRes.success) {
          throw new Error(`Disk bare repo initialization failed: ${initRes.error}`);
        }

        // Call control plane /api/git with gateway-confirm-provisioning if repository is in D1
        if (repositoryId) {
          try {
            const url = `${this.config.controlPlaneUrl.replace(/\/$/, '')}/api/git`;
            const callbackRes = await this.fetchImpl(url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.config.gatewayToken}`
              },
              body: JSON.stringify({
                action: 'gateway-confirm-provisioning',
                repositoryId,
                idempotencyKey: `prov_confirm_${event.id}`
              })
            });

            if (!callbackRes.ok) {
              const body = await callbackRes.json().catch(() => null);
              if (body?.error && !body?.idempotent) {
                // If callback returned error, throw to retry
                throw new Error(`Control plane provisioning confirmation failed (${callbackRes.status}): ${body.error}`);
              }
            }
          } catch (cbErr: any) {
            // If callback fails, rethrow to retry
            throw new Error(`Provisioning callback failed: ${cbErr.message}`);
          }
        }

        await this.markDelivered(event);
        this.processedCount++;
        return {
          success: true,
          eventId: event.id,
          eventType: event.event_type,
          details: { repoPath: initRes.repoPath, idempotent: initRes.idempotent }
        };
      }

      // 2. EVENT: repository.fork_requested
      if (event.event_type === 'repository.fork_requested') {
        const {
          childRepositoryId,
          parentRepositoryId,
          parentRefName,
          parentCommitOid,
          childInitialCommitOid,
          lineageRootRepositoryId,
          depth,
          storageKey: childStorageKey,
          defaultRef = parentRefName || 'refs/heads/main'
        } = payload;

        if (!childRepositoryId || !parentRepositoryId) {
          throw new Error('childRepositoryId and parentRepositoryId are required in fork payload');
        }

        if (parentCommitOid !== childInitialCommitOid) {
          throw new Error('childInitialCommitOid must match parentCommitOid');
        }

        const parentOidVal = validateGitOid(parentCommitOid, 'parentCommitOid');
        if (!parentOidVal.valid) {
          throw new Error(parentOidVal.error);
        }

        // Resolve parent storage key from D1 or conventions
        let parentStorageKey = `repositories/${parentRepositoryId}`;
        let parentObjectFormat = 'sha1';
        if (this.db) {
          const parentRow: any = await this.db.prepare(
            'SELECT storage_key AS storageKey, object_format AS objectFormat FROM repositories WHERE id = ?'
          ).bind(parentRepositoryId).first();
          if (parentRow?.storageKey) {
            parentStorageKey = parentRow.storageKey;
            parentObjectFormat = parentRow.objectFormat || 'sha1';
          }
        }

        // Provision child bare repo and transfer parent commit objects on disk
        const diskForkRes = cloneOrFetchForFork(this.config.reposRoot, {
          childRepositoryId,
          childStorageKey,
          parentRepositoryId,
          parentStorageKey,
          parentRefName,
          parentCommitOid,
          childInitialCommitOid,
          lineageRootRepositoryId,
          depth,
          idempotencyKey: `fork_claim_${event.id}`,
          defaultRef,
          objectFormat: parentObjectFormat as any
        });

        if (!diskForkRes.success && !diskForkRes.idempotent) {
          throw new Error(`Fork object transfer failed on disk: ${diskForkRes.error}`);
        }

        // Call control plane /api/git action gateway-confirm-fork
        const url = `${this.config.controlPlaneUrl.replace(/\/$/, '')}/api/git`;
        const confirmRes = await this.fetchImpl(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.gatewayToken}`
          },
          body: JSON.stringify({
            action: 'gateway-confirm-fork',
            childRepositoryId,
            parentRepositoryId,
            parentRefName,
            parentCommitOid,
            childInitialCommitOid,
            idempotencyKey: `idemp_confirm_fork_${event.id}`,
            actorUserId: payload.forkedByUserId || null
          })
        });

        if (!confirmRes.ok) {
          const body = await confirmRes.json().catch(() => null);
          const errorMsg = body?.error || `HTTP ${confirmRes.status}`;
          // If conflict is due to non-idempotent conflict, fail closed
          if (confirmRes.status === 409 && !body?.idempotent) {
            throw new Error(`Control plane rejected fork confirmation (409 Conflict): ${errorMsg}`);
          }
          throw new Error(`Control plane fork confirmation failed (${confirmRes.status}): ${errorMsg}`);
        }

        await this.markDelivered(event);
        this.processedCount++;
        return {
          success: true,
          eventId: event.id,
          eventType: event.event_type,
          details: { childRepoPath: diskForkRes.childRepoPath, idempotent: diskForkRes.idempotent }
        };
      }

      throw new Error(`Unsupported work event type: ${event.event_type}`);
    } catch (processErr: any) {
      const err = processErr?.message || 'Unknown dispatcher execution error';
      await this.releaseClaimWithBackoff(event, err);
      return {
        success: false,
        eventId: event.id,
        eventType: event.event_type,
        retryable: true,
        error: err
      };
    }
  }

  /**
   * Processes a single batch of due outbox events.
   */
  public async dispatchBatch(limit = 10): Promise<{ claimed: number; results: ProcessOutboxResult[] }> {
    this.lastPolledAt = new Date().toISOString();
    const claimed = await this.claimDueEvents(limit);
    const results: ProcessOutboxResult[] = [];

    for (const event of claimed) {
      const res = await this.processEvent(event);
      results.push(res);
    }

    return {
      claimed: claimed.length,
      results
    };
  }

  /**
   * Scans disk repositories and D1 projections to detect and record reconciliation issues.
   */
  public async reconcileDiscrepancies(): Promise<ReconciliationSummary> {
    if (!this.db) {
      throw new Error('Database is required for reconciliation.');
    }

    const reposRes = await this.db.prepare(`
      SELECT id, slug, storage_key AS storageKey, status, object_format AS objectFormat, default_ref AS defaultRef
      FROM repositories
      WHERE status IN ('active', 'provisioning')
    `).all();

    const repos = reposRes.results || [];
    const openIssues: ReconciliationIssueRecord[] = [];
    let resolvedCount = 0;

    for (const repo of repos) {
      const repoId = String(repo.id);
      const storageKey = String(repo.storageKey);

      // Check if disk path exists
      const pathRes = resolveRepoPath(this.config.reposRoot, storageKey);
      if (!pathRes.valid || !pathRes.resolvedPath) {
        continue;
      }

      const repoPath = pathRes.resolvedPath;

      // 1. Issue: artifact_missing (Repo active in D1, but directory missing on disk)
      if (repo.status === 'active' && !fs.existsSync(repoPath)) {
        const issueId = `recon_miss_${crypto.randomUUID()}`;
        await this.db.prepare(`
          INSERT INTO forge_reconciliation_issues (
            id, repository_id, issue_type, status, detail, detected_at
          ) VALUES (?, ?, 'artifact_missing', 'open', ?, CURRENT_TIMESTAMP)
        `).bind(issueId, repoId, `Bare repository directory missing on disk at '${repoPath}'`).run();

        openIssues.push({
          id: issueId,
          repository_id: repoId,
          issue_type: 'artifact_missing',
          status: 'open',
          detail: `Bare repository directory missing on disk at '${repoPath}'`,
          detected_at: new Date().toISOString()
        });
        continue;
      }

      if (!fs.existsSync(repoPath)) continue;

      // Compare refs between disk and D1
      const diskRefs = listAuthoritativeRefs(this.config.reposRoot, storageKey);
      const diskRefMap = new Map<string, string>();
      for (const dr of diskRefs) {
        diskRefMap.set(dr.refName, dr.commitOid);
      }

      const d1RefsRes = await this.db.prepare(`
        SELECT ref_name AS refName, commit_oid AS commitOid
        FROM repository_refs WHERE repository_id = ?
      `).bind(repoId).all();

      const d1Refs = d1RefsRes.results || [];
      const d1RefMap = new Map<string, string>();
      for (const d1r of d1Refs) {
        d1RefMap.set((d1r as any).refName, (d1r as any).commitOid);
      }

      // Check disk refs missing in D1 or OID mismatch
      for (const [refName, diskOid] of diskRefMap.entries()) {
        const d1Oid = d1RefMap.get(refName);

        if (!d1Oid) {
          // git_missing_in_d1: Git has ref, D1 projection does not
          const issueId = `recon_gmid_${crypto.randomUUID()}`;
          await this.db.prepare(`
            INSERT INTO forge_reconciliation_issues (
              id, repository_id, ref_name, issue_type, git_oid, d1_oid, status, detail, detected_at
            ) VALUES (?, ?, ?, 'git_missing_in_d1', ?, NULL, 'open', ?, CURRENT_TIMESTAMP)
          `).bind(
            issueId, repoId, refName, diskOid,
            `Authoritative Git ref '${refName}' (${diskOid}) is missing in D1 projection.`
          ).run();

          openIssues.push({
            id: issueId,
            repository_id: repoId,
            ref_name: refName,
            issue_type: 'git_missing_in_d1',
            git_oid: diskOid,
            d1_oid: null,
            status: 'open',
            detail: `Authoritative Git ref '${refName}' (${diskOid}) is missing in D1 projection.`,
            detected_at: new Date().toISOString()
          });
        } else if (d1Oid !== diskOid) {
          // oid_mismatch: Git OID differs from D1 projection OID
          const issueId = `recon_mismatch_${crypto.randomUUID()}`;
          await this.db.prepare(`
            INSERT INTO forge_reconciliation_issues (
              id, repository_id, ref_name, issue_type, git_oid, d1_oid, status, detail, detected_at
            ) VALUES (?, ?, ?, 'oid_mismatch', ?, ?, 'open', ?, CURRENT_TIMESTAMP)
          `).bind(
            issueId, repoId, refName, diskOid, d1Oid,
            `Authoritative Git OID (${diskOid}) differs from D1 projection OID (${d1Oid}) on ref '${refName}'.`
          ).run();

          openIssues.push({
            id: issueId,
            repository_id: repoId,
            ref_name: refName,
            issue_type: 'oid_mismatch',
            git_oid: diskOid,
            d1_oid: d1Oid,
            status: 'open',
            detail: `Authoritative Git OID (${diskOid}) differs from D1 projection OID (${d1Oid}) on ref '${refName}'.`,
            detected_at: new Date().toISOString()
          });
        }
      }

      // Check D1 refs missing in Git
      for (const [refName, d1Oid] of d1RefMap.entries()) {
        if (!diskRefMap.has(refName)) {
          const issueId = `recon_dmig_${crypto.randomUUID()}`;
          await this.db.prepare(`
            INSERT INTO forge_reconciliation_issues (
              id, repository_id, ref_name, issue_type, git_oid, d1_oid, status, detail, detected_at
            ) VALUES (?, ?, ?, 'd1_missing_in_git', NULL, ?, 'open', ?, CURRENT_TIMESTAMP)
          `).bind(
            issueId, repoId, refName, d1Oid,
            `D1 ref '${refName}' (${d1Oid}) is missing from authoritative Git repository.`
          ).run();

          openIssues.push({
            id: issueId,
            repository_id: repoId,
            ref_name: refName,
            issue_type: 'd1_missing_in_git',
            git_oid: null,
            d1_oid: d1Oid,
            status: 'open',
            detail: `D1 ref '${refName}' (${d1Oid}) is missing from authoritative Git repository.`,
            detected_at: new Date().toISOString()
          });
        }
      }
    }

    return {
      scannedRepositories: repos.length,
      openIssuesFound: openIssues.length,
      resolvedCount,
      issues: openIssues
    };
  }

  /**
   * Starts periodic polling in background.
   */
  public startPolling(intervalMs?: number): void {
    if (this.isPolling) return;
    this.isPolling = true;

    const interval = intervalMs || this.config.pollIntervalMs || 1000;
    const pollLoop = async () => {
      if (!this.isPolling) return;
      try {
        await this.dispatchBatch(10);
      } catch {}
      if (this.isPolling) {
        this.pollTimer = setTimeout(pollLoop, interval);
      }
    };

    this.pollTimer = setTimeout(pollLoop, 0);
  }

  /**
   * Stops periodic polling.
   */
  public stopPolling(): void {
    this.isPolling = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async postControlPlane(payload: Record<string, unknown>): Promise<any> {
    const response = await this.fetchImpl(`${this.config.controlPlaneUrl.replace(/\/$/, '')}/api/git`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.gatewayToken}`
      },
      body: JSON.stringify(payload)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.success === false) {
      throw new Error(body?.error || `Control plane returned HTTP ${response.status}`);
    }
    return body;
  }
}
