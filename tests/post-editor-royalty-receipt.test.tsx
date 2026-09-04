import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PostEditorView } from '../src/views/PostEditorView';
import { AuthContext } from '../src/context/AuthContext';
import { AlertProvider } from '../src/context/AlertContext';
import type { AppListing } from '../src/data/mockData';

const auth = {
  user: null,
  isAuthenticated: false,
  isSuperAdmin: false,
  isAuthModalOpen: false,
  authModalTab: 'login' as const,
  openAuthModal: vi.fn(),
  closeAuthModal: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
  requireAuth: vi.fn()
};

const app: AppListing = {
  id: 'receipt-app',
  name: 'Receipt App',
  tagline: 'Receipt test',
  description: 'Receipt test',
  author: 'seller',
  authorAvatar: 'R',
  version: 'v1.0.0',
  upvotes: 0,
  forkCount: 0,
  forkDepth: 1,
  tags: [],
  screenshots: [],
  comments: [],
  price: 10,
  royaltyBps: 1000,
  inheritedLiens: [{ maker: 'ancestor', bps: 2500 }]
};

describe('Post Editor canonical royalty receipt', () => {
  it('shows platform, inherited lien, seller, and downstream fork amounts from canonical allocation', () => {
    const html = renderToString(
      <AuthContext.Provider value={auth}>
        <AlertProvider>
          <PostEditorView app={app} initialTab="pricing" onSave={() => {}} onCancel={() => {}} />
        </AlertProvider>
      </AuthContext.Provider>
    );

    expect(html).toContain('Sale receipt preview');
    expect(html).toContain('Platform');
    expect(html).toContain('$1.00');
    expect(html).toContain('ancestor');
    expect(html).toContain('$2.25');
    expect(html).toContain('$6.75');
    expect(html).toContain('What a fork of you would owe you at this price');
    expect(html).toContain('$0.90');
  });
});
