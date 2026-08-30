import React, { useState } from 'react';
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
  Smartphone,
  Building2,
  CheckCircle2,
  ArrowRight,
  Zap
} from 'lucide-react';

export const EcosystemSection: React.FC = () => {
  const [activeNode, setActiveNode] = useState(0);

  const nodes = [
    { id: 'crm', title: 'CRM & Lead Management', icon: Users, tagline: 'Lead Scoring & Omnichannel Ingestion', desc: 'Captures leads from web, mobile, telecallers & DSA agents with real-time intent scoring.' },
    { id: 'los', title: 'Loan Origination (LOS)', icon: Workflow, tagline: '13-Stage Frictionless Application Pipeline', desc: 'Guides applicant through KYC, documents, dual bureau pulls, and instant sanctioning.' },
    { id: 'lms', title: 'Loan Servicing (LMS)', icon: Layers, tagline: 'Core Loan Accounting & Amortization', desc: 'Tracks principal, interest allocation, fee accrual, subvention, and repayment schedules.' },
    { id: 'credit', title: 'Credit Bureau & AA', icon: Cpu, tagline: 'Instant CIBIL & Account Aggregator Pulls', desc: 'Parses 12 months of banking cashflow, credit tradelines, and delinquency scores.' },
    { id: 'bre', title: 'Business Rule Engine', icon: Zap, tagline: 'Visual Policy Builder & Auto Eligibility', desc: 'Executes complex FOIR, DSCR, LTV, and risk policy checks in sub-500 milliseconds.' },
    { id: 'risk', title: 'Risk & Early Warning', icon: ShieldAlert, tagline: 'Portfolio Delinquency & DPD Heatmap', desc: 'Flags broken PTPs, sudden balance drops, and high exposure signals before default.' },
    { id: 'payments', title: 'Payments & Auto-Recon', icon: CreditCard, tagline: 'Disbursements, eNACH & 98%+ Auto Match', desc: 'Direct bank payout APIs and automated UTR bank statement matching.' },
    { id: 'collections', title: 'Smart Collections', icon: Receipt, tagline: 'DPD Queue, PTP Tracking & Field Dispatch', desc: 'AI-driven collection queue, automated WhatsApp payment links, and field agent routes.' },
    { id: 'compliance', title: 'Compliance & KFS Vault', icon: ShieldCheck, tagline: 'RBI Regulatory Key Fact Statement Engine', desc: 'Calculates exact APR, generates KFS, records digital consents, and manages audit trails.' },
    { id: 'ai', title: 'SNIPER AI Copilot', icon: Sparkles, tagline: 'Operational Intelligence & Risk Assistant', desc: 'Conversational assistant for underwriter queues, SLA alerts, and reconciliation exceptions.' },
    { id: 'customer', title: 'Borrower Portal', icon: Smartphone, tagline: 'Self-Serve Loan App & EMI Payments', desc: 'Mobile-first borrower portal for tracking loan status, downloading KFS, and paying EMIs.' },
    { id: 'dsa', title: 'DSA Partner Portal', icon: Building2, tagline: 'Referral Pipeline & Commission Tracking', desc: 'Empowers channel partners with referral links, approval status, and payout tracking.' }
  ];

  return (
    <section id="ecosystem" className="py-24 bg-slate-50 relative border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto space-y-4 mb-16">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-100 text-blue-800 text-xs font-bold uppercase tracking-wider">
            <Zap className="w-3.5 h-3.5 text-blue-600" />
            <span>SNIPER ECOSYSTEM MATRIX</span>
          </div>

          <h2 className="text-3xl sm:text-5xl font-extrabold text-slate-950 tracking-tight">
            12 Interconnected Modules. One Unified Core.
          </h2>

          <p className="text-base sm:text-lg text-slate-600">
            Hover or tap any module in the SNIPER ecosystem to inspect live capabilities and seamless data flow.
          </p>
        </div>

        {/* Ecosystem Matrix Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          
          {/* Left / Top Interactive Node Buttons */}
          <div className="lg:col-span-6 grid grid-cols-2 sm:grid-cols-3 gap-3">
            {nodes.map((node, idx) => {
              const isActive = idx === activeNode;
              return (
                <button
                  key={node.id}
                  onClick={() => setActiveNode(idx)}
                  onMouseEnter={() => setActiveNode(idx)}
                  className={`p-4 rounded-2xl text-left border transition-all cursor-pointer flex flex-col justify-between space-y-2 ${
                    isActive 
                      ? 'bg-slate-900 text-white border-blue-500 shadow-xl scale-102 ring-2 ring-blue-500/20' 
                      : 'bg-white text-slate-800 border-slate-200 hover:border-slate-300 hover:bg-slate-100/80 shadow-2xs'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                      isActive ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700'
                    }`}>
                      {React.createElement(node.icon, { className: "w-4 h-4" })}
                    </div>
                    {isActive && <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />}
                  </div>

                  <div>
                    <div className="text-xs font-bold leading-tight">{node.title}</div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Right Active Node Inspector Box */}
          <div className="lg:col-span-6">
            <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-xl space-y-6 relative overflow-hidden">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-blue-600 text-white flex items-center justify-center font-bold text-xl shadow-md">
                    {React.createElement(nodes[activeNode].icon, { className: "w-6 h-6" })}
                  </div>
                  <div>
                    <span className="text-[10px] font-mono uppercase bg-blue-50 text-blue-700 font-bold px-2 py-0.5 rounded">
                      SNIPER MODULE #{activeNode + 1}
                    </span>
                    <h3 className="text-xl font-bold text-slate-900 mt-0.5">{nodes[activeNode].title}</h3>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="text-sm font-semibold text-blue-700 font-mono">
                  → {nodes[activeNode].tagline}
                </div>
                <p className="text-sm text-slate-600 leading-relaxed">
                  {nodes[activeNode].desc}
                </p>
              </div>

              {/* Dynamic Mock Interface Preview */}
              <div className="p-4 rounded-2xl bg-slate-900 text-slate-200 text-xs font-mono space-y-2 border border-slate-800">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2 text-[10px] text-slate-400">
                  <span>MODULE STATUS & TELEMETRY</span>
                  <span className="text-emerald-400 font-semibold">ONLINE & SYNCED</span>
                </div>
                <div className="text-slate-300">
                  <span className="text-blue-400 font-bold">API Endpoint:</span> /api/v4/sniper/{nodes[activeNode].id}/execute
                </div>
                <div className="text-slate-400 flex items-center justify-between pt-1">
                  <span>Data Integration: Fully Bilateral</span>
                  <span className="text-emerald-400">Latency: &lt;15ms</span>
                </div>
              </div>

              <div className="pt-2 flex items-center justify-between text-xs font-semibold text-slate-500">
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>Configurable Multi-Tenant Module</span>
                </span>
                <a href={`#${nodes[activeNode].id}`} className="text-blue-600 hover:text-blue-700 flex items-center gap-1 font-bold">
                  Explore Full Deep Dive
                  <ArrowRight className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          </div>

        </div>

      </div>
    </section>
  );
};
