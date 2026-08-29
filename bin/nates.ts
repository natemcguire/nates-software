#!/usr/bin/env node
/**
 * Backward-compatible entry point for early `nates` CLI users.
 *
 * The supported CLI is `slop`. Delegating here keeps old scripts useful without
 * maintaining a second command implementation or fabricating runtime state.
 */

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const binDirectory = dirname(fileURLToPath(import.meta.url));
const slopEntryPoint = join(binDirectory, 'slop');
const result = spawnSync(process.execPath, [slopEntryPoint, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  console.error(`Unable to start the slop CLI: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
