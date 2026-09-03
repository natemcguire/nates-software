import React from 'react';
import { useAuth } from '../context/AuthContext';
import { LogIn, LogOut } from 'lucide-react';
import { playClickSound } from '../lib/soundEngine';

interface AccountWidgetProps {
  className?: string;
  showGreeting?: boolean;
}

export const AccountWidget: React.FC<AccountWidgetProps> = ({
  className = '',
  showGreeting = true
}) => {
  const { user, isAuthenticated, isSuperAdmin, authLoading, openAuthModal, logout } = useAuth();

  return (
    <div
      data-testid="account-widget"
      className={`h-8 px-2.5 bg-[#c0c0c0] text-black border-2 border-gray-500 border-r-white border-b-white flex items-center gap-1.5 font-mono text-[13px] select-none ${className}`}
    >
      {authLoading ? (
        // Don't flash the logged-out buttons before the session check resolves —
        // show a neutral placeholder so it never flickers logged-out → logged-in.
        <span className="text-gray-500 flex items-center gap-1.5 px-1">
          <span className="inline-block w-3 h-3 rounded-full border-2 border-gray-400 border-t-transparent animate-spin" />
          <span className="hidden sm:inline">Loading…</span>
        </span>
      ) : isAuthenticated && user ? (
        <div className="flex items-center gap-1.5">
          {showGreeting && (
            <span className="text-gray-700 font-sans hidden sm:inline">
              Welcome back,
            </span>
          )}
          <span className="text-sm">{user.avatar || '👤'}</span>
          <span className="font-bold text-blue-900">
            {`@${user.displayName || user.username}`}
          </span>
          {isSuperAdmin && (
            <span className="bg-amber-100 text-amber-900 border border-amber-400 px-1 py-0.2 rounded text-[9px] font-bold">
              ADMIN
            </span>
          )}
          <button
            onClick={() => {
              playClickSound();
              logout();
            }}
            className="text-gray-500 hover:text-red-700 ml-1 p-0.5"
            title="Log Out"
            aria-label="Log Out"
          >
            <LogOut size={12} />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1">
          <button
            onClick={() => openAuthModal('login')}
            className="px-2 py-0.5 font-bold text-blue-900 bg-white hover:bg-blue-50 border border-gray-400 rounded flex items-center gap-1 text-[10px]"
          >
            <LogIn size={10} />
            <span>Log In</span>
          </button>
          <button
            onClick={() => openAuthModal('register')}
            className="px-2 py-0.5 font-bold text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-400 rounded text-[10px]"
          >
            Create account
          </button>
        </div>
      )}
    </div>
  );
};
