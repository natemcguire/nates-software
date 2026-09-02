import React from 'react';
import { Flame, Wrench, Mail, BookOpen, HelpCircle, Power, Gauge, User, Terminal, MessageSquare, LogIn, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { playClickSound } from '../lib/soundEngine';

interface StartMenuProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenWindow: (id: string) => void;
  onRestart: () => void;
}

export const StartMenu: React.FC<StartMenuProps> = ({ isOpen, onClose, onOpenWindow, onRestart }) => {
  const { user, isAuthenticated, logout, openAuthModal } = useAuth();

  if (!isOpen) return null;

  const handleItemClick = (id: string) => {
    playClickSound();
    onOpenWindow(id);
    onClose();
  };

  return (
    <div
      // Stop BOTH click and pointerdown from reaching the desktop root — the desktop's
      // onPointerDown fires before click and was closing the menu (unmounting it) before
      // any item's onClick could register, so nothing worked. The `start-menu` class also
      // lets the desktop handler skip it defensively.
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className="start-menu fixed bottom-10 left-0 w-64 bg-w95-gray w95-border w95-shadow z-50 flex font-tahoma text-xs select-none shadow-2xl"
    >
      {/* Left Blue Vertical Banner */}
      <div
        className="w-8 bg-gradient-to-t from-w95-blue to-w95-blue-light flex items-center justify-center text-white font-black tracking-widest text-sm"
        style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
      >
        NATE'S&nbsp;95
      </div>

      {/* Menu Items List */}
      <div className="flex-1 py-1 flex flex-col">
        <div
          onClick={() => handleItemClick('profile')}
          className="flex items-center gap-2.5 px-3 py-2 hover:bg-w95-blue hover:text-white cursor-pointer bg-blue-50/50"
        >
          <User size={16} className="text-blue-900" />
          <div className="flex flex-col">
            <span className="font-bold">
              {isAuthenticated && user ? (user.displayName || user.username) : 'Guest User'}
            </span>
            <span className="text-[10px] text-gray-500">
              {isAuthenticated && user
                ? `@${user.username} · ACCOUNT.CFG (Profile)`
                : 'Sign In · ACCOUNT.CFG (Profile)'}
            </span>
          </div>
        </div>

        <div
          data-testid="start-menu-explainer"
          onClick={() => handleItemClick('mktg')}
          className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-w95-blue hover:text-white cursor-pointer"
        >
          <HelpCircle size={16} className="text-blue-700" />
          <span className="font-bold">What is this? · About Nate's Software</span>
        </div>

        <div
          onClick={() => handleItemClick('terminal')}
          className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-w95-blue hover:text-white cursor-pointer"
        >
          <Terminal size={16} className="text-green-700" />
          <span className="font-bold">TERMINAL.EXE (Shell)</span>
        </div>

        <div className="border-t border-gray-400 my-1 mx-2" />

        <div
          onClick={() => handleItemClick('chat')}
          className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-w95-blue hover:text-white cursor-pointer"
        >
          <MessageSquare size={16} className="text-yellow-600" />
          <span className="font-bold">CHAT (IRC Lounge)</span>
        </div>

        <div
          onClick={() => handleItemClick('hotwire')}
          className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-w95-blue hover:text-white cursor-pointer"
        >
          <Flame size={16} className="text-orange-600" />
          <span>HOTWIRE (Drops)</span>
        </div>

        <div
          onClick={() => handleItemClick('slopshop')}
          className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-w95-blue hover:text-white cursor-pointer"
        >
          <Wrench size={16} className="text-blue-700" />
          <span>SLOPSHOP (AI Mod)</span>
        </div>

        <div
          onClick={() => handleItemClick('inbox')}
          className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-w95-blue hover:text-white cursor-pointer"
        >
          <Mail size={16} className="text-blue-700" />
          <span>Agent Inbox</span>
        </div>

        <div
          onClick={() => handleItemClick('dyno')}
          className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-w95-blue hover:text-white cursor-pointer"
        >
          <Gauge size={16} className="text-yellow-600" />
          <span>DYNO (AI Benchmark)</span>
        </div>

        <div
          onClick={() => handleItemClick('papers')}
          className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-w95-blue hover:text-white cursor-pointer"
        >
          <BookOpen size={16} className="text-yellow-700" />
          <span>White Papers (Docs)</span>
        </div>

        <div className="border-t border-gray-400 my-1 mx-2" />

        <div
          onClick={() => { window.open('https://github.com/natemcguire/nates-software', '_blank'); onClose(); }}
          className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-w95-blue hover:text-white cursor-pointer"
        >
          <HelpCircle size={16} className="text-gray-600" />
          <span>GitHub Forge &rarr;</span>
        </div>

        {isAuthenticated ? (
          <div
            data-testid="startmenu-logout"
            onClick={async () => { playClickSound(); await logout(); onClose(); }}
            className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-w95-blue hover:text-white cursor-pointer"
          >
            <LogOut size={16} className="text-gray-600" />
            <span>Log Out{user?.username ? ` (@${user.username})` : ''}</span>
          </div>
        ) : (
          <div
            data-testid="startmenu-login"
            onClick={() => { playClickSound(); openAuthModal('login', 'sign in to your account'); onClose(); }}
            className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-w95-blue hover:text-white cursor-pointer"
          >
            <LogIn size={16} className="text-green-700" />
            <span>Log In / Sign Up</span>
          </div>
        )}

        <div
          data-testid="startmenu-restart"
          onClick={() => { playClickSound(); onClose(); onRestart(); }}
          className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-w95-blue hover:text-white cursor-pointer"
        >
          <Power size={16} className="text-red-600" />
          <span>Restart Desktop...</span>
        </div>
      </div>
    </div>
  );
};
