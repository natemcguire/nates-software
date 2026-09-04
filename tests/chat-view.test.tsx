import { renderToString } from 'react-dom/server';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ChatView } from '../src/views/ChatView';
import { AuthProvider } from '../src/context/AuthContext';
import { INITIAL_CHAT_MESSAGES } from '../src/lib/ircProtocol';

describe('ChatView Component & Identity Rendering', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const render = () => {
    const raw = renderToString(
      <AuthProvider>
        <ChatView />
      </AuthProvider>
    );
    return raw.replace(/<!--.*?-->/g, '');
  };

  it('renders initial empty/loading state without fixture messages or hardcoded users', () => {
    const html = render();

    for (const fixture of INITIAL_CHAT_MESSAGES) {
      expect(html).not.toContain(fixture.text);
    }

    expect(html).toContain('Online (0)');
    expect(html).toContain('No active users');
    expect(html).toContain('No recent messages in #lounge (24-hour buffer)');

    expect(html).toContain('guest');
  });

  it('does not contain hardcoded operator status for Nate or Josh in client logic', () => {
    const html = render();

    expect(html).toContain('Online (0)');
    expect(html).not.toContain('@nate');
    expect(html).not.toContain('@josh');
  });
});
