import { describe, expect, it, vi } from 'vitest';
import { DaytonaSandboxProvider } from '../src/providers/DaytonaSandboxProvider.js';

function fixture() {
  let onData: ((data: Uint8Array) => void) | undefined;
  const pty = {
    isConnected: vi.fn(() => true),
    waitForConnection: vi.fn(async () => undefined),
    sendInput: vi.fn(async () => undefined),
    resize: vi.fn(async () => ({})),
    kill: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    wait: vi.fn(() => new Promise(() => {}))
  };
  const sandbox = {
    process: {
      executeCommand: vi.fn(async () => ({ exitCode: 0, result: '/usr/bin/git\n/usr/bin/node\n/usr/bin/npm\n/usr/bin/npx\n/usr/bin/slop' })),
      createPty: vi.fn(async (options: any) => { onData = options.onData; return pty; })
    },
    delete: vi.fn(async () => undefined)
  };
  const client = { create: vi.fn(async () => sandbox) };
  return { client, sandbox, pty, emit: (text: string) => onData?.(new TextEncoder().encode(text)) };
}

describe('Daytona ephemeral VM provider', () => {
  it('fails closed without an explicitly verified VM snapshot', () => {
    expect(() => new DaytonaSandboxProvider({ apiKey: 'key', snapshot: 'snap', ttlMinutes: 15, vmIsolationVerified: false }))
      .toThrow(/VM provider requires/);
  });

  it('creates a no-volume ephemeral sandbox with hard TTL and a native PTY', async () => {
    const f = fixture();
    const provider = new DaytonaSandboxProvider({ apiKey: 'key', snapshot: 'vm-snapshot', ttlMinutes: 15, vmIsolationVerified: true }, f.client as any);
    const session = await provider.createSession({ sessionId: 'session-1', username: 'nate', cols: 100, rows: 30 });
    expect(f.client.create).toHaveBeenCalledWith(expect.objectContaining({
      snapshot: 'vm-snapshot', ephemeral: true, ttlMinutes: 15, autoDeleteInterval: 0, volumes: [], public: false
    }), { timeout: 90 });
    expect(f.sandbox.process.createPty).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/workspace', cols: 100, rows: 30 }));
    const output = vi.fn();
    session.onOutput(output);
    f.emit('ready');
    expect(output).toHaveBeenCalledWith('ready');
    await session.destroy();
    expect(f.sandbox.delete).toHaveBeenCalledWith(60, true);
  });

  it('deletes a sandbox whose required tool capability probe fails', async () => {
    const f = fixture();
    f.sandbox.process.executeCommand.mockResolvedValueOnce({ exitCode: 1, result: 'slop missing' });
    const provider = new DaytonaSandboxProvider({ apiKey: 'key', snapshot: 'vm-snapshot', ttlMinutes: 15, vmIsolationVerified: true }, f.client as any);
    await expect(provider.createSession({ sessionId: 'bad-session' })).rejects.toThrow(/missing required tooling/);
    expect(f.sandbox.delete).toHaveBeenCalled();
  });

  it('still deletes the sandbox after the PTY has already exited', async () => {
    const f = fixture();
    const provider = new DaytonaSandboxProvider({ apiKey: 'key', snapshot: 'vm-snapshot', ttlMinutes: 15, vmIsolationVerified: true }, f.client as any);
    const session = await provider.createSession({ sessionId: 'exited-session' });
    (session as any).emitExit(0, null);

    await provider.destroySession('exited-session');
    expect(f.sandbox.delete).toHaveBeenCalledTimes(1);

    await session.destroy();
    expect(f.sandbox.delete).toHaveBeenCalledTimes(1);
  });
});
