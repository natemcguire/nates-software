import React from 'react';
import { AppListing } from '../data/mockData';
import { ExternalLink, Shield } from 'lucide-react';
import { playClickSound } from '../lib/soundEngine';
import { CertifiedMailerStudio } from './CertifiedMailerStudio';
import { PicFitStudio } from './PicFitStudio';

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
        ) : (
          <div className="flex-1 overflow-hidden">
            <PicFitStudio />
          </div>
        )}
      </div>
    </div>
  );
};
