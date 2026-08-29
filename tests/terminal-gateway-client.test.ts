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
});
