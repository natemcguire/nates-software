import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import * as fs from 'node:fs';
import { createTerminalGateway, type TerminalGatewayInstance } from '../src/server.js';

describe('Terminal Gateway Full Integration & Protocol QA', () => {
  let gateway: TerminalGatewayInstance;
  let port: number;
  let baseUrl: string;
  let wsUrl: string;

  beforeAll(async () => {
    gateway = createTerminalGateway({
      port: 0, // dynamic port
      allowedOrigins: ['http://localhost:*', 'https://nates-software.pages.dev'],
      validTokens: ['custom_valid_token_123'],
      limits: {
        maxConcurrentSessions: 3,
        sessionTtlSeconds: 2, // 2s TTL for testing
        idleTimeoutSeconds: 2,
        maxOutputRateBytesPerSec: 1024 * 1024,
        maxPayloadBytes: 64 * 1024,
        maxOutputBufferBytes: 512 * 1024
      }
    });

    port = await gateway.listen();
    baseUrl = `http://127.0.0.1:${port}`;
    wsUrl = `ws://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await gateway.close();
  });

  it('GET /health returns 200 and healthy status', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ok');
    expect(typeof data.uptime).toBe('number');
    expect(typeof data.activeSessions).toBe('number');
  });

  it('GET /capabilities returns truthful isolation metadata and limits', async () => {
    const res = await fetch(`${baseUrl}/capabilities`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.gatewayVersion).toBe('1.0.0');
    expect(data.isolationType).toBe('process');
    expect(data.isProductionVps).toBe(false);
    expect(data.truthStatement).toContain('NON-PRODUCTION');
    expect(data.availableTools).toEqual(['git', 'node', 'npm', 'npx', 'slop']);
    expect(data.limits.maxConcurrentSessions).toBe(3);
    expect(data.limits.sessionTtlSeconds).toBe(2);
  });

  it('OPTIONS request returns CORS headers', async () => {
    const res = await fetch(`${baseUrl}/health`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5173' }
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(res.headers.get('access-control-allow-methods')).toContain('GET');
  });

  it('rejects WebSocket connection with missing token', async () => {
    await new Promise<void>((resolve) => {
      const ws = new WebSocket(`${wsUrl}/terminal`, {
        headers: { Origin: 'http://localhost:3000' }
      });

      ws.on('error', (err) => {
        expect(err.message).toMatch(/401|Unexpected server response/i);
        resolve();
      });

      ws.on('open', () => {
        ws.close();
        throw new Error('Connection should not have opened');
      });
    });
  });

  it('rejects WebSocket connection with disallowed Origin', async () => {
    await new Promise<void>((resolve) => {
      const ws = new WebSocket(`${wsUrl}/terminal?token=valid_test_token`, {
        headers: { Origin: 'https://attacker.evil.com' }
      });

      ws.on('error', (err) => {
        expect(err.message).toMatch(/403|Unexpected server response/i);
        resolve();
      });

      ws.on('open', () => {
        ws.close();
        throw new Error('Connection should not have opened with disallowed origin');
      });
    });
  });

  it('establishes authenticated WebSocket session, receives session_ready, executes commands, and cleans up workspace on close', async () => {
    let workspacePath = '';

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`${wsUrl}/terminal?token=valid_test_token`, {
        headers: { Origin: 'http://localhost:5173' }
      });

      let receivedReady = false;
      let outputBuffer = '';

      ws.on('open', () => {
        // Connected
      });

      ws.on('message', (raw) => {
        const text = raw.toString();
        try {
          const msg = JSON.parse(text);
          if (msg.type === 'session_ready') {
            receivedReady = true;
            workspacePath = msg.workspacePath;
            expect(msg.isolationType).toBe('process');
            expect(msg.isProductionVps).toBe(false);
            expect(fs.existsSync(workspacePath)).toBe(true);

            // Send test command
            ws.send(JSON.stringify({ type: 'input', data: 'echo "PTY_TEST_OK"\n' }));
          } else if (msg.type === 'output') {
            outputBuffer += msg.data;
            if (outputBuffer.includes('PTY_TEST_OK')) {
              ws.close();
            }
          }
        } catch {
          outputBuffer += text;
          if (outputBuffer.includes('PTY_TEST_OK')) {
            ws.close();
          }
        }
      });

      ws.on('close', () => {
        expect(receivedReady).toBe(true);
        expect(outputBuffer).toContain('PTY_TEST_OK');
        resolve();
      });

      ws.on('error', (err) => reject(err));
    });

    // Wait a brief moment for workspace directory cleanup
    await new Promise((r) => setTimeout(r, 100));

    expect(workspacePath).toBeTruthy();
    expect(fs.existsSync(workspacePath)).toBe(false);
  });

  it('terminates session and cleans up workspace when hard TTL expires', async () => {
    let workspacePath = '';

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`${wsUrl}/terminal?token=valid_test_token`, {
        headers: { Origin: 'http://localhost:5173' }
      });

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === 'session_ready') {
            workspacePath = msg.workspacePath;
            expect(fs.existsSync(workspacePath)).toBe(true);
          }
        } catch {}
      });

      ws.on('close', () => {
        resolve();
      });

      ws.on('error', (err) => reject(err));
    });

    // Wait for cleanup
    await new Promise((r) => setTimeout(r, 100));
    expect(workspacePath).toBeTruthy();
    expect(fs.existsSync(workspacePath)).toBe(false);
  }, 10000);
});
