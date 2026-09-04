import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ShieldCheck, Lock, Sparkles, AlertTriangle, Check, Copy, ExternalLink, Download, LogIn, RefreshCw } from 'lucide-react';
import { loadStripe, Stripe, StripeElements, StripePaymentElement } from '@stripe/stripe-js';
import { playClickSound, playSuccessChime } from '../lib/soundEngine';
import { useAuth } from '../context/AuthContext';
import { useCatalog } from '../context/CatalogContext';
import { publishedArtifactLinks } from '../lib/profileDomain';
import { Win95Scroll } from './Win95Scroll';

export interface CheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  app: {
    id: string;
    name: string;
    version: string;
    creator?: string;
    author?: string;
    creatorAvatar?: string;
    authorAvatar?: string;
    price?: string | number;
    forkDepth?: number;
  };
}

interface AllocationItem {
  role: string;
  recipientUserId: string | null;
  amountCents: number;
  basisPoints: number;
  lineageDepth?: number | null;
}

interface ServerIntentQuote {
  orderId: string;
  clientSecret: string;
  paymentIntentId: string;
  amountCents: number;
  currency: string;
  publishableKey: string;
  lineageSnapshot: any;
  allocations: AllocationItem[];
}

interface FulfilledOrder {
  id: string;
  appId: string;
  appName: string;
  appVersion: string;
  status: string;
  amountCents: number;
  currency: string;
  license?: {
    id: string;
    licenseKey: string;
    licenseKeyLast4: string;
    maskedKey: string;
    status: string;
    issuedAt: string;
  };
  binaries?: Record<string, string>;
  storage?: string;
}

export const CheckoutModal: React.FC<CheckoutModalProps> = ({ isOpen, onClose, app }) => {
  const { isAuthenticated, openAuthModal } = useAuth();
  const { refreshCatalog, refreshShelf } = useCatalog();

  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => crypto.randomUUID());

  const [status, setStatus] = useState<string>(() => (!isAuthenticated ? 'auth_required' : 'init'));
  const [quote, setQuote] = useState<ServerIntentQuote | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [isStripeReady, setIsStripeReady] = useState(false);
  const [isKeyCopied, setIsKeyCopied] = useState(false);
  const [fulfilledOrder, setFulfilledOrder] = useState<FulfilledOrder | null>(null);

  const stripeRef = useRef<Stripe | null>(null);
  const elementsRef = useRef<StripeElements | null>(null);
  const paymentElementRef = useRef<StripePaymentElement | null>(null);
  const paymentContainerRef = useRef<HTMLDivElement | null>(null);
  const pollTimerRef = useRef<any>(null);

  const cleanupStripe = useCallback(() => {
    if (paymentElementRef.current) {
      try {
        paymentElementRef.current.destroy();
      } catch {}
      paymentElementRef.current = null;
    }
    elementsRef.current = null;
    stripeRef.current = null;
    setIsStripeReady(false);
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      setIdempotencyKey(crypto.randomUUID());
      setQuote(null);
      setCheckoutError(null);
      setFulfilledOrder(null);
      setIsKeyCopied(false);
      if (!isAuthenticated) {
        setStatus('auth_required');
      } else {
        setStatus('init');
      }
    } else {
      cleanupStripe();
    }
  }, [isOpen, isAuthenticated, cleanupStripe]);

  const fetchIntent = useCallback(async (currentKey: string) => {
    if (!isAuthenticated) {
      setStatus('auth_required');
      return;
    }

    setStatus('init');
    setCheckoutError(null);
    cleanupStripe();

    try {
      const res = await fetch('/api/payments/create-intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': currentKey
        },
        body: JSON.stringify({ appId: app.id })
      });

      const data = await res.json().catch(() => ({}));

      if (res.status === 503) {
        setStatus('commissioning');
        setCheckoutError(data.error || 'Checkout is temporarily unavailable while settlement is being commissioned.');
        return;
      }

      if (!res.ok || !data.success) {
        setStatus('error');
        setCheckoutError(data.error || 'Failed to initialize secure checkout session.');
        return;
      }

      if (!data.publishableKey || !data.clientSecret) {
        setStatus('commissioning');
        setCheckoutError('Stripe publishable key is not configured on the server.');
        return;
      }

      const serverQuote: ServerIntentQuote = {
        orderId: data.orderId,
        clientSecret: data.clientSecret,
        paymentIntentId: data.paymentIntentId,
        amountCents: data.amountCents,
        currency: data.currency || 'usd',
        publishableKey: data.publishableKey,
        lineageSnapshot: data.lineageSnapshot,
        allocations: data.allocations || []
      };

      setQuote(serverQuote);
      setStatus('ready');
    } catch (err: any) {
      setStatus('error');
      setCheckoutError(err?.message || 'Network error while contacting checkout server.');
    }
  }, [isAuthenticated, app.id, cleanupStripe]);

  useEffect(() => {
    if (!isOpen) return;
    if (!isAuthenticated) {
      setStatus('auth_required');
    } else {
      fetchIntent(idempotencyKey);
    }
  }, [isOpen, isAuthenticated, idempotencyKey, fetchIntent]);

  useEffect(() => {
    if (status !== 'ready' || !quote || !paymentContainerRef.current) return;

    let isMounted = true;

    async function mountElement() {
      try {
        const stripe = await loadStripe(quote!.publishableKey);
        if (!stripe || !isMounted) return;

        stripeRef.current = stripe;
        const elements = stripe.elements({
          clientSecret: quote!.clientSecret,
          appearance: {
            theme: 'flat',
            variables: {
              fontFamily: 'Tahoma, sans-serif',
              fontSizeBase: '12px',
              colorPrimary: '#000080',
              colorBackground: '#ffffff',
              colorText: '#000000',
              colorDanger: '#df1b41',
              borderRadius: '0px'
            }
          }
        });
        elementsRef.current = elements;

        const paymentElement = elements.create('payment');
        paymentElementRef.current = paymentElement;

        paymentElement.on('ready', () => {
          if (isMounted) setIsStripeReady(true);
        });

        if (paymentContainerRef.current) {
          paymentElement.mount(paymentContainerRef.current);
        }
      } catch (err: any) {
        if (isMounted) {
          console.error('[STRIPE MOUNT ERROR]', err);
          setCheckoutError(err?.message || 'Failed to initialize payment form.');
        }
      }
    }

    mountElement();

    return () => {
      isMounted = false;
      cleanupStripe();
    };
  }, [status, quote, cleanupStripe]);

  const pollOrderFulfillment = useCallback(async (orderId: string, maxAttempts = 25) => {
    setStatus('polling');
    let attempts = 0;

    const checkStatus = async () => {
      attempts++;
      try {
        const res = await fetch(`/api/payments/orders/${encodeURIComponent(orderId)}`);
        const data = await res.json().catch(() => ({}));

        if (res.ok && data.success && data.order) {
          const order: FulfilledOrder = data.order;
          if (order.status === 'fulfilled') {
            setFulfilledOrder(order);
            setStatus('fulfilled');
            playSuccessChime();
            try {
              await refreshShelf();
              await refreshCatalog();
            } catch {}
            return;
          }

          if (order.status === 'payment_failed') {
            setStatus('error');
            setCheckoutError(order.status || 'Order fulfillment failed.');
            return;
          }
        }
      } catch (pollErr) {
        console.warn('[ORDER POLL WARN]', pollErr);
      }

      if (attempts < maxAttempts) {
        pollTimerRef.current = setTimeout(checkStatus, 1000);
      } else {
        setStatus('timeout');
        try {
          await refreshShelf();
          await refreshCatalog();
        } catch {}
      }
    };

    checkStatus();
  }, [refreshShelf, refreshCatalog]);

  const handlePay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripeRef.current || !elementsRef.current || !quote) return;

    setStatus('processing');
    setCheckoutError(null);
    playClickSound();

    try {
      const result = await stripeRef.current.confirmPayment({
        elements: elementsRef.current,
        redirect: 'if_required'
      });

      if (result.error) {
        setStatus('error');
        setCheckoutError(result.error.message || 'Payment confirmation failed. Please check your payment details.');
        return;
      }

      const pi = result.paymentIntent;
      if (pi && (pi.status === 'succeeded' || pi.status === 'processing' || pi.status === 'requires_capture')) {
        await pollOrderFulfillment(quote.orderId);
      } else if (pi?.status === 'requires_action') {
        setStatus('error');
        setCheckoutError('Additional authentication was required and could not be completed.');
      } else {
        await pollOrderFulfillment(quote.orderId);
      }
    } catch (err: any) {
      setStatus('error');
      setCheckoutError(err?.message || 'Payment submission failed.');
    }
  };

  const handleCopyLicenseKey = (key: string) => {
    playSuccessChime();
    navigator.clipboard.writeText(key);
    setIsKeyCopied(true);
    setTimeout(() => setIsKeyCopied(false), 2500);
  };

  if (!isOpen) return null;

  const formattedPrice = quote
    ? `$${(quote.amountCents / 100).toFixed(2)}`
    : typeof app.price === 'number'
      ? `$${app.price.toFixed(2)}`
      : `$${(parseInt(String(app.price || '15').replace(/[^0-9.]/g, ''), 10) || 15).toFixed(2)}`;

  const makerAlloc = quote?.allocations?.find(a => a.role === 'seller');
  const poolAlloc = quote?.allocations?.find(a => a.role === 'platform');
  const ancestorAllocs = quote?.allocations?.filter(a => a.role === 'ancestor') || [];

  const artifactLinks = fulfilledOrder?.binaries ? publishedArtifactLinks(fulfilledOrder.binaries) : [];

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center pointer-events-none select-none p-4 font-tahoma text-xs">
      <div className="w-full max-w-lg bg-w95-gray border-2 border-t-white border-l-white border-b-black border-r-black shadow-2xl p-1 max-h-[95vh] flex flex-col pointer-events-auto">
        <div className="bg-[#000080] text-white px-2 py-1 flex items-center justify-between font-bold text-xs shrink-0">
          <div className="flex items-center gap-1.5">
            <Lock size={13} className="text-yellow-300" />
            <span>SECURE STRIPE MARKETPLACE CHECKOUT</span>
          </div>
          <button
            onClick={() => { playClickSound(); onClose(); }}
            className="w-4 h-4 bg-w95-gray border border-t-white border-l-white border-b-black border-r-black text-black font-bold flex items-center justify-center text-[10px] hover:bg-red-700 hover:text-white"
          >
            ✕
          </button>
        </div>

        <Win95Scroll className="p-4 bg-w95-gray space-y-4 flex-1">
          {status === 'auth_required' && (
            <div className="space-y-4">
              <div className="bg-amber-50 border-2 border-amber-500 p-3 text-amber-950 flex items-start gap-2.5">
                <AlertTriangle size={18} className="shrink-0 mt-0.5 text-amber-600" />
                <div>
                  <div className="font-bold text-xs">Authentication Required to Purchase</div>
                  <div className="mt-1 text-[11px] leading-relaxed text-amber-900">
                    Purchases on Nate's Software are cryptographically signed and permanently bound to your buyer profile.
                    Sign in or create an account to proceed with checkout.
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-gray-300">
                <button
                  type="button"
                  onClick={() => { playClickSound(); onClose(); }}
                  className="btn-w95 px-4 py-1 text-xs"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={() => {
                    playClickSound();
                    openAuthModal('login');
                  }}
                  className="btn-w95 btn-w95-primary px-5 py-1.5 font-bold text-xs flex items-center gap-1.5"
                >
                  <LogIn size={13} />
                  <span>Log In or Register to Buy</span>
                </button>
              </div>
            </div>
          )}

          {status === 'commissioning' && (
            <div className="space-y-4">
              <div className="bg-white border-2 border-t-black border-l-black border-b-white border-r-white p-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{app.creatorAvatar || app.authorAvatar || '🎯'}</span>
                  <div>
                    <div className="font-bold text-gray-900 text-sm">{app.name}</div>
                    <div className="text-gray-500 text-[11px] font-mono">{app.version} · One-Time License</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-bold font-mono text-base text-green-800">{formattedPrice}</div>
                </div>
              </div>

              <div className="bg-amber-50 border border-amber-500 p-3 text-amber-950 flex items-start gap-2">
                <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold">Checkout is being commissioned.</div>
                  <div className="mt-1 leading-relaxed text-[11px]">
                    {checkoutError || "Stripe test mode and settlement secrets are being configured on the server. Buying turns on once Stripe keys, order fulfillment, and payout splits all work together end to end."}
                  </div>
                  <div className="mt-2 text-[11px]">
                    Want it the moment it's live?{' '}
                    <a
                      href={`mailto:nate.mcguire@gmail.com?subject=${encodeURIComponent(`Notify me when I can buy ${app.name}`)}&body=${encodeURIComponent(`Ping me when checkout is live for ${app.name} (${app.id || ''}).`)}`}
                      className="font-bold underline text-w95-blue"
                    >
                      Notify me when buying is live →
                    </a>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end pt-2 border-t border-gray-300">
                <button
                  type="button"
                  onClick={() => { playClickSound(); onClose(); }}
                  className="btn-w95 px-5 py-1.5 text-xs font-bold"
                >
                  Close
                </button>
              </div>
            </div>
          )}

          {status === 'init' && (
            <div className="p-8 text-center space-y-3">
              <RefreshCw size={24} className="animate-spin text-w95-blue mx-auto" />
              <div className="font-bold text-gray-800 text-xs">Requesting authoritative quote from Lineage Ledger...</div>
              <div className="text-gray-500 text-[11px] font-mono">Verifying ancestry DAG and product price</div>
            </div>
          )}

          {(status === 'ready' || status === 'processing' || status === 'error') && (
            <form onSubmit={handlePay} className="space-y-3">
              <div className="bg-white border-2 border-t-black border-l-black border-b-white border-r-white p-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{app.creatorAvatar || app.authorAvatar || '🎯'}</span>
                  <div>
                    <div className="font-bold text-gray-900 text-sm">{app.name}</div>
                    <div className="text-gray-500 text-[11px] font-mono">{app.version} · Yours to keep: app, source, and license</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-bold font-mono text-base text-green-800">{formattedPrice}</div>
                  <div className="text-[10px] text-gray-500 font-mono">One-Time License</div>
                </div>
              </div>

              {quote && (
                <div className="bg-blue-50 border border-blue-300 p-2.5 rounded font-mono text-[11px] space-y-1">
                  <div className="font-bold text-blue-950 flex items-center gap-1">
                    <Sparkles size={12} className="text-amber-600" />
                    <span>Authoritative Lineage Split:</span>
                  </div>

                  {makerAlloc && (
                    <div className="flex justify-between text-gray-700">
                      <span>
                        ⚡ {(makerAlloc.basisPoints / 100).toFixed(0)}% to seller ({makerAlloc.recipientUserId ? `@${makerAlloc.recipientUserId}` : (app.creator || app.author || '@maker')}):
                      </span>
                      <span className="font-bold">${(makerAlloc.amountCents / 100).toFixed(2)}</span>
                    </div>
                  )}

                  {ancestorAllocs.map((anc, idx) => (
                    <div key={idx} className="flex justify-between text-gray-700">
                      <span>
                        💎 {(anc.basisPoints / 100).toFixed(0)}% to upstream maker ({anc.recipientUserId ? `@${anc.recipientUserId}` : `Depth ${anc.lineageDepth ?? idx + 1}`}):
                      </span>
                      <span className="font-bold">${(anc.amountCents / 100).toFixed(2)}</span>
                    </div>
                  ))}

                  {poolAlloc && (
                    <div className="flex justify-between text-gray-700">
                      <span>🛡️ {(poolAlloc.basisPoints / 100).toFixed(0)}% to platform:</span>
                      <span className="font-bold">${(poolAlloc.amountCents / 100).toFixed(2)}</span>
                    </div>
                  )}
                </div>
              )}

              <div className="bg-white border-2 border-t-black border-l-black border-b-white border-r-white p-3 min-h-[160px] relative">
                {!isStripeReady && status !== 'error' && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-10">
                    <div className="flex items-center gap-2 text-gray-600 font-mono text-xs">
                      <RefreshCw size={14} className="animate-spin text-w95-blue" />
                      <span>Loading secure card inputs...</span>
                    </div>
                  </div>
                )}
                <div ref={paymentContainerRef} id="payment-element" />
              </div>

              {checkoutError && (
                <div role="alert" className="bg-red-50 border border-red-600 p-2 text-red-900 text-xs">
                  {checkoutError}
                </div>
              )}

              <div className="bg-amber-50 border border-amber-300 px-2.5 py-2 text-[11px] text-amber-950 leading-relaxed">
                One-time purchase. Includes the listed version, source access, and license. All sales final except where required by law.
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-gray-300">
                <button
                  type="button"
                  onClick={() => { playClickSound(); onClose(); }}
                  disabled={status === 'processing'}
                  className="btn-w95 px-4 py-1 text-xs"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={status === 'processing' || !isStripeReady}
                  className="btn-w95 btn-w95-primary px-6 py-1.5 font-bold text-xs flex items-center gap-1.5 shadow-sm"
                >
                  {status === 'processing' ? (
                    <>
                      <RefreshCw size={13} className="animate-spin" />
                      <span>Confirming Payment...</span>
                    </>
                  ) : (
                    <>
                      <ShieldCheck size={14} />
                      <span>Pay {formattedPrice}</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}

          {status === 'polling' && (
            <div className="p-6 text-center space-y-4">
              <div className="w-12 h-12 bg-blue-100 border-2 border-w95-blue rounded-full flex items-center justify-center mx-auto text-w95-blue">
                <RefreshCw size={24} className="animate-spin" />
              </div>
              <div>
                <div className="font-bold text-gray-900 text-sm">Processing your payment…</div>
                <div className="text-gray-600 text-xs mt-1">
                  Confirming the charge, settling on the Lineage Ledger, and minting your license. This is usually quick.
                </div>
              </div>
              <div className="bg-gray-100 border border-gray-300 p-2 rounded text-[11px] font-mono text-gray-500">
                Polling order: {quote?.orderId}
              </div>
            </div>
          )}

          {status === 'fulfilled' && (
            <div className="space-y-4">
              <div className="bg-emerald-50 border-2 border-emerald-600 p-3.5 rounded flex items-center gap-3">
                <div className="w-10 h-10 bg-emerald-600 text-white rounded-full flex items-center justify-center shrink-0 shadow-sm">
                  <Check size={22} className="font-bold" />
                </div>
                <div>
                  <div className="font-bold text-emerald-950 text-sm">Purchase Complete &amp; Verified!</div>
                  <div className="text-emerald-800 text-[11px] mt-0.5">
                    {app.name} ({app.version}) is now owned on your permanent shelf.
                  </div>
                </div>
              </div>

              {fulfilledOrder?.license && (
                <div className="bg-white border-2 border-t-black border-l-black border-b-white border-r-white p-3 space-y-2">
                  <div className="flex items-center justify-between text-gray-700">
                    <span className="font-bold text-xs flex items-center gap-1">
                      <Lock size={12} className="text-amber-600" />
                      <span>Your Software License Key:</span>
                    </span>
                    <span className="text-[10px] font-mono bg-green-100 text-green-800 px-1.5 py-0.5 rounded font-bold">
                      ACTIVE
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={fulfilledOrder.license.licenseKey}
                      onFocus={(e) => e.target.select()}
                      className="flex-1 p-1.5 border border-gray-400 font-mono text-xs bg-gray-50 select-all font-bold text-gray-900"
                    />
                    <button
                      type="button"
                      onClick={() => handleCopyLicenseKey(fulfilledOrder.license!.licenseKey)}
                      className="btn-w95 btn-w95-primary px-3 py-1.5 text-xs font-bold flex items-center gap-1 shrink-0"
                    >
                      {isKeyCopied ? <Check size={12} /> : <Copy size={12} />}
                      <span>{isKeyCopied ? 'Copied!' : 'Copy'}</span>
                    </button>
                  </div>
                  <div className="text-[10px] text-gray-500 font-mono">
                    Order ID: {fulfilledOrder.id} · Stored securely on your shelf
                  </div>
                </div>
              )}

              {artifactLinks.length > 0 && (
                <div className="space-y-1.5">
                  <div className="font-bold text-gray-800 text-xs">Downloads &amp; Access:</div>
                  <div className="flex flex-wrap gap-2">
                    {artifactLinks.map(link => (
                      <a
                        key={link.kind}
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-w95 px-3 py-1 text-xs font-bold flex items-center gap-1 bg-white hover:bg-gray-100"
                      >
                        {link.kind === 'web' || link.kind === 'ios' ? <ExternalLink size={12} /> : <Download size={12} />}
                        <span>{link.label}</span>
                      </a>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end pt-2 border-t border-gray-300">
                <button
                  type="button"
                  onClick={() => { playClickSound(); onClose(); }}
                  className="btn-w95 btn-w95-primary px-6 py-1.5 text-xs font-bold"
                >
                  Done
                </button>
              </div>
            </div>
          )}

          {status === 'timeout' && (
            <div className="space-y-4">
              <div className="bg-amber-50 border-2 border-amber-500 p-3.5 rounded flex items-center gap-3">
                <RefreshCw size={28} className="text-amber-700 shrink-0" />
                <div>
                  <div className="font-bold text-amber-950 text-sm">Still confirming your order</div>
                  <div className="text-amber-900 text-[11px] mt-0.5 leading-relaxed">
                    We didn&apos;t get a confirmation back in time — this can happen when settlement is slow.
                    <strong> If your card was charged, the license shows up on your Shelf.</strong>
                    {' '}If your Shelf is still empty after a few minutes, email us with this order id — please do not pay twice.
                    <span className="block font-mono mt-1">Order id: {quote?.orderId}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-gray-300 gap-2">
                <button
                  type="button"
                  onClick={() => { playClickSound(); refreshShelf(); }}
                  className="btn-w95 px-4 py-1.5 text-xs font-bold flex items-center gap-1.5 bg-white hover:bg-gray-100"
                >
                  <RefreshCw size={12} /> Refresh my Shelf
                </button>
                <button
                  type="button"
                  onClick={() => { playClickSound(); onClose(); }}
                  className="btn-w95 btn-w95-primary px-6 py-1.5 text-xs font-bold"
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </Win95Scroll>
      </div>
    </div>
  );
};
