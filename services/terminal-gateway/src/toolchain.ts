export const CORE_TERMINAL_TOOLS = [
  'bash', 'git', 'git-lfs', 'ssh', 'curl', 'wget', 'jq', 'rg',
  'node', 'npm', 'npx', 'python3', 'pip3',
  'gcc', 'g++', 'make', 'pkg-config',
  'sqlite3', 'tar', 'gzip', 'zip', 'unzip', 'rsync', 'file', 'tree',
  'nano', 'vim', 'claude', 'slop'
] as const;

export const LOCAL_TERMINAL_TOOLS = ['git', 'node', 'npm', 'npx', 'slop'] as const;

export function terminalToolchainProbe(): string {
  return CORE_TERMINAL_TOOLS.map(tool => `command -v ${tool}`).join(' && ');
}
