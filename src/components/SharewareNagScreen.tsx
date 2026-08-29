import React, { useState } from 'react';
import { ShieldCheck, Key, AlertTriangle } from 'lucide-react';
import { playClickSound, playSuccessChime } from '../lib/soundEngine';
import { validateLicenseKey, saveStoredLicense } from '../lib/sharewareSdk';

export interface SharewareNagScreenProps {
  appName: string;
  appId: string;
  version?: string;
  priceCents: number;
  runsRemaining: number;
  onUnlockWithKey: (key: string) => void;
  onOpenCheckout: () => void;
}

export const SharewareNagScreen: React.FC<SharewareNagScreenProps> = ({
  appName,
  appId,
  version = 'v1.0.0',
  priceCents,
  runsRemaining,
  onUnlockWithKey,
  onOpenCheckout
}) => {
  const [manualKey, setManualKey] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleApplyKey = (e: React.FormEvent) => {
    e.preventDefault();
    playClickSound();
    if (validateLicenseKey(manualKey, appId)) {
      saveStoredLicense(appId, manualKey);
      playSuccessChime();
      onUnlockWithKey(manualKey);
    } else {
      setErrorMsg('Invalid cryptographic license format (expected NSW-XX-XXXX-XXXX)');
    }
  };

  return (
    <div className="bg-w95-gray border-2 border-t-white border-l-white border-b-black border-r-black p-4 font-tahoma text-xs max-w-lg mx-auto shadow-2xl space-y-4 select-none">
      {/* Title Bar */}
      <div className="bg-[#000080] text-white px-2 py-1 flex items-center justify-between font-bold text-xs">
        <div className="flex items-center gap-1.5">
          <AlertTriangle size={13} className="text-yellow-300" />
          <span>SHAREWARE REGISTRATION REMINDER — EPISODE 1</span>
        </div>
        <span className="font-mono text-[10px] bg-blue-900 px-1 py-0.5 rounded">{version}</span>
      </div>

      <div className="bg-white border-2 border-t-black border-l-black border-b-white border-r-white p-3 space-y-3">
        <div className="flex items-center gap-3 border-b border-gray-200 pb-3">
          <div className="text-3xl">💾</div>
          <div>
            <div className="font-bold text-sm text-gray-900">{appName} Shareware Edition</div>
            <div className="text-gray-500 text-[11px]">
              {runsRemaining > 0 ? (
                <span className="text-amber-700 font-bold">Evaluation Period: {runsRemaining} Free Runs Remaining</span>
              ) : (
                <span className="text-red-700 font-bold">Trial Quota Expired — Registration Required</span>
              )}
            </div>
          </div>
        </div>

        <p className="text-gray-700 leading-relaxed text-xs">
          Thank you for trying <strong>{appName}</strong>. Shareware relies on your direct patronage. Registering your Local-First license removes this nag screen, unlocks unlimited execution, and directs <strong>70%</strong> to the maker and <strong>20%</strong> to ancestor developers.
        </p>

        {/* Purchase Action Banner */}
        <div className="bg-blue-50 border border-blue-300 p-3 rounded flex items-center justify-between">
          <div>
            <div className="font-bold text-blue-950 text-xs">Register Single-Seat License</div>
            <div className="text-gray-600 text-[11px] font-mono">${(priceCents / 100).toFixed(2)} · One-Time Lifetime License</div>
          </div>
          <button
            onClick={() => { playClickSound(); onOpenCheckout(); }}
            className="btn-w95 btn-w95-primary px-4 py-1.5 font-bold text-xs flex items-center gap-1 shadow-sm"
          >
            <ShieldCheck size={13} />
            <span>Register (${(priceCents / 100).toFixed(2)})</span>
          </button>
        </div>

        {/* Existing Key Input */}
        <form onSubmit={handleApplyKey} className="space-y-1 pt-2 border-t border-gray-200 font-mono text-[11px]">
          <label className="block text-gray-700 font-bold">Already have a License Key?</label>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="NSW-DH-9812-77F2"
              value={manualKey}
              onChange={(e) => { setManualKey(e.target.value); setErrorMsg(''); }}
              className="flex-1 bg-white border border-gray-400 p-1 text-xs outline-none uppercase font-mono"
            />
            <button type="submit" className="btn-w95 px-3 py-1 font-bold text-xs flex items-center gap-1">
              <Key size={12} />
              <span>Unlock</span>
            </button>
          </div>
          {errorMsg && <div className="text-red-600 text-[10px] font-sans font-bold">{errorMsg}</div>}
        </form>
      </div>
    </div>
  );
};
