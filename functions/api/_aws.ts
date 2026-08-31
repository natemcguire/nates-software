// Functions API: /api/_aws
// SigV4 AWS Client Integration for Cloudflare Pages Functions
// Supports: S3 PutObject, CodeBuild StartBuild/BatchGetBuilds, ECR DescribeImages

import { AwsClient } from 'aws4fetch';

export const DEFAULT_AWS_REGION = 'us-east-2';
export const DEFAULT_AWS_ACCOUNT_ID = '777772815966';
export const DEFAULT_AWS_S3_BUILD_BUCKET = 'nsw-build-sources-777772815966';
export const DEFAULT_NSW_ARTIFACT_BUCKET = 'nsw-build-artifacts-777772815966';
export const DEFAULT_AWS_CODEBUILD_PROJECT = 'nsw-build';
export const DEFAULT_AWS_CODEBUILD_DEPLOY_PROJECT = 'nsw-deploy';
export const DEFAULT_CF_ACCOUNT_ID = '4219a576830c72b0e6e4ca358e61473a';

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
