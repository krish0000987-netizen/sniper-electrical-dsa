import React from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';

interface AnnouncementBarProps {
  onOpenTour: () => void;
}

export const AnnouncementBar: React.FC<AnnouncementBarProps> = ({ onOpenTour }) => {
  return (
    <div className="bg-slate-900 text-white text-xs py-2 px-4 flex items-center justify-center gap-3 border-b border-slate-800 transition-all">
      <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-blue-600/30 text-blue-300 font-medium border border-blue-500/30">
        <Sparkles className="w-3 h-3 text-blue-400" />
        <span>SNIPER 4.0 Released</span>
      </div>
      <p className="hidden md:inline text-slate-300">
        Autonomous Credit BRE, Instant KFS Engine & Automated Bank Reconciliation for Indian Lenders.
      </p>
      <button 
        onClick={onOpenTour}
        className="inline-flex items-center gap-1 font-semibold text-blue-400 hover:text-blue-300 underline underline-offset-2 cursor-pointer ml-1 transition-colors"
      >
        <span>Watch Product Tour</span>
        <ArrowRight className="w-3 h-3" />
      </button>
    </div>
  );
};
