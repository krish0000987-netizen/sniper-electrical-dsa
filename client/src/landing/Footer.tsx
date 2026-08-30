import React from 'react';
import { Layers, ShieldCheck, ArrowUp, Mail, Phone, MapPin, ExternalLink } from 'lucide-react';

export const Footer: React.FC = () => {
  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <footer className="bg-slate-950 text-slate-400 border-t border-slate-800 text-xs">
      {/* Top Footer Banner / CTA */}
      <div className="bg-gradient-to-r from-blue-900 via-indigo-950 to-slate-950 py-12 border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="space-y-2 text-center md:text-left">
            <h3 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              Ready to Upgrade Your Lending Stack?
            </h3>
            <p className="text-slate-300 text-sm">
              Deploy SNIPER on-premise or dedicated Cloud Run container with zero vendor lock-in.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="#sniper-ai"
              className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-sm transition-all shadow-lg hover:shadow-blue-500/25 cursor-pointer"
            >
              LAUNCH INTERACTIVE DEMO
            </a>
            <button
              onClick={scrollToTop}
              className="p-3 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl transition-colors cursor-pointer"
              title="Back to Top"
            >
              <ArrowUp className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Footer Links Grid */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 grid grid-cols-2 md:grid-cols-5 gap-8">
        
        {/* Col 1: Brand Info */}
        <div className="col-span-2 space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center font-black text-white text-base shadow-md">
              N
            </div>
            <div>
              <span className="font-extrabold text-lg tracking-tight text-white">SNIPER</span>
              <span className="text-[10px] font-mono text-blue-400 block -mt-1 uppercase tracking-widest">LENDING OS</span>
            </div>
          </div>

          <p className="text-slate-400 text-xs leading-relaxed max-w-sm">
            SNIPER is India's unified lending operating system powering Banks, NBFCs, and Digital Fintech Lenders across MSME, Personal, LAP, and Gold Loan products.
          </p>

          <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono pt-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>RBI Digital Lending Guidelines Compliant</span>
          </div>
        </div>

        {/* Col 2: Core Modules */}
        <div className="space-y-3">
          <h4 className="font-bold text-white text-xs uppercase tracking-wider font-mono">Core Modules</h4>
          <ul className="space-y-2 text-slate-400 font-medium">
            <li><a href="#crm" className="hover:text-blue-400 transition-colors">Lending CRM</a></li>
            <li><a href="#los" className="hover:text-blue-400 transition-colors">LOS (Origination)</a></li>
            <li><a href="#bre" className="hover:text-blue-400 transition-colors">Credit BRE</a></li>
            <li><a href="#underwriting" className="hover:text-blue-400 transition-colors">Underwriting Hub</a></li>
            <li><a href="#lms" className="hover:text-blue-400 transition-colors">LMS (Servicing)</a></li>
          </ul>
        </div>

        {/* Col 3: Operations & Ecosystem */}
        <div className="space-y-3">
          <h4 className="font-bold text-white text-xs uppercase tracking-wider font-mono">Operations</h4>
          <ul className="space-y-2 text-slate-400 font-medium">
            <li><a href="#payments" className="hover:text-blue-400 transition-colors">Payments & eNACH</a></li>
            <li><a href="#reconciliation" className="hover:text-blue-400 transition-colors">AI Reconciliation</a></li>
            <li><a href="#collections" className="hover:text-blue-400 transition-colors">Smart Collections</a></li>
            <li><a href="#customer-portal" className="hover:text-blue-400 transition-colors">Borrower Portal</a></li>
            <li><a href="#dsa" className="hover:text-blue-400 transition-colors">DSA Partner Portal</a></li>
          </ul>
        </div>

        {/* Col 4: Platform & Compliance */}
        <div className="space-y-3">
          <h4 className="font-bold text-white text-xs uppercase tracking-wider font-mono">Compliance & AI</h4>
          <ul className="space-y-2 text-slate-400 font-medium">
            <li><a href="#field-sales" className="hover:text-blue-400 transition-colors">Field Sales App</a></li>
            <li><a href="#compliance" className="hover:text-blue-400 transition-colors">RBI Compliance</a></li>
            <li><a href="#risk" className="hover:text-blue-400 transition-colors">Early Warning EWS</a></li>
            <li><a href="#ecosystem" className="hover:text-blue-400 transition-colors">50+ API Integrations</a></li>
            <li><a href="#sniper-ai" className="hover:text-blue-400 transition-colors">SNIPER AI Copilot</a></li>
          </ul>
        </div>

      </div>

      {/* Bottom Bar */}
      <div className="border-t border-slate-900 py-6 text-center md:flex md:items-center md:justify-between max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-[11px] text-slate-500 font-mono">
        <div>
          © 2026 SNIPER Lending Technologies India Pvt Ltd. All rights reserved.
        </div>
        <div className="mt-2 md:mt-0 flex items-center justify-center gap-6">
          <span className="hover:text-slate-400 transition-colors">ISO 27001 Certified</span>
          <span className="hover:text-slate-400 transition-colors">SOC 2 Type II</span>
          <span className="hover:text-slate-400 transition-colors">RBI Digital Lending Compliant</span>
        </div>
      </div>
    </footer>
  );
};
