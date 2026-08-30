import React from 'react';
import { 
  Users, 
  Workflow, 
  Layers, 
  Cpu, 
  ShieldAlert, 
  CreditCard, 
  Receipt, 
  ShieldCheck, 
  Sparkles,
  ChevronRight
} from 'lucide-react';

export const SocialProofTicker: React.FC = () => {
  const categories = [
    { name: 'CRM & LEAD MGMT', icon: Users, desc: 'Omnichannel Ingestion' },
    { name: 'LOS ORIGINATION', icon: Workflow, desc: 'Sub-minute Approvals' },
    { name: 'LMS SERVICING', icon: Layers, desc: 'Core Accounting' },
    { name: 'CREDIT BRE ENGINE', icon: Cpu, desc: 'Visual Policy Rules' },
    { name: 'PORTFOLIO RISK', icon: ShieldAlert, desc: 'Early Warnings' },
    { name: 'PAYMENTS & AUTO-RECON', icon: CreditCard, desc: '98%+ Direct Match' },
    { name: 'SMART COLLECTIONS', icon: Receipt, desc: 'PTP & Field Dispatch' },
    { name: 'COMPLIANCE & KFS', icon: ShieldCheck, desc: 'RBI Regulatory Vault' },
    { name: 'SNIPER AI COPILOT', icon: Sparkles, desc: 'Operational Intelligence' }
  ];

  return (
    <section className="py-10 bg-slate-900 text-white overflow-hidden border-y border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-6 text-center">
        <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">
          ONE CONNECTED PLATFORM • EVERY LENDING WORKFLOW
        </h3>
      </div>

      {/* Infinite Horizontal Ticker Track */}
      <div className="relative w-full flex overflow-x-hidden group">
        <div className="animate-marquee flex items-center space-x-6 whitespace-nowrap py-2">
          {categories.concat(categories).map((cat, idx) => (
            <div 
              key={idx}
              className="inline-flex items-center gap-3 px-5 py-3 rounded-xl bg-slate-800/80 border border-slate-700/70 hover:border-blue-500/80 hover:bg-slate-800 transition-all cursor-default"
            >
              <div className="w-8 h-8 rounded-lg bg-blue-600/20 text-blue-400 flex items-center justify-center border border-blue-500/30">
                {React.createElement(cat.icon, { className: "w-4 h-4" })}
              </div>
              <div>
                <div className="text-xs font-extrabold tracking-wider text-white flex items-center gap-1.5">
                  <span>{cat.name}</span>
                </div>
                <div className="text-[11px] text-slate-400 font-mono">{cat.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
