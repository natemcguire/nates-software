import { Flame, Wrench, Cpu, Mail, BookOpen, HelpCircle, Power, FileText, Gauge, User } from 'lucide-react';

interface StartMenuProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenWindow: (id: string) => void;
}

export const StartMenu: React.FC<StartMenuProps> = ({ isOpen, onClose, onOpenWindow }) => {
  if (!isOpen) return null;

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="fixed bottom-10 left-0 w-64 bg-w95-gray w95-border w95-shadow z-50 flex font-tahoma text-xs select-none"
    >
      {/* Left Blue Vertical Banner */}
      <div className="w-8 bg-gradient-to-t from-w95-blue to-w95-blue-light flex items-end justify-center pb-3 text-white font-black tracking-widest text-sm writing-mode-vertical rotate-180">
        NATE'S 95
      </div>

      {/* Menu Items List */}
      <div className="flex-1 py-1 flex flex-col">
        <div
          onClick={() => { onOpenWindow('profile'); onClose(); }}
          className="flex items-center gap-2.5 px-3 py-2 hover:bg-w95-blue hover:text-white cursor-pointer bg-blue-50/50"
        >
          <User size={16} className="text-blue-900" />
          <div className="flex flex-col">
            <span className="font-bold">Nate McGuire</span>
            <span className="text-[10px] text-gray-500">@nate &middot; My Shelf (2)</span>
          </div>
        </div>

        <div
          onClick={() => { onOpenWindow('mktg'); onClose(); }}
          className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-w95-blue hover:text-white cursor-pointer"
        >
          <FileText size={16} className="text-blue-700 group-hover:text-white" />
          <span>About Nate's Software</span>
        </div>

        <div className="border-t border-gray-400 my-1 mx-2" />

        <div
          onClick={() => { onOpenWindow('hotwire'); onClose(); }}
          className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-w95-blue hover:text-white cursor-pointer"
        >
          <Flame size={16} className="text-orange-600" />
          <span>HOTWIRE (Drops)</span>
        </div>

        <div
          onClick={() => { onOpenWindow('slopshop'); onClose(); }}
          className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-w95-blue hover:text-white cursor-pointer"
        >
          <Wrench size={16} className="text-blue-700" />
          <span>SLOPSHOP (AI Mod)</span>
        </div>

        <div
          onClick={() => { onOpenWindow('rig'); onClose(); }}
          className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-w95-blue hover:text-white cursor-pointer"
        >
          <Cpu size={16} className="text-green-700" />
          <span>RIG.EXE</span>
        </div>

        <div
          onClick={() => { onOpenWindow('inbox'); onClose(); }}
          className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-w95-blue hover:text-white cursor-pointer"
        >
          <Mail size={16} className="text-yellow-700" />
          <span>INBOX (Mailbox)</span>
        </div>

        <div
          onClick={() => { onOpenWindow('papers'); onClose(); }}
          className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-w95-blue hover:text-white cursor-pointer"
        >
          <BookOpen size={16} className="text-purple-700" />
          <span>Architectural White Papers</span>
        </div>

        <div
          onClick={() => { onOpenWindow('dyno'); onClose(); }}
          className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-w95-blue hover:text-white cursor-pointer"
        >
          <Gauge size={16} className="text-red-600" />
          <span>DYNO (AI Tuning)</span>
        </div>

        <div className="border-t border-gray-400 my-1 mx-2" />

        <div
          onClick={() => { alert("Nate's Software 95 · All rights reserved · Own the copy on your disk."); onClose(); }}
          className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-w95-blue hover:text-white cursor-pointer"
        >
          <HelpCircle size={16} className="text-blue-600" />
          <span>Help & Support</span>
        </div>

        <div
          onClick={() => { if (confirm("Log off Nate's Software session?")) window.location.reload(); onClose(); }}
          className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-w95-blue hover:text-white cursor-pointer"
        >
          <Power size={16} className="text-red-600" />
          <span className="font-bold">Log Off Nate...</span>
        </div>
      </div>
    </div>
  );
};
