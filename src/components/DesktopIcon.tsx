import React from 'react';

interface DesktopIconProps {
  icon: string;
  label: string;
  onClick: () => void;
  badge?: string;
}

export const DesktopIcon: React.FC<DesktopIconProps> = ({ icon, label, onClick, badge }) => {
  return (
    <div
      onClick={onClick}
      className="group flex flex-col items-center justify-center p-2.5 rounded cursor-pointer select-none text-center hover:bg-blue-900/50 border border-transparent hover:border-yellow-200/60 transition-all w-28 relative"
    >
      <div className="text-5xl filter drop-shadow-md group-hover:scale-105 transition-transform mb-1">
        {icon}
      </div>
      <div className="text-white text-xs font-bold text-shadow px-1.5 py-0.5 rounded line-clamp-2 leading-snug">
        {label}
      </div>
      {badge && (
        <span className="absolute top-1 right-2 bg-red-600 text-white text-[11px] font-bold px-2 py-0.5 rounded-full border border-white shadow">
          {badge}
        </span>
      )}
    </div>
  );
};
