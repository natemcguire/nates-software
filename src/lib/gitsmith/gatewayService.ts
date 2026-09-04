import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type {
  AuthoritativeRefCasParams,
  AuthoritativeRefCasResult,
  ForkProvisionParams,
  ForkProvisionResult,
  GatewayConfig,
  ProvisionRepoParams,
  ProvisionRepoResult
} from './types.ts';
import {
  cloneOrFetchForFork,
  initBareRepo,
  listAuthoritativeRefs,
  readAuthoritativeRef,
  updateAuthoritativeRefCas
} from './gitStorage.ts';
import { validateProductionStartup } from './config.ts';

export interface GatewayServiceOptions {
  fetchOverride?: typeof fetch;
}

export class GitsmithGatewayService {
  public readonly config: GatewayConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(config: GatewayConfig, options?: GatewayServiceOptions) {
    this.config = config;
    this.fetchImpl = options?.fetchOverride || globalThis.fetch;
    validateProductionStartup(this.config);
  }

  private getReceiptDir(): string {
    return path.join(this.config.reposRoot, '.gitsmith-receipts');
  }

  private getReceiptFilePath(idempotencyKey: string): string {
    const digest = createHash('sha256').update(idempotencyKey, 'utf8').digest('hex');
    return path.join(this.getReceiptDir(), `${digest}.json`);
  }

  private persistCallbackReceipt(payload: any): boolean {
    try {
      const receiptDir = this.getReceiptDir();
      if (!fs.existsSync(receiptDir)) {
        fs.mkdirSync(receiptDir, { recursive: true });
      }
      const targetPath = this.getReceiptFilePath(payload.idempotencyKey);
      const tempPath = `${targetPath}.tmp.${process.pid}.${Date.now()}`;
      const fd = fs.openSync(tempPath, 'wx', 0o600);
      try {
        fs.writeFileSync(fd, JSON.stringify(payload));
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(tempPath, targetPath);
      return true;
    } catch {
      return false;
    }
  }

  private removeCallbackReceipt(idempotencyKey: string): void {
    try {
      const targetPath = this.getReceiptFilePath(idempotencyKey);
      if (fs.existsSync(targetPath)) {
        fs.unlinkSync(targetPath);
      }
    } catch {}
  }

  public getAuthoritativeRef(storageKey: string, refName: string): string | null {
    return readAuthoritativeRef(this.config.reposRoot, storageKey, refName);
  }

  public listAuthoritativeRefs(storageKey: string, prefix?: string): Array<{ refName: string; commitOid: string }> {
    return listAuthoritativeRefs(this.config.reposRoot, storageKey, prefix);
  }

  public async recordAppliedRef(params: {
    repositoryId: string;
    refName: string;
    oldOid: string | null;
    newOid: string | null;
    actorUserId: string;
    idempotencyKey: string;
  }): Promise<{ reconciled: boolean; receiptPersisted?: boolean; error?: string }> {
    const payload = {
      action: 'gateway-record-ref',
      repositoryId: params.repositoryId,
      refName: params.refName,
      oldOid: params.oldOid,
      newOid: params.newOid,
      expectedOldOid: params.oldOid === null ? undefined : params.oldOid,
      operation: params.oldOid === null ? 'create' : (params.newOid === null ? 'delete' : 'update'),
      idempotencyKey: params.idempotencyKey,
      actorUserId: params.actorUserId,
      signatureVerified: false
    };
    try {
      const response = await this.fetchImpl(`${this.config.controlPlaneUrl.replace(/\/$/, '')}/api/git`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.gatewayToken}` },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        const responseBody = await response.json().catch(() => ({}));
        const error = responseBody?.error || `Control plane callback returned status ${response.status}`;
        return { reconciled: false, receiptPersisted: this.persistCallbackReceipt(payload), error };
      }
      this.removeCallbackReceipt(params.idempotencyKey);
      return { reconciled: true };
    } catch (error: any) {
      return {
        reconciled: false,
        receiptPersisted: this.persistCallbackReceipt(payload),
        error: `Control plane unreachable: ${error.message}`
      };
    }
  }

  public provisionRepository(params: ProvisionRepoParams): ProvisionRepoResult {
    return initBareRepo(this.config.reposRoot, params);
  }

  public async updateAuthoritativeRef(
    params: AuthoritativeRefCasParams & { repositoryId?: string }
  ): Promise<AuthoritativeRefCasResult> {
    if (!params.idempotencyKey || typeof params.idempotencyKey !== 'string' || !params.idempotencyKey.trim()) {
      return {
        success: false,
        refName: params.refName,
        oldOid: params.expectedOldOid ?? null,
        newOid: params.newOid,
        currentOid: null,
        error: 'idempotencyKey is required for authoritative ref CAS.'
      };
    }

    const idempotencyKey = params.idempotencyKey.trim();

    const gitCasResult = updateAuthoritativeRefCas(this.config.reposRoot, {
      ...params,
      idempotencyKey
    });
    if (!gitCasResult.success) {
      return gitCasResult;
    }

    const repoId = params.repositoryId || params.storageKey.replace(/^repositories\//, '');

    const payload = {
      action: 'gateway-record-ref',
      repositoryId: repoId,
      refName: params.refName,
      oldOid: params.expectedOldOid,
      newOid: params.newOid,
      expectedOldOid: params.expectedOldOid !== null ? params.expectedOldOid : undefined,
      operation: params.operation || (params.expectedOldOid === null ? 'create' : (params.newOid === null ? 'delete' : 'update')),
      idempotencyKey,
      actorUserId: params.actorUserId || null,
      signatureVerified: Boolean(params.signatureVerified)
    };

    try {
      const url = `${this.config.controlPlaneUrl.replace(/\/$/, '')}/api/git`;
      const res = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.gatewayToken}`
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        let errorMsg = `Control plane callback returned status ${res.status}`;
        try {
          const body = await res.json();
          if (body?.error) errorMsg = body.error;
        } catch {}

        const receiptPersisted = this.persistCallbackReceipt(payload);

        return {
          ...gitCasResult,
          controlPlaneError: errorMsg,
          reconciled: false,
          receiptPersisted
        };
      }

      const body = await res.json();

      this.removeCallbackReceipt(idempotencyKey);

      return {
        ...gitCasResult,
        controlPlaneEventId: body?.eventId,
        reconciled: true,
        idempotent: body?.idempotent
      };
    } catch (err: any) {
      const receiptPersisted = this.persistCallbackReceipt(payload);

      return {
        ...gitCasResult,
        controlPlaneError: `Control plane unreachable: ${err.message}`,
        reconciled: false,
        receiptPersisted
      };
    }
  }

  public async replayPendingCallbacks(): Promise<{ replayed: number; failed: number; errors: string[] }> {
    const receiptDir = this.getReceiptDir();
    if (!fs.existsSync(receiptDir)) {
      return { replayed: 0, failed: 0, errors: [] };
    }

    let files: string[] = [];
    try {
      files = fs.readdirSync(receiptDir).filter(f => f.endsWith('.json') && !f.includes('.tmp.'));
    } catch {
      return { replayed: 0, failed: 0, errors: [] };
    }

    let replayed = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const file of files) {
      const filePath = path.join(receiptDir, file);
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const payload = JSON.parse(content);
        const url = `${this.config.controlPlaneUrl.replace(/\/$/, '')}/api/git`;

        const res = await this.fetchImpl(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.gatewayToken}`
          },
          body: JSON.stringify(payload)
        });

        if (res.ok) {
          try { fs.unlinkSync(filePath); } catch {}
          replayed++;
        } else {
          const body = await res.json().catch(() => null);
          const errMsg = body?.error || `HTTP ${res.status}`;
          if (res.status === 200 || res.status === 201 || body?.idempotent) {
            try { fs.unlinkSync(filePath); } catch {}
            replayed++;
          } else {
            failed++;
            errors.push(`Replay failed for ${file}: ${errMsg}`);
          }
        }
      } catch (err: any) {
        failed++;
        errors.push(`Replay error for ${file}: ${err.message}`);
      }
    }

    return { replayed, failed, errors };
  }

  public async provisionFork(params: ForkProvisionParams): Promise<ForkProvisionResult> {
    const diskResult = cloneOrFetchForFork(this.config.reposRoot, params);
    if (!diskResult.success) {
      return diskResult;
    }

    const callbackPayload = {
      action: 'gateway-confirm-fork',
      childRepositoryId: params.childRepositoryId,
      parentRepositoryId: params.parentRepositoryId,
      parentRefName: params.parentRefName,
      parentCommitOid: params.parentCommitOid,
      childInitialCommitOid: params.childInitialCommitOid,
      idempotencyKey: params.idempotencyKey,
      actorUserId: params.actorUserId || null
    };

    try {
      const url = `${this.config.controlPlaneUrl.replace(/\/$/, '')}/api/git`;
      const res = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.gatewayToken}`
        },
        body: JSON.stringify(callbackPayload)
      });

      if (!res.ok) {
        let errorMsg = `Control plane fork confirmation returned status ${res.status}`;
        try {
          const body = await res.json();
          if (body?.error) errorMsg = body.error;
        } catch {}

        return {
          ...diskResult,
          controlPlaneConfirmed: false,
          controlPlaneError: errorMsg
        };
      }

      const body = await res.json();
      return {
        ...diskResult,
        controlPlaneConfirmed: true,
        idempotent: body?.idempotent
      };
    } catch (err: any) {
      return {
        ...diskResult,
        controlPlaneConfirmed: false,
        controlPlaneError: `Control plane unreachable during fork confirmation: ${err.message}`
      };
    }
  }
}
