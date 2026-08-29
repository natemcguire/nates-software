// Deterministic cryptographic digest utilities for DYNO benchmark runner
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

/**
 * Computes SHA-256 hex string of input string or buffer.
 */
export function sha256(data: string | Buffer | Uint8Array): string {
  const hash = createHash('sha256');
  hash.update(data);
  return hash.digest('hex');
}

/**
 * Canonical JSON serialization with recursively sorted object keys.
 * Ensures deterministic hashes regardless of key insertion order.
 */
export function canonicalJson(obj: unknown): string {
  if (obj === null || obj === undefined) {
    return JSON.stringify(obj);
  }
  if (typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalJson).join(',') + ']';
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = keys.map(k => `${JSON.stringify(k)}:${canonicalJson((obj as Record<string, unknown>)[k])}`);
  return '{' + pairs.join(',') + '}';
}

/**
 * Computes deterministic SHA-256 digest of an arbitrary object using canonical JSON.
 */
export function sha256Json(obj: unknown): string {
  return sha256(canonicalJson(obj));
}

/**
 * Computes SHA-256 digest of a local file.
 */
export async function sha256File(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return sha256(content);
}

/**
 * Computes deterministic digest of a file manifest (map of relative paths to contents or sha256 hashes).
 */
export function digestFileManifest(files: Record<string, string>): string {
  const sortedKeys = Object.keys(files).sort();
  const normalized: Record<string, string> = {};
  for (const key of sortedKeys) {
    // If value looks like a raw file content, hash it; if it's already a 64-char sha256 hex, keep it
    const val = files[key];
    normalized[key] = val.length === 64 && /^[0-9a-f]{64}$/i.test(val) ? val : sha256(val);
  }
  return sha256Json(normalized);
}
