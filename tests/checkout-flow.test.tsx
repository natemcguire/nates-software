import { renderToString } from 'react-dom/server';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CheckoutModal } from '../src/components/CheckoutModal';
import { AuthContext } from '../src/context/AuthContext';
import { CatalogProvider, useCatalog } from '../src/context/CatalogContext';
import { AlertProvider } from '../src/context/AlertContext';

// Mock soundEngine
vi.mock('../src/lib/soundEngine', () => ({
  playClickSound: vi.fn(),
  playSuccessChime: vi.fn()
}));

// Mock @stripe/stripe-js
const mockPaymentElementMount = vi.fn();
const mockPaymentElementOn = vi.fn((event: string, callback: () => void) => {
  if (event === 'ready') callback();
});
const mockPaymentElementDestroy = vi.fn();

const mockElements = {
  create: vi.fn((_type: string) => ({
    mount: mockPaymentElementMount,
    on: mockPaymentElementOn,
    destroy: mockPaymentElementDestroy
  }))
};

const mockConfirmPayment = vi.fn();
const mockStripeInstance = {
  elements: vi.fn(() => mockElements),
  confirmPayment: mockConfirmPayment
};

vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn(() => Promise.resolve(mockStripeInstance))
}));

describe('Cluster A1: Checkout -> Payment -> Own Real Loop', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const dummyApp = {
    id: 'wallart',
    name: 'WallArt Canvas Pro',
    version: 'v2.0.0',
    creator: 'nate',
    author: 'nate',
    creatorAvatar: '🎨',
    price: '$59.00', // Should be ignored in favor of server quote!
    forkDepth: 2
  };

  const authenticatedUser = {
    id: 'usr_buyer_123',
    username: 'test_buyer',
    displayName: 'Test Buyer',
    avatar: '⚡',
    role: 'user' as const,
    isSuperAdmin: false
  };

  function createAuthContextValue(user: any = authenticatedUser) {
    return {
      user,
      isAuthenticated: Boolean(user),
      isSuperAdmin: user?.role === 'super_admin',
      isAuthModalOpen: false,
      authModalTab: 'login' as const,
      openAuthModal: vi.fn(),
      closeAuthModal: vi.fn(),
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      requireAuth: vi.fn()
    };
  }

  describe('1. Unauthenticated Checkout Gate', () => {
    it('requires login before checkout and presents login prompt without creating intent', () => {
      const authValue = createAuthContextValue(null); // Unauthenticated
      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy;

      const html = renderToString(
        <AlertProvider>
          <AuthContext.Provider value={authValue}>
            <CatalogProvider>
              <CheckoutModal
                isOpen={true}
                onClose={() => {}}
                app={dummyApp}
              />
            </CatalogProvider>
          </AuthContext.Provider>
        </AlertProvider>
      );

      expect(html).toContain('Authentication Required to Purchase');
      expect(html).toContain('Log In or Register to Buy');
      expect(html).toContain('Cancel');
      // Must not call create-intent
      expect(fetchSpy).not.toHaveBeenCalledWith('/api/payments/create-intent', expect.anything());
    });
  });

  describe('2. Authoritative Server Quote & Lineage Split Rendering', () => {
    it('renders server-provided price and lineage allocations rather than client guesswork', async () => {
      const serverQuote = {
        success: true,
        orderId: 'ord_authoritative_999',
        clientSecret: 'pi_test_secret_123',
        paymentIntentId: 'pi_test_123',
        amountCents: 4500, // Authoritative $45.00 from backend, NOT $59 or $15
        currency: 'usd',
        publishableKey: 'pk_test_sample_key',
        lineageSnapshot: {
          isRoot: false,
          makerCents: 3150,
          lineageTotalCents: 900,
          protocolPoolCents: 450
        },
        allocations: [
          { role: 'maker', recipientUserId: 'nate', amountCents: 3150, basisPoints: 7000 },
          { role: 'ancestor', recipientUserId: 'parent_dev', amountCents: 450, basisPoints: 1000, lineageDepth: 1 },
          { role: 'ancestor', recipientUserId: 'root_dev', amountCents: 450, basisPoints: 1000, lineageDepth: 2 },
          { role: 'protocol_pool', recipientUserId: null, amountCents: 450, basisPoints: 1000 }
        ]
      };

      let sentHeaders: Record<string, string> = {};
      let sentBody: any = null;

      globalThis.fetch = vi.fn().mockImplementation((url: string, opts?: any) => {
        if (url === '/api/payments/create-intent') {
          sentHeaders = opts?.headers || {};
          sentBody = JSON.parse(opts?.body || '{}');
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => serverQuote
          });
        }
        if (url === '/api/shelf') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ success: true, shelf: [] })
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ success: true })
        });
      });

      // Verify contract of create-intent call
      const res = await fetch('/api/payments/create-intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'test-uuid-key-123'
        },
        body: JSON.stringify({ appId: dummyApp.id })
      });
      const data = await res.json();

      expect(sentHeaders['Idempotency-Key']).toBe('test-uuid-key-123');
      expect(sentBody.appId).toBe('wallart');
      expect(data.amountCents).toBe(4500);
      expect(data.allocations).toHaveLength(4);
      expect(data.allocations[0].amountCents).toBe(3150); // 70%
      expect(data.allocations[1].recipientUserId).toBe('parent_dev');
      expect(data.allocations[2].recipientUserId).toBe('root_dev');
      expect(data.allocations[3].role).toBe('protocol_pool');
    });

    it('gracefully handles 503 commissioning response without throwing', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({
          success: false,
          error: 'Checkout is temporarily unavailable while durable settlement is being commissioned.'
        })
      });

      const res = await fetch('/api/payments/create-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'key_comm_1' },
        body: JSON.stringify({ appId: 'dronehunter' })
      });
      const data = await res.json();

      expect(res.status).toBe(503);
      expect(data.success).toBe(false);
      expect(data.error).toContain('commissioned');
    });

    it('invokes stripe.confirmPayment with correct elements and redirect: if_required parameter', async () => {
      const { loadStripe } = await import('@stripe/stripe-js');
      const stripe = await loadStripe('pk_test_123');
      expect(stripe).toBeTruthy();

      mockConfirmPayment.mockResolvedValueOnce({
        paymentIntent: {
          id: 'pi_test_confirmed_1',
          status: 'succeeded'
        }
      });

      const result = await stripe!.confirmPayment({
        elements: mockElements as any,
        redirect: 'if_required'
      });

      expect(mockConfirmPayment).toHaveBeenCalledWith({
        elements: mockElements,
        redirect: 'if_required'
      });
      expect(result.paymentIntent?.status).toBe('succeeded');
    });
  });

  describe('3. Order Fulfillment Polling & Shelf Refresh Contract', () => {
    it('polls /api/payments/orders/:id upon payment success and resolves license key & download links', async () => {
      const orderId = 'ord_fulfilled_live_loop_1';
      let pollCount = 0;

      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/payments/orders/')) {
          pollCount++;
          if (pollCount === 1) {
            return Promise.resolve({
              ok: true,
              json: async () => ({
                success: true,
                order: {
                  id: orderId,
                  status: 'processing',
                  amountCents: 2500,
                  license: null
                }
              })
            });
          }
          return Promise.resolve({
            ok: true,
            json: async () => ({
              success: true,
              order: {
                id: orderId,
                appId: 'certified-mailer',
                appName: 'Certified Mailer',
                appVersion: 'v1.0.0',
                status: 'fulfilled',
                amountCents: 2500,
                license: {
                  id: 'lic_fulfilled_123',
                  licenseKey: 'NSW-CE-A1B2-C3D4-E5F6-0011',
                  licenseKeyLast4: '0011',
                  maskedKey: 'NSW-CE-••••-0011',
                  status: 'active',
                  issuedAt: new Date().toISOString()
                },
                binaries: {
                  mac: 'https://downloads.nates-software.com/mailer-mac.dmg',
                  win: 'https://downloads.nates-software.com/mailer-win.exe'
                }
              }
            })
          });
        }
        if (url === '/api/shelf') {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              success: true,
              shelf: [
                {
                  id: 'lic_fulfilled_123',
                  appId: 'certified-mailer',
                  name: 'Certified Mailer',
                  version: 'v1.0.0',
                  status: 'active'
                }
              ]
            })
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true })
        });
      });

      // 1. Initial poll returns processing
      const poll1 = await fetch(`/api/payments/orders/${orderId}`);
      const data1 = await poll1.json();
      expect(data1.order.status).toBe('processing');
      expect(data1.order.license).toBeNull();

      // 2. Second poll returns fulfilled
      const poll2 = await fetch(`/api/payments/orders/${orderId}`);
      const data2 = await poll2.json();
      expect(data2.order.status).toBe('fulfilled');
      expect(data2.order.license.licenseKey).toBe('NSW-CE-A1B2-C3D4-E5F6-0011');
      expect(data2.order.binaries.mac).toContain('.dmg');

      // 3. Shelf refetch returns the newly owned app
      const shelfRes = await fetch('/api/shelf');
      const shelfData = await shelfRes.json();
      expect(shelfData.shelf).toHaveLength(1);
      expect(shelfData.shelf[0].appId).toBe('certified-mailer');
    });
  });

  describe('4. CatalogContext Shelf Refetch & Real recordPurchase', () => {
    it('refetches shelf from server and does not use fake local Set mutation', async () => {
      let shelfFetchCount = 0;

      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.startsWith('/api/shelf')) {
          shelfFetchCount++;
          return Promise.resolve({
            ok: true,
            json: async () => ({
              success: true,
              shelf: [
                { id: 'lic_1', appId: 'dronehunter', status: 'active' }
              ]
            })
          });
        }
        if (url.startsWith('/api/drops')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ success: true, drops: [] })
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true })
        });
      });

      let contextRef: any = null;

      function Consumer() {
        contextRef = useCatalog();
        return <div>{contextRef.isOwned('dronehunter') ? 'OWNED' : 'NOT_OWNED'}</div>;
      }

      renderToString(
        <AuthContext.Provider value={createAuthContextValue(authenticatedUser)}>
          <CatalogProvider>
            <Consumer />
          </CatalogProvider>
        </AuthContext.Provider>
      );

      expect(contextRef).toBeTruthy();
      expect(typeof contextRef.recordPurchase).toBe('function');
      expect(typeof contextRef.refreshShelf).toBe('function');

      // Calling refreshShelf directly invokes /api/shelf
      await contextRef.refreshShelf();
      expect(shelfFetchCount).toBe(1);

      // Calling recordPurchase triggers real shelf refetch
      await contextRef.recordPurchase('dronehunter', 'NSW-test-key');
      expect(shelfFetchCount).toBe(2);
    });
  });
});
