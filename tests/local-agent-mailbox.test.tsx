import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import {
  checkLocalAgentInboxHealth,
  fetchLocalInboxes,
  OfflinePane,
  RunningPane,
  LOCAL_AGENT_INBOX_URL,
  type LocalInbox
} from '../src/components/LocalAgentMailbox';

/**
 * This repo runs component tests via react-dom/server `renderToString`
 * (see tests/error-boundary.test.tsx) — there is no jsdom/testing-library
 * DOM environment, so React effects do NOT fire under SSR. We therefore test
 * the health-probe + offline/running contract by:
 *   1. mocking global fetch,
 *   2. awaiting the exported async service functions (the same ones the
 *      component's useEffect calls),
 *   3. asserting the returned state, then
 *   4. renderToString-ing the presentational pane for that state and
 *      asserting on the produced HTML.
 * Nothing is mocked in the UI itself — offline yields the honest pane,
 * running yields the real fetched inboxes.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('checkLocalAgentInboxHealth', () => {
  it('returns { running: false } when /healthz rejects (connection refused)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const result = await checkLocalAgentInboxHealth();
    expect(result.running).toBe(false);
    expect(result.version).toBeUndefined();
  });

  it('returns { running: false } when /healthz responds non-ok HTTP', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) })
    );
    const result = await checkLocalAgentInboxHealth();
    expect(result.running).toBe(false);
  });

  it('returns { running: false } when body status is not "ok"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'degraded' }) })
    );
    const result = await checkLocalAgentInboxHealth();
    expect(result.running).toBe(false);
  });

  it('returns { running: true, version } when /healthz resolves ok with status ok', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok', db: 'ok', version: '1.0.0' })
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await checkLocalAgentInboxHealth();
    expect(result).toEqual({ running: true, version: '1.0.0' });
    expect(fetchMock).toHaveBeenCalledWith(
      `${LOCAL_AGENT_INBOX_URL}/healthz`,
      expect.objectContaining({ method: 'GET' })
    );
  });
});

describe('OfflinePane (honest offline contract)', () => {
  it('renders the exact README offline copy with install + start instructions', () => {
    const html = renderToString(<OfflinePane />);
    expect(html).toContain('Local Agent Mailbox Offline');
    expect(html).toContain('http://127.0.0.1:8791');
    expect(html).toContain('./scripts/install.sh');
    expect(html).toContain('agent-inbox serve');
    // Never claims to show data when offline.
    expect(html).toContain('No mock data is shown');
  });
});

describe('offline flow: /healthz rejects → offline pane renders', () => {
  it('probe returns not-running and the offline pane is what gets shown', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const health = await checkLocalAgentInboxHealth();
    expect(health.running).toBe(false);

    // With running:false the component shows OfflinePane. Render it directly.
    const html = renderToString(<OfflinePane onReconnect={() => {}} />);
    expect(html).toContain('Local Agent Mailbox Offline');
    expect(html).toContain('Reconnect');
    expect(html).not.toContain('Agent Inboxes'); // running-pane header absent
  });
});

describe('running flow: /healthz + /v1/inboxes resolve → inboxes render', () => {
  it('fetches real inboxes and renders them in the running pane', async () => {
    const inboxesPayload = {
      inboxes: [
        {
          address: 'codex-worker1@boats',
          project: 'boats',
          local_part: 'codex-worker1',
          display_name: 'Codex worker 1',
          created_at: '2026-08-30T16:56:00.000Z',
          last_seen_at: '2026-08-30T16:56:00.000Z'
        },
        {
          address: 'claude@nate-bot',
          project: 'nate-bot',
          local_part: 'claude',
          display_name: null,
          created_at: '2026-08-30T16:56:00.000Z',
          last_seen_at: '2026-08-30T16:56:00.000Z'
        }
      ]
    };

    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith('/healthz')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ status: 'ok', db: 'ok', version: '1.0.0' })
        });
      }
      if (url.endsWith('/v1/inboxes')) {
        return Promise.resolve({ ok: true, json: async () => inboxesPayload });
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    const health = await checkLocalAgentInboxHealth();
    expect(health.running).toBe(true);

    const inboxes = await fetchLocalInboxes();
    expect(inboxes).toHaveLength(2);
    expect(inboxes[0].address).toBe('codex-worker1@boats');

    const html = renderToString(
      <RunningPane
        version={health.version}
        inboxes={inboxes as LocalInbox[]}
        inboxesLoading={false}
        inboxesError={null}
        selectedAddress={null}
        onSelectInbox={() => {}}
        threads={[]}
        threadsLoading={false}
        threadsError={null}
        selectedThreadId={null}
        onSelectThread={() => {}}
        detail={null}
        detailLoading={false}
        detailError={null}
        onReconnect={() => {}}
        probing={false}
      />
    );

    // Real fetched inbox addresses appear; header + version chip present.
    expect(html).toContain('codex-worker1@boats');
    expect(html).toContain('claude@nate-bot');
    expect(html).toContain('Agent Inboxes');
    expect(html).toContain('v1.0.0');
    // No offline copy leaks into the running pane.
    expect(html).not.toContain('Local Agent Mailbox Offline');
  });
});
