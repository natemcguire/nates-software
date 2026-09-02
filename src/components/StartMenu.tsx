import React from 'react';
import { Flame, Wrench, Cpu, Mail, BookOpen, HelpCircle, Power, Gauge, User, Terminal, MessageSquare, Award } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useCatalog } from '../context/CatalogContext';
import { playClickSound } from '../lib/soundEngine';

interface StartMenuProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenWindow: (id: string) => void;
}

export const StartMenu: React.FC<StartMenuProps> = ({ isOpen, onClose, onOpenWindow }) => {
  const { user, isAuthenticated } = useAuth();
  const { shelfAppIds } = useCatalog();

  if (!isOpen) return null;

  const handleItemClick = (id: string) => {
    playClickSound();
    onOpenWindow(id);
    onClose();
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="fixed bottom-10 left-0 w-64 bg-w95-gray w95-border w95-shadow z-50 flex font-tahoma text-xs select-none shadow-2xl"
    >
      {/* Left Blue Vertical Banner */}
      <div className="w-8 bg-gradient-to-t from-w95-blue to-w95-blue-light flex items-end justify-center pb-3 text-white font-black tracking-widest text-sm writing-mode-vertical rotate-180">
        NATE'S 95
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
                ? `@${user.username} · My Shelf (${shelfAppIds.size})`
                : 'Sign In · Profile & Shelf'}
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
          onClick={() => handleItemClick('editorial')}
          className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-w95-blue hover:text-white cursor-pointer"
        >
          <Award size={16} className="text-amber-600" />
          <span>EDITORIAL (Nate's Lab)</span>
        </div>

        <div
          onClick={() => handleItemClick('slopshop')}
          className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-w95-blue hover:text-white cursor-pointer"
        >
          <Wrench size={16} className="text-blue-700" />
          <span>SLOPSHOP (AI Mod)</span>
        </div>

        <div
          onClick={() => handleItemClick('rig')}
          className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-w95-blue hover:text-white cursor-pointer"
        >
          <Cpu size={16} className="text-green-700" />
          <span>RIG.EXE (Containers)</span>
        </div>

        <div
          onClick={() => handleItemClick('inbox')}
          className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-w95-blue hover:text-white cursor-pointer"
        >
          <Mail size={16} className="text-blue-700" />
          <span>INBOX (Discussions)</span>
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

        <div
          onClick={() => { window.location.reload(); }}
          className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-w95-blue hover:text-white cursor-pointer"
        >
          <Power size={16} className="text-red-600" />
          <span>Restart Desktop...</span>
        </div>
      </div>
    </div>
  );
};
