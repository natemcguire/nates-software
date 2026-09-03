import { AccountWidget } from './AccountWidget';
import React, { useState } from 'react';
import { Volume2, VolumeX, ShieldCheck, ZoomIn } from 'lucide-react';
import { toggleSound, isSoundEnabled, playClickSound } from '../lib/soundEngine';

export interface TaskbarTab {
  id: string;
  title: string;
  icon: string;
  isActive: boolean;
  onClick: () => void;
}

interface DesktopTaskbarProps {
  tabs: TaskbarTab[];
  onStartClick: () => void;
  displayScale?: number;
  onCycleScale?: () => void;
}

export const DesktopTaskbar: React.FC<DesktopTaskbarProps> = ({
  tabs,
  onStartClick,
  displayScale = 1.0,
  onCycleScale
}) => {
  const [soundOn, setSoundOn] = useState(isSoundEnabled());

  const handleToggleSound = () => {
    const next = toggleSound();
    setSoundOn(next);
    if (next) playClickSound();
  };

  const scalePercent = Math.round(displayScale * 100);

  return (
    <div className="fixed bottom-0 left-0 right-0 h-10 bg-[#c0c0c0] border-t-2 border-white flex items-center px-1.5 select-none z-50 shadow-md font-tahoma text-xs">
      {/* Start Button */}
      <button
        onClick={() => { playClickSound(); onStartClick(); }}
        className="h-7 px-3.5 flex items-center gap-1.5 font-bold border-2 border-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0] active:border-gray-800 hover:bg-gray-100"
      >
        <span className="text-base">⚡</span>
        <span>Start</span>
      </button>

      <div className="w-[2px] h-6 bg-gray-400 border-r border-white mx-2" />

      {/* Running Taskbar Buttons */}
      <div className="flex-1 flex gap-1 overflow-x-auto h-7">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => { playClickSound(); tab.onClick(); }}
            className={`px-3 max-w-[170px] truncate text-xs flex items-center gap-1 border-2 text-left ${
              tab.isActive
                ? 'bg-gray-200 border-gray-800 border-r-white border-b-white font-bold'
                : 'bg-[#c0c0c0] border-white border-r-gray-800 border-b-gray-800'
            }`}
          >
            <span className="text-sm">{tab.icon}</span>
            <span className="truncate">{tab.title}</span>
          </button>
        ))}
      </div>

      {/* Account / Login Widget */}
      <AccountWidget className="mr-1" />

      {/* System Tray (Scale / Audio / Clock / Status) — sized up for laptop legibility */}
      <div className="h-8 px-3 bg-[#c0c0c0] border-2 border-gray-500 border-r-white border-b-white flex items-center gap-3">
        {/* Scale Switcher Button */}
        {onCycleScale && (
          <button
            onClick={() => { playClickSound(); onCycleScale(); }}
            className="hover:scale-105 transition-transform flex items-center gap-1 text-[13px] font-mono font-bold bg-white/60 px-2 py-0.5 rounded border border-gray-400 text-blue-900 shadow-sm"
            title={`Current View Zoom: ${scalePercent}%. Click to cycle scale (100% -> 115% -> 130%)`}
          >
            <ZoomIn size={14} />
            <span>{scalePercent}%</span>
          </button>
        )}

        <button
          onClick={handleToggleSound}
          className="hover:scale-110 transition-transform text-gray-700"
          title={soundOn ? "Sound Effects Enabled (Click to Mute)" : "Sound Effects Muted (Click to Unmute)"}
        >
          {soundOn ? <Volume2 size={17} className="text-blue-900" /> : <VolumeX size={17} className="text-gray-500" />}
        </button>

        <span title="Portable Software & Storage Freedom" className="flex items-center">
          <ShieldCheck size={17} className="text-green-700" />
        </span>

        <span className="font-mono text-[13px] font-bold text-gray-800">
          {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </div>
  );
};
