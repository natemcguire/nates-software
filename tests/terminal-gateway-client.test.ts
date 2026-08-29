import { describe, it, expect } from 'vitest';
import { toWebSocketUrl, getDefaultGatewayUrl, TerminalClient } from '../src/lib/terminalClient';

describe('Terminal Client & Gateway Contract', () => {
  it('correctly constructs WebSocket URLs from HTTP/HTTPS endpoints', () => {
    expect(toWebSocketUrl('http://localhost:4000', '/terminal')).toBe('ws://localhost:4000/terminal');
    expect(toWebSocketUrl('https://api.nates-software.com', '/terminal')).toBe('wss://api.nates-software.com/terminal');
    expect(toWebSocketUrl('http://localhost:4000/', 'terminal')).toBe('ws://localhost:4000/terminal');
    expect(toWebSocketUrl('https://gateway.internal:8080?region=us-west', '/pty')).toBe('wss://gateway.internal:8080/pty?region=us-west');
  });

  it('provides default gateway URL fallback', () => {
    const url = getDefaultGatewayUrl();
    expect(url).toBeDefined();
    expect(typeof url).toBe('string');
  });

  it('TerminalClient initializes with disconnected state', () => {
    const client = new TerminalClient('http://localhost:4000');
    expect(client.getState()).toBe('disconnected');
    expect(client.getSessionInfo()).toBeNull();
  });

  it('safely handles sendInput, sendResize, and disconnect when not connected', () => {
    const client = new TerminalClient('http://localhost:4000');
    expect(() => client.sendInput('ls\n')).not.toThrow();
    expect(() => client.sendResize(80, 24)).not.toThrow();
    expect(() => client.disconnect()).not.toThrow();
    expect(client.getState()).toBe('disconnected');
  });

  it('transitions to error state when ticket authorization fails', async () => {
    // Mock global fetch to return an error response
    const origFetch = global.fetch;
    (global as any).fetch = async (url: string) => {
      if (url === '/api/terminal-session') {
        return {
          ok: false,
          status: 503,
          json: async () => ({ success: false, error: 'Ephemeral terminal service is not configured' })
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };

    let reportedError: string | null = null;
    let reportedState: string | null = null;

    const client = new TerminalClient('http://localhost:4000', {
      onError: (err) => { reportedError = err; },
      onStateChange: (state) => { reportedState = state; }
    });

    try {
      await client.connect();
      expect(client.getState()).toBe('error');
      expect(reportedState).toBe('error');
      expect(reportedError).toContain('Ephemeral terminal service is not configured');
    } finally {
      global.fetch = origFetch;
    }
  });

  it('handles unreachable capabilities and health checks gracefully', async () => {
    const origFetch = global.fetch;
    (global as any).fetch = async () => {
      throw new Error('Network unreachable');
    };

    const client = new TerminalClient('http://localhost:4000');
    try {
      const caps = await client.checkCapabilities();
      expect(caps).toBeNull();
      const health = await client.checkHealth();
      expect(health).toBe(false);
    } finally {
      global.fetch = origFetch;
    }
  });
});
