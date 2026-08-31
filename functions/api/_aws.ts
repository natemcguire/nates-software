// Functions API: /api/_aws
// SigV4 AWS Client Integration for Cloudflare Pages Functions
// Supports: S3 PutObject, CodeBuild StartBuild/BatchGetBuilds, ECR CreateRepository/DescribeImages, RDS Data API, SSM Parameter Store

import { AwsClient } from 'aws4fetch';

export const DEFAULT_AWS_REGION = 'us-east-2';
export const DEFAULT_AWS_ACCOUNT_ID = '777772815966';
export const DEFAULT_AWS_S3_BUILD_BUCKET = 'nsw-build-sources-777772815966';
export const DEFAULT_NSW_ARTIFACT_BUCKET = 'nsw-build-artifacts-777772815966';
export const DEFAULT_AWS_CODEBUILD_PROJECT = 'nsw-build';
export const DEFAULT_AWS_CODEBUILD_DEPLOY_PROJECT = 'nsw-deploy';
export const DEFAULT_CF_ACCOUNT_ID = '4219a576830c72b0e6e4ca358e61473a';
export const DEFAULT_NSW_DB_CLUSTER_ARN = 'arn:aws:rds:us-east-2:777772815966:cluster:nsw-shared-pg';
export const DEFAULT_NSW_DB_SECRET_ARN = 'arn:aws:secretsmanager:us-east-2:777772815966:secret:rds!cluster-cec8ae29-5aab-461b-a1e9-edfc93ec9a3a-kBp7SZ';
export const DEFAULT_NSW_DB_HOST = 'nsw-shared-pg.cluster-cec8ae29-5aab-461b-a1e9-edfc93ec9a3a.us-east-2.rds.amazonaws.com';

export const APP_ID_REGEX = /^[a-z0-9][a-z0-9-]{0,62}$/;
export const COMMIT_OID_REGEX = /^[a-f0-9]{40}([a-f0-9]{24})?$/;

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  sessionToken?: string;
}

export interface AwsFetchOptions {
  service: string;
  method?: string;
  url?: string;
  path?: string;
  host?: string;
  body?: BodyInit | null;
  headers?: HeadersInit | Record<string, string>;
  customFetch?: typeof fetch;
}

export function getAwsCredentials(env: any): AwsCredentials {
  const accessKeyId = env?.AWS_ACCESS_KEY_ID || (typeof process !== 'undefined' ? process.env?.AWS_ACCESS_KEY_ID : '') || '';
  const secretAccessKey = env?.AWS_SECRET_ACCESS_KEY || (typeof process !== 'undefined' ? process.env?.AWS_SECRET_ACCESS_KEY : '') || '';
  const region = env?.AWS_REGION || (typeof process !== 'undefined' ? process.env?.AWS_REGION : '') || DEFAULT_AWS_REGION;
  const sessionToken = env?.AWS_SESSION_TOKEN || (typeof process !== 'undefined' ? process.env?.AWS_SESSION_TOKEN : undefined);

  return { accessKeyId, secretAccessKey, region, sessionToken };
}

export async function awsFetch(env: any, options: AwsFetchOptions): Promise<Response> {
  const creds = getAwsCredentials(env);
  if (!creds.accessKeyId || !creds.secretAccessKey) {
    throw new Error('AWS credentials missing: AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are required');
  }

  const region = creds.region || DEFAULT_AWS_REGION;
  const service = options.service;
  const method = options.method || (options.body ? 'POST' : 'GET');

  let targetUrl: string;
  if (options.url) {
    targetUrl = options.url;
  } else if (options.host) {
    const rawPath = options.path || '/';
    const path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
    targetUrl = `https://${options.host}${path}`;
  } else {
    const rawPath = options.path || '/';
    const path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
    if (service === 's3') {
      targetUrl = `https://s3.${region}.amazonaws.com${path}`;
    } else {
      targetUrl = `https://${service}.${region}.amazonaws.com${path}`;
    }
  }

  const client = new AwsClient({
    accessKeyId: creds.accessKeyId,
    secretAccessKey: creds.secretAccessKey,
    sessionToken: creds.sessionToken,
    region,
    service
  });

  const customFetch = env?.__AWS_FETCH || options.customFetch;
  if (customFetch) {
    const signed = await client.sign(targetUrl, {
      method,
      headers: options.headers,
      body: options.body
    });
    return customFetch(signed);
  }

  return client.fetch(targetUrl, {
    method,
    headers: options.headers,
    body: options.body
  });
}

export interface S3PutObjectOptions {
  bucket?: string;
  key: string;
  body: Uint8Array | Buffer | string;
  contentType?: string;
}

/**
 * Uploads a file (such as a source tarball) to S3 using SigV4 PutObject.
 */
export async function putS3SourceArchive(
  env: any,
  params: S3PutObjectOptions
): Promise<{ success: boolean; eTag?: string; error?: string; status?: number }> {
  const creds = getAwsCredentials(env);
  const bucket = params.bucket || env?.AWS_S3_BUILD_BUCKET || DEFAULT_AWS_S3_BUILD_BUCKET;
  const region = creds.region || DEFAULT_AWS_REGION;
  const cleanKey = params.key.startsWith('/') ? params.key.slice(1) : params.key;
  const url = `https://${bucket}.s3.${region}.amazonaws.com/${cleanKey}`;

  const headers: Record<string, string> = {
    'Content-Type': params.contentType || 'application/x-tar'
  };

  try {
    const res = await awsFetch(env, {
      service: 's3',
      method: 'PUT',
      url,
      headers,
      body: params.body
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return {
        success: false,
        status: res.status,
        error: `S3 PutObject failed with HTTP ${res.status}: ${errText}`
      };
    }

    const eTag = res.headers.get('etag')?.replace(/"/g, '') || undefined;
    return {
      success: true,
      eTag,
      status: res.status
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'S3 PutObject failed'
    };
  }
}

export interface CodeBuildEnvOverride {
  name: string;
  value: string;
  type?: 'PLAINTEXT' | 'PARAMETER_STORE' | 'SECRETS_MANAGER';
}

/**
 * Dispatches an asynchronous build job on AWS CodeBuild using StartBuild.
 */
export async function startCodeBuild(
  env: any,
  params: {
    projectName?: string;
    project?: string;
    envOverrides: Record<string, string>;
    buildspecOverride?: string;
  }
): Promise<{
  success: boolean;
  buildId?: string;
  arn?: string;
  buildStatus?: string;
  error?: string;
  status?: number;
}> {
  if (params.envOverrides) {
    if (params.envOverrides.APP_ID && !APP_ID_REGEX.test(params.envOverrides.APP_ID)) {
      return {
        success: false,
        error: `Invalid APP_ID '${params.envOverrides.APP_ID}': must match ^[a-z0-9][a-z0-9-]{0,62}$`
      };
    }
    if (params.envOverrides.ECR_REPO) {
      const parts = params.envOverrides.ECR_REPO.split('/');
      const appIdPart = parts.length > 1 ? parts[1] : parts[0];
      if (!APP_ID_REGEX.test(appIdPart)) {
        return {
          success: false,
          error: `Invalid ECR_REPO '${params.envOverrides.ECR_REPO}': appId component must match ^[a-z0-9][a-z0-9-]{0,62}$`
        };
      }
    }
    if (params.envOverrides.COMMIT_OID && !COMMIT_OID_REGEX.test(params.envOverrides.COMMIT_OID)) {
      return {
        success: false,
        error: `Invalid COMMIT_OID '${params.envOverrides.COMMIT_OID}': must match ^[a-f0-9]{40}([a-f0-9]{24})?$`
      };
    }
  }

  const creds = getAwsCredentials(env);
  const region = creds.region || DEFAULT_AWS_REGION;
  const projectName = params.projectName || params.project || env?.AWS_CODEBUILD_PROJECT || DEFAULT_AWS_CODEBUILD_PROJECT;
  const url = `https://codebuild.${region}.amazonaws.com/`;

  const envList: CodeBuildEnvOverride[] = Object.entries(params.envOverrides).map(([name, value]) => ({
    name,
    value: String(value ?? ''),
    type: 'PLAINTEXT'
  }));

  // Ops assumption: the nsw-build / nsw-deploy CodeBuild projects must permit a StartBuild buildspec override.
  const payload: any = {
    projectName,
    environmentVariablesOverride: envList
  };
  if (params.buildspecOverride && params.buildspecOverride.trim()) {
    payload.buildspecOverride = params.buildspecOverride;
  }

  try {
    const res = await awsFetch(env, {
      service: 'codebuild',
      method: 'POST',
      url,
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'CodeBuild_20161006.StartBuild'
      },
      body: JSON.stringify(payload)
    });

    const data: any = await res.json().catch(() => null);

    if (!res.ok || !data?.build?.id) {
      const errMsg = data?.message || data?.error || `CodeBuild StartBuild failed with HTTP ${res.status}`;
      return {
        success: false,
        status: res.status,
        error: errMsg
      };
    }

    return {
      success: true,
      buildId: data.build.id,
      arn: data.build.arn,
      buildStatus: data.build.buildStatus || 'IN_PROGRESS',
      status: res.status
    };
  } catch (err: any) {
    return {
      success: false,
      error: `CodeBuild StartBuild network failure: ${err?.message || String(err)}`
    };
  }
}

/**
 * Fetches status for one or more CodeBuild builds using BatchGetBuilds.
 */
export async function batchGetCodeBuilds(
  env: any,
  params: {
    buildIds: string[];
  }
): Promise<{
  success: boolean;
  builds?: any[];
  buildsNotFound?: string[];
  error?: string;
  status?: number;
}> {
  const creds = getAwsCredentials(env);
  const region = creds.region || DEFAULT_AWS_REGION;
  const url = `https://codebuild.${region}.amazonaws.com/`;

  try {
    const res = await awsFetch(env, {
      service: 'codebuild',
      method: 'POST',
      url,
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'CodeBuild_20161006.BatchGetBuilds'
      },
      body: JSON.stringify({ ids: params.buildIds })
    });

    const data: any = await res.json().catch(() => null);

    if (!res.ok) {
      return {
        success: false,
        status: res.status,
        error: data?.message || data?.error || `CodeBuild BatchGetBuilds failed with HTTP ${res.status}`
      };
    }

    return {
      success: true,
      builds: Array.isArray(data?.builds) ? data.builds : [],
      buildsNotFound: Array.isArray(data?.buildsNotFound) ? data.buildsNotFound : [],
      status: res.status
    };
  } catch (err: any) {
    return {
      success: false,
      error: `CodeBuild BatchGetBuilds network failure: ${err?.message || String(err)}`
    };
  }
}

export interface CreateEcrRepositoryOptions {
  repositoryName: string;
  registryId?: string;
  imageTagMutability?: 'MUTABLE' | 'IMMUTABLE';
  tags?: Array<{ Key: string; Value: string }>;
}

export interface CreateEcrRepositoryResult {
  success: boolean;
  repository?: any;
  alreadyExists?: boolean;
  error?: string;
  status?: number;
}

/**
 * Creates an ECR repository if it does not already exist using CreateRepository (JSON-1.1).
 * Idempotent: treats RepositoryAlreadyExistsException as success.
 */
export async function createEcrRepository(
  env: any,
  params: CreateEcrRepositoryOptions
): Promise<CreateEcrRepositoryResult> {
  if (!params?.repositoryName) {
    return {
      success: false,
      error: 'repositoryName is required'
    };
  }

  const parts = params.repositoryName.split('/');
  const appIdPart = parts.length > 1 ? parts[1] : parts[0];
  if (!APP_ID_REGEX.test(appIdPart)) {
    return {
      success: false,
      error: `Invalid repositoryName '${params.repositoryName}': appId component must match ^[a-z0-9][a-z0-9-]{0,62}$`
    };
  }

  const creds = getAwsCredentials(env);
  const region = creds.region || DEFAULT_AWS_REGION;
  const registryId = params.registryId || env?.AWS_ACCOUNT_ID || DEFAULT_AWS_ACCOUNT_ID;
  const url = `https://ecr.${region}.amazonaws.com/`;

  const payload: any = {
    repositoryName: params.repositoryName
  };
  if (registryId) {
    payload.registryId = registryId;
  }
  if (params.imageTagMutability) {
    payload.imageTagMutability = params.imageTagMutability;
  }
  if (params.tags) {
    payload.tags = params.tags;
  }

  try {
    const res = await awsFetch(env, {
      service: 'ecr',
      method: 'POST',
      url,
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'AmazonEC2ContainerRegistry_V20150921.CreateRepository'
      },
      body: JSON.stringify(payload)
    });

    const data: any = await res.json().catch(() => null);

    if (!res.ok) {
      const errType = String(data?.__type || data?.code || '');
      const errMsg = String(data?.message || data?.error || `ECR CreateRepository failed with HTTP ${res.status}`);

      if (
        errType.includes('RepositoryAlreadyExistsException') ||
        errType.toLowerCase().includes('repositoryalreadyexists') ||
        errMsg.toLowerCase().includes('already exists')
      ) {
        return {
          success: true,
          alreadyExists: true,
          status: res.status
        };
      }

      return {
        success: false,
        alreadyExists: false,
        status: res.status,
        error: data?.message || data?.error || errMsg
      };
    }

    return {
      success: true,
      repository: data?.repository,
      status: res.status
    };
  } catch (err: any) {
    return {
      success: false,
      error: `ECR CreateRepository network failure: ${err?.message || String(err)}`
    };
  }
}

/**
 * Queries ECR for image details (digest) by tag or digest using DescribeImages.
 * Fail-closed handling for missing repository or missing image.
 */
export async function describeEcrImages(
  env: any,
  params: {
    repositoryName: string;
    imageTag?: string;
    imageDigest?: string;
    registryId?: string;
  }
): Promise<{
  success: boolean;
  imageDigest?: string;
  imageDetails?: any;
  repoMissing?: boolean;
  imageMissing?: boolean;
  error?: string;
  status?: number;
}> {
  if (params.repositoryName) {
    const parts = params.repositoryName.split('/');
    const appIdPart = parts.length > 1 ? parts[1] : parts[0];
    if (!APP_ID_REGEX.test(appIdPart)) {
      return {
        success: false,
        error: `Invalid repositoryName '${params.repositoryName}': appId component must match ^[a-z0-9][a-z0-9-]{0,62}$`
      };
    }
  }
  if (params.imageTag && !COMMIT_OID_REGEX.test(params.imageTag)) {
    return {
      success: false,
      error: `Invalid imageTag '${params.imageTag}': must match ^[a-f0-9]{40}([a-f0-9]{24})?$`
    };
  }

  const creds = getAwsCredentials(env);
  const region = creds.region || DEFAULT_AWS_REGION;
  const registryId = params.registryId || env?.AWS_ACCOUNT_ID || DEFAULT_AWS_ACCOUNT_ID;
  const url = `https://ecr.${region}.amazonaws.com/`;

  const imageId: Record<string, string> = {};
  if (params.imageTag) {
    imageId.imageTag = params.imageTag;
  }
  if (params.imageDigest) {
    imageId.imageDigest = params.imageDigest;
  }

  const payload: any = {
    repositoryName: params.repositoryName,
    imageIds: [imageId]
  };
  if (registryId) {
    payload.registryId = registryId;
  }

  try {
    const res = await awsFetch(env, {
      service: 'ecr',
      method: 'POST',
      url,
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'AmazonEC2ContainerRegistry_V20150921.DescribeImages'
      },
      body: JSON.stringify(payload)
    });

    const data: any = await res.json().catch(() => null);

    if (!res.ok) {
      const errType = String(data?.__type || '').toLowerCase();
      const errMsg = String(data?.message || data?.error || `ECR DescribeImages failed with HTTP ${res.status}`).toLowerCase();

      if (errType.includes('repositorynotfoundexception') || (errMsg.includes('repository') && errMsg.includes('does not exist') && !errMsg.includes('image'))) {
        return {
          success: false,
          repoMissing: true,
          status: res.status,
          error: `ECR repo ${params.repositoryName} not provisioned`
        };
      }

      if (errType.includes('imagenotfoundexception') || errMsg.includes('imagenotfound') || (errMsg.includes('image') && errMsg.includes('does not exist'))) {
        return {
          success: false,
          imageMissing: true,
          status: res.status,
          error: `ECR image ${params.repositoryName}:${params.imageTag || params.imageDigest} not found`
        };
      }

      return {
        success: false,
        status: res.status,
        error: data?.message || data?.error || `ECR DescribeImages failed with HTTP ${res.status}`
      };
    }

    const detail = data?.imageDetails?.[0];
    if (!detail?.imageDigest) {
      return {
        success: false,
        imageMissing: true,
        status: res.status,
        error: `ECR image details for ${params.repositoryName} did not contain an image digest`
      };
    }

    return {
      success: true,
      imageDigest: detail.imageDigest,
      imageDetails: detail,
      status: res.status
    };
  } catch (err: any) {
    return {
      success: false,
      error: `ECR DescribeImages network failure: ${err?.message || String(err)}`
    };
  }
}

export interface ExecuteDataApiStatementOptions {
  resourceArn?: string;
  secretArn?: string;
  database?: string;
  sql: string;
  maxRetries?: number;
  retryDelayMs?: number;
}

export interface ExecuteDataApiStatementResult {
  success: boolean;
  records?: any[];
  numberOfRecordsUpdated?: number;
  error?: string;
  errorCode?: string;
  isResuming?: boolean;
  alreadyExists?: boolean;
  status?: number;
}

/**
 * Executes a single SQL statement via RDS Data API (SigV4 service 'rds-data', rest-json).
 * Retries on DatabaseResumingException (scale-to-zero resume).
 */
export async function executeDataApiStatement(
  env: any,
  params: ExecuteDataApiStatementOptions
): Promise<ExecuteDataApiStatementResult> {
  const creds = getAwsCredentials(env);
  const region = creds.region || DEFAULT_AWS_REGION;
  const resourceArn = params.resourceArn || env?.NSW_DB_CLUSTER_ARN || DEFAULT_NSW_DB_CLUSTER_ARN;
  const secretArn = params.secretArn || env?.NSW_DB_SECRET_ARN || DEFAULT_NSW_DB_SECRET_ARN;
  const url = `https://rds-data.${region}.amazonaws.com/Execute`;

  const payload: any = {
    resourceArn,
    secretArn,
    sql: params.sql
  };
  if (params.database) {
    payload.database = params.database;
  }

  const maxRetries = typeof params.maxRetries === 'number' ? params.maxRetries : (env?.AWS_RDS_DATA_MAX_RETRIES ?? 3);
  const baseDelay = typeof params.retryDelayMs === 'number' ? params.retryDelayMs : (env?.AWS_RDS_DATA_RETRY_DELAY_MS ?? 1000);

  let attempt = 0;
  while (attempt <= maxRetries) {
    attempt++;
    try {
      const res = await awsFetch(env, {
        service: 'rds-data',
        method: 'POST',
        url,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const data: any = await res.json().catch(() => null);

      if (res.ok) {
        return {
          success: true,
          records: data?.records,
          numberOfRecordsUpdated: data?.numberOfRecordsUpdated,
          status: res.status
        };
      }

      const errType = String(data?.__type || data?.code || data?.name || '');
      const errMsg = String(data?.message || data?.error || `RDS Data API Execute failed with HTTP ${res.status}`);
      const isResuming = res.status === 503 ||
        res.status === 504 ||
        errType.includes('DatabaseResumingException') ||
        errType.includes('DatabaseUnavailableException') ||
        errType.includes('HttpEndpointNotEnabledException') ||
        errMsg.toLowerCase().includes('resuming') ||
        errMsg.toLowerCase().includes('paused') ||
        errMsg.toLowerCase().includes('communications link failure');

      // Check for Postgres "already exists" errors (42710 for role, 42P04 for database)
      const isAlreadyExists = errMsg.includes('42710') ||
        errMsg.includes('42P04') ||
        errMsg.toLowerCase().includes('already exists') ||
        errType.includes('DuplicateDatabaseException');

      if (isResuming && attempt <= maxRetries) {
        if (baseDelay > 0) {
          await new Promise(r => setTimeout(r, baseDelay * attempt));
        }
        continue;
      }

      return {
        success: false,
        status: res.status,
        error: errMsg,
        errorCode: errType || (errMsg.includes('42710') ? '42710' : (errMsg.includes('42P04') ? '42P04' : undefined)),
        isResuming,
        alreadyExists: isAlreadyExists
      };
    } catch (err: any) {
      if (attempt <= maxRetries) {
        if (baseDelay > 0) {
          await new Promise(r => setTimeout(r, baseDelay * attempt));
        }
        continue;
      }
      return {
        success: false,
        isResuming: true,
        error: `RDS Data API network failure: ${err?.message || String(err)}`
      };
    }
  }

  return {
    success: false,
    isResuming: true,
    error: 'RDS Data API timed out waiting for database resume'
  };
}

export interface PutSsmParameterOptions {
  name: string;
  value: string;
  type?: 'String' | 'StringList' | 'SecureString';
  overwrite?: boolean;
  description?: string;
  keyId?: string;
}

/**
 * Stores a parameter in AWS Systems Manager Parameter Store using SigV4 PutParameter (JSON-1.1).
 */
export async function putSsmParameter(
  env: any,
  params: PutSsmParameterOptions
): Promise<{
  success: boolean;
  version?: number;
  alreadyExists?: boolean;
  error?: string;
  status?: number;
}> {
  const creds = getAwsCredentials(env);
  const region = creds.region || DEFAULT_AWS_REGION;
  const url = `https://ssm.${region}.amazonaws.com/`;

  const payload: any = {
    Name: params.name,
    Value: params.value,
    Type: params.type || 'SecureString',
    Overwrite: params.overwrite ?? false
  };
  if (params.description) payload.Description = params.description;
  if (params.keyId) payload.KeyId = params.keyId;

  try {
    const res = await awsFetch(env, {
      service: 'ssm',
      method: 'POST',
      url,
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'AmazonSSM.PutParameter'
      },
      body: JSON.stringify(payload)
    });

    const data: any = await res.json().catch(() => null);

    if (!res.ok) {
      const errType = String(data?.__type || '');
      const errMsg = String(data?.message || data?.error || `SSM PutParameter failed with HTTP ${res.status}`);
      const alreadyExists = errType.includes('ParameterAlreadyExists') || errMsg.toLowerCase().includes('already exists');

      return {
        success: false,
        alreadyExists,
        status: res.status,
        error: errMsg
      };
    }

    return {
      success: true,
      version: data?.Version,
      status: res.status
    };
  } catch (err: any) {
    return {
      success: false,
      error: `SSM PutParameter network failure: ${err?.message || String(err)}`
    };
  }
}

export interface GetSsmParameterOptions {
  name: string;
  withDecryption?: boolean;
}

/**
 * Retrieves a parameter from AWS Systems Manager Parameter Store using SigV4 GetParameter (JSON-1.1).
 */
export async function getSsmParameter(
  env: any,
  params: GetSsmParameterOptions
): Promise<{
  success: boolean;
  value?: string;
  parameter?: any;
  exists?: boolean;
  error?: string;
  status?: number;
}> {
  const creds = getAwsCredentials(env);
  const region = creds.region || DEFAULT_AWS_REGION;
  const url = `https://ssm.${region}.amazonaws.com/`;

  const payload = {
    Name: params.name,
    WithDecryption: params.withDecryption ?? true
  };

  try {
    const res = await awsFetch(env, {
      service: 'ssm',
      method: 'POST',
      url,
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'AmazonSSM.GetParameter'
      },
      body: JSON.stringify(payload)
    });

    const data: any = await res.json().catch(() => null);

    if (!res.ok) {
      const errType = String(data?.__type || '');
      const errMsg = String(data?.message || data?.error || `SSM GetParameter failed with HTTP ${res.status}`);
      const isNotFound = errType.includes('ParameterNotFound') || errMsg.toLowerCase().includes('not found') || res.status === 400;

      return {
        success: false,
        exists: !isNotFound,
        status: res.status,
        error: errMsg
      };
    }

    return {
      success: true,
      exists: true,
      value: data?.Parameter?.Value,
      parameter: data?.Parameter,
      status: res.status
    };
  } catch (err: any) {
    return {
      success: false,
      error: `SSM GetParameter network failure: ${err?.message || String(err)}`
    };
  }
}

/**
 * Generates a cryptographically secure alphanumeric password (32+ chars, [A-Za-z0-9] only).
 */
export function generateDbPassword(length = 32): string {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => charset[b % charset.length]).join('');
}

export interface ProvisionDatabaseResult {
  success: boolean;
  secretPath?: string;
  dbKind?: 'postgres';
  reused?: boolean;
  retryable?: boolean;
  isResuming?: boolean;
  error?: string;
}

/**
 * Provisions a dedicated per-app Postgres database and user on the shared Aurora Serverless v2 cluster.
 * Steps:
 * 1. Idempotency guard: if SSM /nsw/apps/<id>/db-url exists, reuse it.
 * 2. Generate 32-char alphanumeric password.
 * 3. CREATE ROLE "app_<id>" LOGIN PASSWORD '<pw>'
 * 3b. GRANT "app_<id>" TO CURRENT_USER
 * 4. CREATE DATABASE "app_<id>" OWNER "app_<id>"
 * 5. REVOKE ALL ON DATABASE "app_<id>" FROM PUBLIC
 * 6. REVOKE ALL ON SCHEMA public FROM PUBLIC; GRANT ALL ON SCHEMA public TO "app_<id>"
 * 7. Assemble DSN and store in SSM SecureString /nsw/apps/<id>/db-url.
 */
export async function provisionAppDatabase(
  env: any,
  appId: string,
  options?: { maxRetries?: number; retryDelayMs?: number }
): Promise<ProvisionDatabaseResult> {
  if (!APP_ID_REGEX.test(appId)) {
    return {
      success: false,
      error: `Invalid appId '${appId}': must match ^[a-z0-9][a-z0-9-]{0,62}$`
    };
  }

  const ssmPath = `/nsw/apps/${appId}/db-url`;

  // 1. Idempotency guard: check if SSM parameter already exists
  try {
    const existing = await getSsmParameter(env, { name: ssmPath, withDecryption: true });
    if (existing.success && existing.value) {
      return {
        success: true,
        secretPath: ssmPath,
        dbKind: 'postgres',
        reused: true
      };
    }
  } catch {}

  const dbHost = env?.NSW_DB_HOST || DEFAULT_NSW_DB_HOST;
  const clusterArn = env?.NSW_DB_CLUSTER_ARN || DEFAULT_NSW_DB_CLUSTER_ARN;
  const secretArn = env?.NSW_DB_SECRET_ARN || DEFAULT_NSW_DB_SECRET_ARN;
  const password = generateDbPassword(32);
  const dbName = `app_${appId}`;

  const maxRetries = options?.maxRetries ?? (env?.AWS_RDS_DATA_MAX_RETRIES ?? 3);
  const retryDelayMs = options?.retryDelayMs ?? (env?.AWS_RDS_DATA_RETRY_DELAY_MS ?? 1000);

  const exec = async (sql: string, database?: string) => {
    return executeDataApiStatement(env, {
      resourceArn: clusterArn,
      secretArn: secretArn,
      database: database || 'postgres',
      sql,
      maxRetries,
      retryDelayMs
    });
  };

  // Step 3: CREATE ROLE "app_<id>" LOGIN PASSWORD '<pw>'
  const roleRes = await exec(`CREATE ROLE "${dbName}" LOGIN PASSWORD '${password}'`, 'postgres');
  if (!roleRes.success && !roleRes.alreadyExists && roleRes.errorCode !== '42710') {
    if (roleRes.isResuming) {
      return {
        success: false,
        retryable: true,
        isResuming: true,
        error: 'Database cluster is resuming from paused state. Please retry shortly.'
      };
    }
    return {
      success: false,
      retryable: false,
      error: 'Failed to create database role'
    };
  }

  // Step 3b: GRANT "app_<id>" TO CURRENT_USER
  // PostgreSQL requires the executing user to be a member of the role to set it as DB owner.
  const grantRoleRes = await exec(`GRANT "${dbName}" TO CURRENT_USER`, 'postgres');
  if (!grantRoleRes.success) {
    if (grantRoleRes.isResuming) {
      return {
        success: false,
        retryable: true,
        isResuming: true,
        error: 'Database cluster is resuming from paused state. Please retry shortly.'
      };
    }
    return {
      success: false,
      retryable: false,
      error: 'Failed to grant role to CURRENT_USER'
    };
  }

  // Step 4: CREATE DATABASE "app_<id>" OWNER "app_<id>"
  const dbRes = await exec(`CREATE DATABASE "${dbName}" OWNER "${dbName}"`, 'postgres');
  if (!dbRes.success && !dbRes.alreadyExists && dbRes.errorCode !== '42P04') {
    if (dbRes.isResuming) {
      return {
        success: false,
        retryable: true,
        isResuming: true,
        error: 'Database cluster is resuming from paused state. Please retry shortly.'
      };
    }
    return {
      success: false,
      retryable: false,
      error: 'Failed to create database'
    };
  }

  // Step 5: REVOKE ALL ON DATABASE "app_<id>" FROM PUBLIC
  const revokeDbRes = await exec(`REVOKE ALL ON DATABASE "${dbName}" FROM PUBLIC`, 'postgres');
  if (!revokeDbRes.success) {
    if (revokeDbRes.isResuming) {
      return {
        success: false,
        retryable: true,
        isResuming: true,
        error: 'Database cluster is resuming from paused state. Please retry shortly.'
      };
    }
    return {
      success: false,
      retryable: false,
      error: 'Failed to revoke public access on database'
    };
  }

  // Step 6a: REVOKE ALL ON SCHEMA public FROM PUBLIC (on database: app_<id>)
  const revokeSchemaRes = await exec(`REVOKE ALL ON SCHEMA public FROM PUBLIC`, dbName);
  if (!revokeSchemaRes.success) {
    if (revokeSchemaRes.isResuming) {
      return {
        success: false,
        retryable: true,
        isResuming: true,
        error: 'Database cluster is resuming from paused state. Please retry shortly.'
      };
    }
    return {
      success: false,
      retryable: false,
      error: 'Failed to revoke public schema access'
    };
  }

  // Step 6b: GRANT ALL ON SCHEMA public TO "app_<id>" (on database: app_<id>)
  const grantSchemaRes = await exec(`GRANT ALL ON SCHEMA public TO "${dbName}"`, dbName);
  if (!grantSchemaRes.success) {
    if (grantSchemaRes.isResuming) {
      return {
        success: false,
        retryable: true,
        isResuming: true,
        error: 'Database cluster is resuming from paused state. Please retry shortly.'
      };
    }
    return {
      success: false,
      retryable: false,
      error: 'Failed to grant schema permissions to database role'
    };
  }

  // Step 7: Assemble DSN
  const dsn = `postgresql://${dbName}:${password}@${dbHost}:5432/${dbName}?sslmode=require`;

  // Step 8: SSM PutParameter (SecureString, Overwrite=false)
  const putRes = await putSsmParameter(env, {
    name: ssmPath,
    value: dsn,
    type: 'SecureString',
    overwrite: false
  });

  if (!putRes.success && !putRes.alreadyExists) {
    return {
      success: false,
      retryable: false,
      error: 'Failed to store database connection secret in SSM parameter store'
    };
  }

  return {
    success: true,
    secretPath: ssmPath,
    dbKind: 'postgres',
    reused: false
  };
}
