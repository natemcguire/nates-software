import React, { useState, useEffect } from 'react';

interface TaskbarTab {
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

export const DesktopTaskbar: React.FC<DesktopTaskbarProps> = ({ tabs, onStartClick }) => {
  const [timeStr, setTimeStr] = useState('');

  useEffect(() => {
    const updateTime = () => {
      const d = new Date();
      setTimeStr(d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="fixed bottom-0 left-0 right-0 h-11 bg-w95-gray border-t-2 border-white flex items-center justify-between px-2 z-50 select-none font-tahoma">
      {/* Start Button & Active Tasks */}
      <div className="flex items-center gap-2 flex-1 overflow-x-auto">
        <button
          onClick={onStartClick}
          className="btn-w95 flex items-center gap-1.5 px-3.5 py-1.5 font-bold text-sm bg-w95-gray active:translate-x-0.5 shadow-sm"
        >
          <span className="text-lg">🪟</span>
          <span className="text-[14px]">Start</span>
        </button>

        {/* Task Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={tab.onClick}
              className={`flex items-center gap-2 px-3.5 py-1.5 text-xs font-bold truncate max-w-[220px] border-2 ${
                tab.isActive
                  ? 'bg-w95-panel border-gray-700 border-r-white border-b-white'
                  : 'bg-w95-gray border-white border-r-gray-700 border-b-gray-700'
              }`}
            >
              <span className="text-sm">{tab.icon}</span>
              <span className="truncate text-[13px]">{tab.title}</span>
            </button>
          ))}
        </div>
      </div>

      {/* System Tray */}
      <div className="flex items-center gap-3.5 px-3.5 py-1 bg-w95-panel w95-border-sunken text-xs font-bold">
        <span>🔊</span>
        <span className="text-w95-blue">⚡ 5 Engines Active</span>
        <span className="text-gray-900 font-mono text-[13px]">{timeStr || '1:30 PM'}</span>
      </div>
    </div>
  );
};
