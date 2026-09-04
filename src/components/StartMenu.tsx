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
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className="start-menu fixed bottom-10 left-0 w-64 w95-border w95-shadow z-50 flex font-tahoma text-xs select-none shadow-2xl"
      style={{
        backgroundColor: 'var(--nsw-menu-bg, #c0c0c0)',
        color: 'var(--nsw-menu-text, #000000)'
      }}
    >
      <div
        className="w-8 flex items-center justify-center font-black tracking-widest text-sm"
        style={{
          writingMode: 'vertical-rl',
          transform: 'rotate(180deg)',
          background: 'linear-gradient(to top, var(--nsw-titlebar-bg, #000080), var(--nsw-titlebar-bg-end, #1084d0))',
          color: 'var(--nsw-titlebar-text, #ffffff)'
        }}
      >
        NATE'S&nbsp;95
      </div>

      <div className="flex-1 py-1 flex flex-col">
        <div
          onClick={() => handleItemClick('profile')}
          className="start-menu-item px-3 py-2 cursor-pointer"
        >
          <User size={16} />
          <div className="flex flex-col">
            <span className="font-bold">
              {isAuthenticated && user ? (user.displayName || user.username) : 'Guest User'}
            </span>
            <span className="text-[10px] opacity-75">
              {isAuthenticated && user
                ? `@${user.username} · ACCOUNT.CFG (Profile)`
                : 'Sign In · ACCOUNT.CFG (Profile)'}
            </span>
          </div>
        </div>

        <div
          data-testid="start-menu-explainer"
          onClick={() => handleItemClick('mktg')}
          className="start-menu-item px-3 py-1.5 cursor-pointer"
        >
          <HelpCircle size={16} />
          <span className="font-bold">What is this? · About Nate's Software</span>
        </div>

        <div
          onClick={() => handleItemClick('terminal')}
          className="start-menu-item px-3 py-1.5 cursor-pointer"
        >
          <Terminal size={16} />
          <span className="font-bold">TERMINAL.EXE (Shell)</span>
        </div>

        <div className="border-t my-1 mx-2" style={{ borderColor: 'var(--nsw-border-shadow, #808080)' }} />

        <div
          onClick={() => handleItemClick('chat')}
          className="start-menu-item px-3 py-1.5 cursor-pointer"
        >
          <MessageSquare size={16} />
          <span className="font-bold">CHAT (IRC Lounge)</span>
        </div>

        <div
          onClick={() => handleItemClick('hotwire')}
          className="start-menu-item px-3 py-1.5 cursor-pointer"
        >
          <Flame size={16} />
          <span>HOTWIRE (Drops)</span>
        </div>

        <div
          onClick={() => handleItemClick('slopshop')}
          className="start-menu-item px-3 py-1.5 cursor-pointer"
        >
          <Wrench size={16} />
          <span>SLOPSHOP (AI Mod)</span>
        </div>

        <div
          onClick={() => handleItemClick('inbox')}
          className="start-menu-item px-3 py-1.5 cursor-pointer"
        >
          <Mail size={16} />
          <span>Agent Inbox</span>
        </div>

        <div
          onClick={() => handleItemClick('dyno')}
          className="start-menu-item px-3 py-1.5 cursor-pointer"
        >
          <Gauge size={16} />
          <span>DYNO (AI Benchmark)</span>
        </div>

        <div
          onClick={() => handleItemClick('papers')}
          className="start-menu-item px-3 py-1.5 cursor-pointer"
        >
          <BookOpen size={16} />
          <span>White Papers (Docs)</span>
        </div>

        <div className="border-t my-1 mx-2" style={{ borderColor: 'var(--nsw-border-shadow, #808080)' }} />

        <div
          onClick={() => { window.open('https://github.com/natemcguire/nates-software', '_blank'); onClose(); }}
          className="start-menu-item px-3 py-1.5 cursor-pointer"
        >
          <HelpCircle size={16} />
          <span>Source code &rarr;</span>
        </div>

        {isAuthenticated ? (
          <div
            data-testid="startmenu-logout"
            onClick={async () => { playClickSound(); await logout(); onClose(); }}
            className="start-menu-item px-3 py-1.5 cursor-pointer"
          >
            <LogOut size={16} />
            <span>Log Out{user?.username ? ` (@${user.username})` : ''}</span>
          </div>
        ) : (
          <div
            data-testid="startmenu-login"
            onClick={() => { playClickSound(); openAuthModal('login', 'sign in to your account'); onClose(); }}
            className="start-menu-item px-3 py-1.5 cursor-pointer"
          >
            <LogIn size={16} />
            <span>Log In / Sign Up</span>
          </div>
        )}

        <div
          data-testid="startmenu-restart"
          onClick={() => { playClickSound(); onClose(); onRestart(); }}
          className="start-menu-item px-3 py-1.5 cursor-pointer"
        >
          <Power size={16} />
          <span>Restart Desktop...</span>
        </div>
      </div>
    </div>
  );
};
