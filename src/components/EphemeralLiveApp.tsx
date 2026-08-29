import React from 'react';
import { AppListing } from '../data/mockData';
import { ExternalLink, Shield } from 'lucide-react';
import { playClickSound } from '../lib/soundEngine';
import { CertifiedMailerStudio } from './CertifiedMailerStudio';
import { PicFitStudio } from './PicFitStudio';
import { WallArtStudio } from './WallArtStudio';

interface EphemeralLiveAppProps {
  app: AppListing;
}

export const EphemeralLiveApp: React.FC<EphemeralLiveAppProps> = ({ app }) => {
  const liveUrl = app.id === 'dronehunter'
    ? undefined
    : `https://${app.id}.nates-software.com`;

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
          {app.id === 'wallart' ? (
            <span className="bg-emerald-950 text-emerald-300 px-2 py-0.5 rounded border border-emerald-600 flex items-center gap-1 font-bold">
              <Shield size={11} /> Client-Side Sandbox
            </span>
          ) : (
            <span className="bg-yellow-100 text-yellow-900 px-2 py-0.5 rounded border border-yellow-300 flex items-center gap-1 font-bold">
              <Shield size={11} /> {app.id === 'dronehunter' ? 'Local browser session' : '2 / 10 Max Sessions'}
            </span>
          )}
          {liveUrl && <a
            href={liveUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => playClickSound()}
            className="bg-blue-900 hover:bg-blue-800 text-cyan-300 hover:text-white px-2.5 py-1 rounded text-[11px] font-mono transition-colors flex items-center gap-1 border border-blue-600 shadow-sm font-bold"
          >
            <span>Open published app</span>
            <ExternalLink size={11} />
          </a>}
        </div>
      </div>

      {/* Main Viewport */}
      <div className="flex-1 bg-white overflow-hidden flex flex-col">
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
          <div className="flex-1 overflow-hidden">
            <CertifiedMailerStudio />
          </div>
        ) : app.id === 'picfitai' ? (
          <div className="flex-1 overflow-hidden">
            <PicFitStudio />
          </div>
        ) : app.id === 'wallart' ? (
          <div className="flex-1 overflow-hidden">
            <WallArtStudio />
          </div>
        ) : (
          <div className="flex-1 bg-[#ece9d8] p-8 flex flex-col items-center justify-center text-center font-tahoma">
            <div className="bg-w95-gray border-2 border-t-white border-l-white border-b-black border-r-black p-6 max-w-md shadow-md">
              <div className="text-2xl mb-2">⚠️</div>
              <h2 className="font-bold text-sm text-gray-900 mb-2">Application Sandbox Unavailable</h2>
              <p className="text-xs text-gray-700 mb-4">
                No interactive sandbox runner is registered for &quot;{app.name}&quot; ({app.id}).
              </p>
              <div className="bg-white border border-gray-400 p-2 text-[11px] font-mono text-gray-600 text-left">
                Status: UNREGISTERED_SANDBOX_RUNTIME<br />
                App ID: {app.id}<br />
                Version: {app.version}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
