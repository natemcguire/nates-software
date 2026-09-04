import { AccountWidget } from './AccountWidget';
import React, { useState } from 'react';
import { Volume2, VolumeX, ShieldCheck } from 'lucide-react';
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
}

export const DesktopTaskbar: React.FC<DesktopTaskbarProps> = ({
  tabs,
  onStartClick
}) => {
  const [soundOn, setSoundOn] = useState(isSoundEnabled());

  const handleToggleSound = () => {
    const next = toggleSound();
    setSoundOn(next);
    if (next) playClickSound();
  };

  return (
    <div
      className="desktop-taskbar fixed bottom-0 left-0 right-0 h-10 border-t-2 flex items-center px-1.5 select-none z-50 shadow-md font-tahoma text-xs"
      style={{
        backgroundColor: 'var(--nsw-taskbar-bg, #c0c0c0)',
        borderTopColor: 'var(--nsw-border-light, #ffffff)',
        color: 'var(--nsw-taskbar-text, #000000)'
      }}
    >
      <button
        onClick={() => { playClickSound(); onStartClick(); }}
        className="h-7 px-3.5 flex items-center gap-1.5 font-bold border-2 active:border-gray-800"
        style={{
          backgroundColor: 'var(--nsw-btn-bg, #c0c0c0)',
          color: 'var(--nsw-btn-text, #000000)',
          borderColor: 'var(--nsw-border-light, #ffffff) var(--nsw-border-dark, #404040) var(--nsw-border-dark, #404040) var(--nsw-border-light, #ffffff)'
        }}
      >
        <span className="text-base">⚡</span>
        <span>Start</span>
      </button>

      <div
        className="w-[2px] h-6 border-r mx-2"
        style={{
          backgroundColor: 'var(--nsw-border-shadow, #808080)',
          borderRightColor: 'var(--nsw-border-light, #ffffff)'
        }}
      />

      <div className="flex-1 flex gap-1 overflow-x-auto h-7">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => { playClickSound(); tab.onClick(); }}
            className={`px-3 max-w-[170px] truncate text-xs flex items-center gap-1 border-2 text-left ${
              tab.isActive ? 'font-bold' : ''
            }`}
            style={{
              backgroundColor: tab.isActive
                ? 'var(--nsw-taskbar-tab-active-bg, #dfdfdf)'
                : 'var(--nsw-taskbar-tab-inactive-bg, #c0c0c0)',
              color: 'var(--nsw-taskbar-text, #000000)',
              borderColor: tab.isActive
                ? 'var(--nsw-border-dark, #404040) var(--nsw-border-light, #ffffff) var(--nsw-border-light, #ffffff) var(--nsw-border-dark, #404040)'
                : 'var(--nsw-border-light, #ffffff) var(--nsw-border-dark, #404040) var(--nsw-border-dark, #404040) var(--nsw-border-light, #ffffff)'
            }}
          >
            <span className="text-sm">{tab.icon}</span>
            <span className="truncate">{tab.title}</span>
          </button>
        ))}
      </div>

      <AccountWidget className="mr-1" />

      <div
        className="h-8 px-3 border-2 flex items-center gap-3"
        style={{
          backgroundColor: 'var(--nsw-taskbar-bg, #c0c0c0)',
          borderColor: 'var(--nsw-border-shadow, #808080) var(--nsw-border-light, #ffffff) var(--nsw-border-light, #ffffff) var(--nsw-border-shadow, #808080)',
          color: 'var(--nsw-taskbar-text, #000000)'
        }}
      >
        <button
          onClick={handleToggleSound}
          className="hover:scale-110 transition-transform"
          style={{ color: 'var(--nsw-taskbar-text, #000000)' }}
          title={soundOn ? "Sound Effects Enabled (Click to Mute)" : "Sound Effects Muted (Click to Unmute)"}
        >
          {soundOn ? <Volume2 size={17} className="text-blue-900" /> : <VolumeX size={17} className="text-gray-500" />}
        </button>

        <span title="Portable Software & Storage Freedom" className="flex items-center">
          <ShieldCheck size={17} className="text-green-700" />
        </span>

        <span className="font-mono text-[13px] font-bold" style={{ color: 'var(--nsw-taskbar-text, #000000)' }}>
          {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </div>
  );
};
