import React, { useState } from 'react';
import { ShieldCheck, Lock, Sparkles, AlertTriangle } from 'lucide-react';
import { playClickSound } from '../lib/soundEngine';

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

export const CheckoutModal: React.FC<CheckoutModalProps> = ({ isOpen, onClose, app }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  if (!isOpen) return null;

  let priceCents = 1500;
  if (app.id === 'certified-mailer') priceCents = 2500;
  if (app.id === 'american-gardener') priceCents = 2500;
  if (app.id === 'wallart') priceCents = 5900;

  // Root/original apps (no ancestors) split 90% maker / 10% platform — there's no
  // "forked from" app to pay. Forks split 70/20/10. This mirrors the real ledger
  // (calculateAllocations): a root app's unused 20% lineage returns to the maker.
  const isFork = (app.forkDepth ?? 0) > 0;
  const platformCents = Math.floor(priceCents * 0.10);
  const lineageCents = isFork ? Math.floor(priceCents * 0.20) : 0;
  const makerCents = priceCents - lineageCents - platformCents;

  const handlePay = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsProcessing(true);
    setCheckoutError(null);
    playClickSound();

    try {
      const intentRes = await fetch('/api/payments/create-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: app.id })
      });
      const intentData = await intentRes.json();
      setIsProcessing(false);
      if (!intentRes.ok || !intentData.success) {
        setCheckoutError(intentData.error || 'Checkout is currently unavailable.');
        return;
      }
      setCheckoutError('Secure Stripe payment element is not yet available. No charge was made.');
    } catch (error: any) {
      setIsProcessing(false);
      setCheckoutError(error?.message || 'Checkout network request failed. No charge was made.');
    }
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-xs select-none p-4 font-tahoma text-xs">
      <div className="w-full max-w-md bg-w95-gray border-2 border-t-white border-l-white border-b-black border-r-black shadow-2xl p-1">
        {/* Title bar */}
        <div className="bg-[#000080] text-white px-2 py-1 flex items-center justify-between font-bold text-xs">
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

        <div className="p-4 bg-w95-gray space-y-4">
          <form onSubmit={handlePay} className="space-y-3">
              {/* Product Header */}
              <div className="bg-white border-2 border-t-black border-l-black border-b-white border-r-white p-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{app.creatorAvatar || app.authorAvatar || '🎯'}</span>
                  <div>
                    <div className="font-bold text-gray-900 text-sm">{app.name}</div>
                    <div className="text-gray-500 text-[11px] font-mono">{app.version} · Yours to keep: app, source, and license</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-bold font-mono text-base text-green-800">${(priceCents / 100).toFixed(2)}</div>
                  <div className="text-[10px] text-gray-500">One-Time License</div>
                </div>
              </div>

              {/* 70/20/10 Lineage Breakdown */}
              <div className="bg-blue-50 border border-blue-300 p-2.5 rounded font-mono text-[11px] space-y-1">
                <div className="font-bold text-blue-950 flex items-center gap-1">
                  <Sparkles size={12} className="text-amber-600" />
                  <span>Where your money goes:</span>
                </div>
                <div className="flex justify-between text-gray-700">
                  <span>⚡ {isFork ? '70%' : '90%'} to the maker ({app.creator || app.author ? `@${app.creator || app.author}` : '@nate'}):</span>
                  <span className="font-bold">${(makerCents / 100).toFixed(2)}</span>
                </div>
                {isFork && (
                  <div className="flex justify-between text-gray-700">
                    <span>💎 20% to the apps it was forked from:</span>
                    <span className="font-bold">${(lineageCents / 100).toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-gray-700">
                  <span>🛡️ 10% to the platform:</span>
                  <span className="font-bold">${(platformCents / 100).toFixed(2)}</span>
                </div>
              </div>

              <div className="bg-amber-50 border border-amber-500 p-3 text-amber-950 flex items-start gap-2">
                <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold">Checkout is being commissioned.</div>
                  <div className="mt-1 leading-relaxed">
                    We don't take card details here yet. Buying turns on once Stripe checkout, your order,
                    license delivery, and the payout split all work together end to end.
                  </div>
                </div>
              </div>

              {checkoutError && (
                <div role="alert" className="bg-red-50 border border-red-600 p-2 text-red-900">
                  {checkoutError}
                </div>
              )}

              <div className="flex items-center justify-between pt-2 border-t border-gray-300">
                <button
                  type="button"
                  onClick={() => { playClickSound(); onClose(); }}
                  className="btn-w95 px-4 py-1 text-xs"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={isProcessing}
                  className="btn-w95 btn-w95-primary px-6 py-1.5 font-bold text-xs flex items-center gap-1.5"
                >
                  <ShieldCheck size={14} />
                  <span>{isProcessing ? 'Checking...' : 'Check checkout availability'}</span>
                </button>
              </div>
          </form>
        </div>
      </div>
    </div>
  );
};
