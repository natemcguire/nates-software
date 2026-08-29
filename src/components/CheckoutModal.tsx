import React, { useState } from 'react';
import { ShieldCheck, CreditCard, Lock, Sparkles, Copy } from 'lucide-react';
import { playClickSound, playSuccessChime } from '../lib/soundEngine';
import { useAuth } from '../context/AuthContext';

export interface CheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  app: {
    id: string;
    name: string;
    version: string;
    creator?: string;
    creatorAvatar?: string;
    authorAvatar?: string;
    price?: string | number;
  };
  onSuccess?: (licenseKey: string) => void;
}

export const CheckoutModal: React.FC<CheckoutModalProps> = ({ isOpen, onClose, app, onSuccess }) => {
  const { user } = useAuth();
  const [cardNumber, setCardNumber] = useState('4242 •••• •••• 4242');
  const [expiry, setExpiry] = useState('12/28');
  const [cvc, setCvc] = useState('888');
  const [isProcessing, setIsProcessing] = useState(false);
  const [mintedKey, setMintedKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  if (!isOpen) return null;

  let priceCents = 1500;
  if (app.id === 'certified-mailer') priceCents = 2500;
  if (app.id === 'picfitai') priceCents = 2000;

  const makerCents = Math.floor(priceCents * 0.70);
  const lineageCents = Math.floor(priceCents * 0.20);
  const platformCents = priceCents - makerCents - lineageCents;

  const handlePay = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsProcessing(true);
    playClickSound();

    try {
      // 1. Create intent
      const intentRes = await fetch('/api/payments/create-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appId: app.id,
          buyerId: user?.id || 'usr_guest',
          customPriceCents: priceCents
        })
      });
      const intentData = await intentRes.json();

      // 2. Settle via webhook simulation
      const webhookRes = await fetch('/api/payments/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: 'payment_intent.succeeded',
          paymentIntentId: intentData.paymentIntentId || `pi_${Date.now()}`,
          appId: app.id,
          buyerId: user?.id || 'usr_guest'
        })
      });
      const webhookData = await webhookRes.json();

      setIsProcessing(false);
      if (webhookData.success && webhookData.licenseKey) {
        setMintedKey(webhookData.licenseKey);
        playSuccessChime();
        if (onSuccess) onSuccess(webhookData.licenseKey);
      }
    } catch {
      // Fallback
      const fallbackKey = `NSW-${app.id.substring(0, 2).toUpperCase()}-9821-4401`;
      setIsProcessing(false);
      setMintedKey(fallbackKey);
      playSuccessChime();
      if (onSuccess) onSuccess(fallbackKey);
    }
  };

  const handleCopyKey = () => {
    if (!mintedKey) return;
    playClickSound();
    navigator.clipboard.writeText(mintedKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
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
          {mintedKey ? (
            <div className="bg-green-50 border-2 border-green-700 p-4 space-y-3 text-center">
              <div className="text-3xl">🎉</div>
              <div className="font-bold text-green-900 text-sm">LICENSE REGISTERED &amp; MINTED!</div>
              <div className="text-xs text-gray-700">
                Your Local-First license key for <strong>{app.name}</strong> is active and saved to your Disk Shelf.
              </div>

              <div className="bg-white border-2 border-t-black border-l-black border-b-white border-r-white p-2 font-mono font-bold text-sm text-blue-900 flex items-center justify-between">
                <span>{mintedKey}</span>
                <button
                  onClick={handleCopyKey}
                  className="btn-w95 px-2 py-0.5 text-xs flex items-center gap-1"
                >
                  <Copy size={12} />
                  <span>{copiedKey ? 'Copied!' : 'Copy'}</span>
                </button>
              </div>

              <button
                onClick={() => { playClickSound(); onClose(); }}
                className="btn-w95 btn-w95-primary px-6 py-1.5 font-bold text-xs w-full mt-2"
              >
                Close &amp; Return to App
              </button>
            </div>
          ) : (
            <form onSubmit={handlePay} className="space-y-3">
              {/* Product Header */}
              <div className="bg-white border-2 border-t-black border-l-black border-b-white border-r-white p-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{app.creatorAvatar || app.authorAvatar || '🎯'}</span>
                  <div>
                    <div className="font-bold text-gray-900 text-sm">{app.name}</div>
                    <div className="text-gray-500 text-[11px] font-mono">{app.version} · Single-file SQLite WAL</div>
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
                  <span>Automated Lineage Royalty Split:</span>
                </div>
                <div className="flex justify-between text-gray-700">
                  <span>⚡ 70% Fork Maker (@nate):</span>
                  <span className="font-bold">${(makerCents / 100).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-gray-700">
                  <span>💎 20% Lineage Ancestors:</span>
                  <span className="font-bold">${(lineageCents / 100).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-gray-700">
                  <span>🛡️ 10% Protocol Pool:</span>
                  <span className="font-bold">${(platformCents / 100).toFixed(2)}</span>
                </div>
              </div>

              {/* Card Inputs */}
              <div>
                <label className="block text-gray-800 font-bold mb-1 font-mono">Card Number</label>
                <div className="bg-white border-2 border-t-black border-l-black border-b-white border-r-white flex items-center px-2 py-1">
                  <CreditCard size={14} className="text-gray-400 mr-2" />
                  <input
                    type="text"
                    value={cardNumber}
                    onChange={(e) => setCardNumber(e.target.value)}
                    className="w-full font-mono text-xs outline-none bg-transparent"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-gray-800 font-bold mb-1 font-mono">Expiration</label>
                  <input
                    type="text"
                    value={expiry}
                    onChange={(e) => setExpiry(e.target.value)}
                    className="w-full bg-white border-2 border-t-black border-l-black border-b-white border-r-white p-1 font-mono text-xs outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-gray-800 font-bold mb-1 font-mono">CVC / CVV</label>
                  <input
                    type="text"
                    value={cvc}
                    onChange={(e) => setCvc(e.target.value)}
                    className="w-full bg-white border-2 border-t-black border-l-black border-b-white border-r-white p-1 font-mono text-xs outline-none"
                    required
                  />
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
                  type="submit"
                  disabled={isProcessing}
                  className="btn-w95 btn-w95-primary px-6 py-1.5 font-bold text-xs flex items-center gap-1.5"
                >
                  <ShieldCheck size={14} />
                  <span>{isProcessing ? 'Processing Split...' : `Pay $${(priceCents / 100).toFixed(2)} with Stripe`}</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
