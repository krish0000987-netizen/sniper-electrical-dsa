import React from 'react';
import { ShieldCheck, FileCheck, CheckCircle2, Lock, Eye, FileText, ArrowRight } from 'lucide-react';

export const ComplianceSection: React.FC = () => {
  return (
    <section id="compliance" className="py-24 bg-slate-50 border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
        
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto space-y-4">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold uppercase tracking-wider">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            <span>REGULATORY COMPLIANCE ARCHITECTURE</span>
          </div>

          <h2 className="text-3xl sm:text-5xl font-extrabold text-slate-950 tracking-tight">
            COMPLIANCE BUILT INTO THE WORKFLOW.
          </h2>

          <p className="text-base sm:text-lg text-slate-600">
            India-focused compliance-ready architecture with automated Key Fact Statement (KFS) generation, APR calculation engine, digital consent vaulting, and versioned policy audit trails.
          </p>
        </div>

        {/* Compliance Center Visual Frame */}
        <div className="bg-white p-6 lg:p-8 rounded-3xl border border-slate-200 shadow-xl space-y-6">
          <div className="flex flex-wrap items-center justify-between border-b border-slate-100 pb-4 gap-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">SNIPER Regulatory Governance Center</h3>
              <p className="text-xs text-slate-500">Configurable, versioned & auditable rule architecture</p>
            </div>
            <span className="text-xs font-mono text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-full font-bold">
              Active Rule Version: v3.4.0 (Effective 01 May 2026)
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs font-mono">
            <div className="p-4 bg-slate-900 text-white rounded-2xl border border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-slate-400">
                <span>Key Fact Statement</span>
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="text-sm font-bold text-emerald-400">VALIDATED</div>
              <p className="text-[10px] text-slate-400 font-normal">Exact APR, total processing fee, and cooling-off period computed.</p>
            </div>

            <div className="p-4 bg-slate-900 text-white rounded-2xl border border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-slate-400">
                <span>Digital Consent Vault</span>
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="text-sm font-bold text-emerald-400">RECORDED</div>
              <p className="text-[10px] text-slate-400 font-normal">OTP & IP timestamped borrower consent logged with SHA-256 hash.</p>
            </div>

            <div className="p-4 bg-slate-900 text-white rounded-2xl border border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-slate-400">
                <span>Immutable Audit Trail</span>
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="text-sm font-bold text-emerald-400">COMPLETE</div>
              <p className="text-[10px] text-slate-400 font-normal">Every credit decision, maker-checker signoff, and payment logged.</p>
            </div>

            <div className="p-4 bg-slate-900 text-white rounded-2xl border border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-slate-400">
                <span>Grievance Redressal</span>
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="text-sm font-bold text-emerald-400">ACTIVE</div>
              <p className="text-[10px] text-slate-400 font-normal">Automated SLA escalation to Nodal Grievance Officer.</p>
            </div>
          </div>
        </div>

      </div>
    </section>
  );
};
