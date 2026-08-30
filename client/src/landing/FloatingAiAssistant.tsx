import React, { useState } from 'react';
import { Sparkles, X, ChevronUp, ArrowRight, ShieldAlert, CheckCircle2, Bot, ExternalLink, Zap } from 'lucide-react';

interface FloatingAiAssistantProps {
  onSelectAction: (actionType: 'applications' | 'reconciliation' | 'risk') => void;
}

export const FloatingAiAssistant: React.FC<FloatingAiAssistantProps> = ({ onSelectAction }) => {
  const [isOpen, setIsOpen] = useState(true);
  const [minimized, setMinimized] = useState(false);

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-40 bg-slate-900 hover:bg-blue-600 text-white p-3.5 rounded-full shadow-2xl border border-slate-700 flex items-center gap-2 cursor-pointer transition-all hover:scale-105 group"
      >
        <Sparkles className="w-5 h-5 text-blue-400 group-hover:text-white" />
        <span className="text-xs font-bold pr-1">SNIPER AI Copilot</span>
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
      </button>
    );
  }

  return (
    <div className={`fixed bottom-6 right-6 z-40 transition-all duration-300 ${minimized ? 'w-80' : 'w-96'} max-w-[calc(100vw-2rem)]`}>
      <div className="bg-slate-900 text-white rounded-2xl shadow-2xl border border-slate-800 overflow-hidden">
        
        {/* Header Bar */}
        <div className="bg-slate-950 px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-bold text-white flex items-center gap-1.5">
                <span>SNIPER AI Copilot</span>
                <span className="text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-800 px-1.5 py-0.2 rounded font-mono">
                  ACTIVE
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setMinimized(!minimized)}
              className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800 transition-colors cursor-pointer"
              title={minimized ? "Expand Copilot" : "Minimize Copilot"}
            >
              <ChevronUp className={`w-4 h-4 transition-transform ${minimized ? '' : 'rotate-180'}`} />
            </button>
            <button
              onClick={() => setIsOpen(false)}
              className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800 transition-colors cursor-pointer"
              title="Close Copilot"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        {!minimized && (
          <div className="p-4 space-y-3 text-xs">
            <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800/80 space-y-1.5">
              <p className="text-slate-300 font-medium">Good morning, Operations Lead.</p>
              <p className="text-slate-400 leading-relaxed">
                <span className="text-blue-400 font-bold">12 applications</span> require underwriter attention, <span className="text-sky-400 font-bold">7 payments</span> need manual reconciliation match, and <span className="text-amber-400 font-bold">4 loans</span> crossed SLA threshold.
              </p>
            </div>

            {/* Quick Action Buttons */}
            <div className="space-y-1.5 pt-1">
              <button
                onClick={() => onSelectAction('applications')}
                className="w-full py-2 px-3 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 font-medium text-left flex items-center justify-between transition-colors cursor-pointer group"
              >
                <span>Review 12 Pending Applications</span>
                <ArrowRight className="w-3.5 h-3.5 text-blue-400 group-hover:translate-x-1 transition-transform" />
              </button>

              <button
                onClick={() => onSelectAction('reconciliation')}
                className="w-full py-2 px-3 rounded-lg bg-sky-600/20 hover:bg-sky-600/30 text-sky-300 border border-sky-500/30 font-medium text-left flex items-center justify-between transition-colors cursor-pointer group"
              >
                <span>View Reconciliation Exceptions</span>
                <ArrowRight className="w-3.5 h-3.5 text-sky-400 group-hover:translate-x-1 transition-transform" />
              </button>

              <button
                onClick={() => onSelectAction('risk')}
                className="w-full py-2 px-3 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30 font-medium text-left flex items-center justify-between transition-colors cursor-pointer group"
              >
                <span>Open 4 SLA Risk Alerts</span>
                <ArrowRight className="w-3.5 h-3.5 text-amber-400 group-hover:translate-x-1 transition-transform" />
              </button>
            </div>

            <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500">
              <span className="flex items-center gap-1">
                <Zap className="w-3 h-3 text-emerald-400" />
                <span>Powered by SNIPER GenAI v4</span>
              </span>
              <a href="#sniper-ai" className="text-blue-400 hover:text-blue-300 font-semibold flex items-center gap-1">
                Full AI Console
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
