import React from 'react';
import { AppListing } from '../data/mockData';
import { ExternalLink, Shield } from 'lucide-react';
import { playClickSound } from '../lib/soundEngine';

interface EphemeralLiveAppProps {
  app: AppListing;
}

export const EphemeralLiveApp: React.FC<EphemeralLiveAppProps> = ({ app }) => {
  const liveUrl = `https://${app.id}.nates-software.com`;

  return (
    <div className="h-full flex flex-col bg-[#ece9d8] font-tahoma text-xs overflow-hidden">
      {/* Top Header Bar */}
      <div className="bg-gradient-to-r from-gray-900 via-blue-950 to-gray-900 text-white p-2 flex items-center justify-between border-b-2 border-gray-700 flex-wrap gap-2 shadow-sm select-none">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse" />
          <span className="font-bold text-xs">{app.name} Live Sandbox</span>
          <span className="text-gray-400 font-mono text-[11px]">({app.version})</span>
        </div>

        <div className="flex items-center gap-3 font-mono text-[11px]">
          <span className="bg-yellow-100 text-yellow-900 px-2 py-0.5 rounded border border-yellow-300 flex items-center gap-1 font-bold">
            <Shield size={11} /> 2 / 10 Max Sessions
          </span>
          <a
            href={liveUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => playClickSound()}
            className="bg-blue-900 hover:bg-blue-800 text-cyan-300 hover:text-white px-2.5 py-1 rounded text-[11px] font-mono transition-colors flex items-center gap-1 border border-blue-600 shadow-sm font-bold"
          >
            <span>{app.id}.nates-software.com</span>
            <ExternalLink size={11} />
          </a>
        </div>
      </div>

      {/* Main Viewport */}
      <div className="flex-1 bg-white p-2 overflow-hidden flex flex-col">
        {app.id === 'dronehunter' ? (
          <div className="flex-1 bg-black border-2 border-gray-800 rounded overflow-hidden relative">
            <iframe
              src="/dronehunter-game/index.html"
              title="Drone Hunter Arcade Game"
              className="w-full h-full border-0 absolute inset-0"
              allow="autoplay; fullscreen"
            />
          </div>
        ) : app.id === 'certified-mailer' ? (
          <div className="flex-1 bg-slate-900 text-slate-100 rounded border-2 border-slate-700 p-4 font-mono overflow-y-auto space-y-4">
            <div className="border-b border-slate-700 pb-3 flex items-center justify-between">
              <div>
                <div className="font-bold text-sm text-sky-400">📫 Certified Mailer CLI &amp; Electronic Return Receipt</div>
                <div className="text-[11px] text-slate-400">USPS Certified Mail Manifest &amp; PDF Dispute Letter Engine</div>
              </div>
              <a
                href={liveUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-sky-600 hover:bg-sky-500 text-white px-3 py-1 rounded text-xs font-bold flex items-center gap-1"
              >
                <span>Launch Web Portal</span>
                <ExternalLink size={12} />
              </a>
            </div>

            <div className="bg-slate-950 p-3 rounded border border-slate-800 space-y-2 text-xs">
              <div className="text-emerald-400 font-bold">$ certified-mailer generate-manifest --fcra-623 --account "CHASE-9812"</div>
              <div className="text-slate-400">✔ Generated 60-day dispute letter manifest: private/dispute-chase.docx</div>
              <div className="text-slate-400">✔ Flattened to 300 DPI high-precision raster PDF (0 layout skew)</div>
              <div className="text-slate-400">✔ USPS Electronic Return Receipt (ERR) barcode: 9407 1118 9956 2210 4401 22</div>
            </div>
          </div>
        ) : (
          <div className="flex-1 bg-gradient-to-b from-gray-50 to-pink-50/20 border-2 border-gray-400 rounded p-6 flex flex-col justify-between overflow-y-auto font-sans">
            <div className="space-y-4 max-w-xl mx-auto w-full text-center">
              <div className="text-4xl">✨</div>
              <div className="font-bold text-base text-gray-900">{app.name}</div>
              <p className="text-xs text-gray-600 leading-relaxed">{app.description}</p>
              
              <div className="pt-4">
                <a
                  href={liveUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-w95 btn-w95-primary px-6 py-2 text-sm font-bold inline-flex items-center gap-2"
                >
                  <ExternalLink size={14} /> Open {app.id}.nates-software.com
                </a>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
