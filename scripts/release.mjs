#!/usr/bin/env node

import { execFileSync } from 'node:child_process';

const project = 'nates-software';

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    ...options
  });
}

function git(...args) {
  return run('git', args, { capture: true }).trim();
}

async function smoke(baseUrl, label) {
  const checks = [
    { path: '/', status: 200, contains: '<div id="root">' },
    { path: '/api/git', status: 200, json: body => body.status === 'gateway_required' },
    { path: '/api/git?service=git-upload-pack', status: 501, json: body => body.success === false },
    {
      path: '/api/payments/create-intent',
      status: 503,
      init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"appId":"dronehunter"}' },
      json: body => body.success === false
    },
    {
      path: '/api/payments/onboard',
      status: 503,
      init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"userId":"release-smoke"}' },
      json: body => body.success === false
    },
    {
      path: '/api/payments/webhook',
      status: 503,
      init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"type":"payment_intent.succeeded"}' },
      json: body => body.success === false
    }
  ];

  for (const check of checks) {
    let response;
    for (let attempt = 1; attempt <= 12; attempt += 1) {
      response = await fetch(`${baseUrl}${check.path}`, { redirect: 'follow', ...check.init }).catch(() => null);
      if (response?.status === check.status) break;
      await new Promise(resolve => setTimeout(resolve, attempt * 500));
    }
    if (!response || response.status !== check.status) {
      throw new Error(`${label} smoke failed for ${check.path}: expected ${check.status}, received ${response?.status ?? 'no response'}`);
    }
    if (check.contains && !(await response.text()).includes(check.contains)) {
      throw new Error(`${label} smoke failed for ${check.path}: expected content was absent`);
    }
    if (check.json && !check.json(await response.json())) {
      throw new Error(`${label} smoke failed for ${check.path}: response contract mismatch`);
    }
  }
}

function deploy(branch, commit, message) {
  const output = run('npx', [
    'wrangler', 'pages', 'deploy', 'dist',
    '--project-name', project,
    '--branch', branch,
    '--commit-hash', commit,
    '--commit-message', message,
    '--commit-dirty=false'
  ], { capture: true });
  process.stdout.write(output);
  const urls = [...output.matchAll(/https:\/\/[a-z0-9.-]+\.pages\.dev/g)].map(match => match[0]);
  const immutableUrl = urls.find(url => /^https:\/\/[a-f0-9]{8}\./.test(url));
  if (!immutableUrl) throw new Error(`Could not resolve immutable deployment URL for ${branch}`);
  return immutableUrl;
}

const dirty = git('status', '--porcelain');
if (dirty) throw new Error('Release requires a clean committed worktree.');

const commit = git('rev-parse', 'HEAD');
const shortCommit = git('rev-parse', '--short=12', 'HEAD');
const message = git('log', '-1', '--pretty=%s');
const candidateBranch = `release-${shortCommit}`;

run('npm', ['test']);
run('npm', ['run', 'build']);
run('npx', [
  'wrangler', 'd1', 'migrations', 'apply',
  'nates-software-preview-db', '--env', 'preview', '--remote'
]);

console.log(`Deploying candidate ${candidateBranch} from ${commit}`);
const candidateUrl = deploy(candidateBranch, commit, message);
await smoke(candidateUrl, 'candidate');

// Production migrations run only after the isolated candidate and its canonical
// preview schema pass. Wrangler records applied migrations and snapshots D1
// before each new migration.
run('npx', [
  'wrangler', 'd1', 'migrations', 'apply',
  'nates-software-prod-v2', '--remote'
]);

console.log(`Promoting unchanged dist/ artifact to production from ${commit}`);
const productionDeploymentUrl = deploy('main', commit, message);
await smoke(productionDeploymentUrl, 'production deployment');
await smoke('https://nates-software.pages.dev', 'production alias');

const deployments = JSON.parse(run('npx', [
  'wrangler', 'pages', 'deployment', 'list',
  '--project-name', project, '--environment', 'preview', '--json'
], { capture: true }));
for (const deployment of deployments) {
  if (deployment.Branch === candidateBranch) {
    run('npx', [
      'wrangler', 'pages', 'deployment', 'delete', deployment.Id,
      '--project-name', project, '--force'
    ]);
  }
}

console.log(JSON.stringify({
  success: true,
  commit,
  candidateUrl,
  productionDeploymentUrl,
  productionUrl: 'https://nates-software.pages.dev',
  candidateDestroyed: true
}, null, 2));
