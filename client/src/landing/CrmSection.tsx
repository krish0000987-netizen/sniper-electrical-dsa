import React, { useState } from 'react';
import { Users, PhoneCall, MessageSquare, UserCheck, Search, Filter, Plus, ArrowRight, ShieldCheck, Sparkles, CheckCircle2 } from 'lucide-react';

export const CrmSection: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'leads' | 'telecalling' | 'customer360'>('leads');

  return (
    <section id="crm" className="py-24 bg-white border-b border-slate-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Section Header */}
        <div className="flex flex-col lg:flex-row lg:items-end justify-between mb-12 gap-6">
          <div className="max-w-2xl space-y-3">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-bold uppercase tracking-wider">
              <Users className="w-3.5 h-3.5 text-blue-600" />
              <span>SNIPER LENDING CRM</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-950 tracking-tight leading-tight">
              TURN EVERY LEAD INTO A CONNECTED CUSTOMER JOURNEY.
            </h2>
            <p className="text-slate-600 text-base">
              Omnichannel lead acquisition from web forms, WhatsApp, telecallers, and DSA portals with automated lead scoring and round-robin agent assignment.
            </p>
          </div>

          <div className="flex items-center gap-2 bg-slate-100 p-1.5 rounded-xl self-start">
            <button
              onClick={() => setActiveTab('leads')}
              className={`px-4 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                activeTab === 'leads' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Lead Pipeline
            </button>
            <button
              onClick={() => setActiveTab('telecalling')}
              className={`px-4 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                activeTab === 'telecalling' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Telecalling & Campaigns
            </button>
            <button
              onClick={() => setActiveTab('customer360')}
              className={`px-4 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                activeTab === 'customer360' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Customer 360 View
            </button>
          </div>
        </div>

        {/* Main Product Frame */}
        <div className="bg-slate-900 text-white rounded-3xl border border-slate-800 shadow-2xl overflow-hidden p-6 lg:p-8 space-y-6">
          
          {/* Header Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center text-white font-bold">
                <Users className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-base text-white">SNIPER Omnichannel Lead Engine</h3>
                <p className="text-xs text-slate-400">Total Active Leads: 1,420 • Conversion Rate: 28.4%</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                <input 
                  type="text" 
                  placeholder="Search leads by phone, PAN or name..."
                  className="bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-300 w-64 focus:outline-none focus:border-blue-500"
                  readOnly
                />
              </div>
              <button className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer">
                <Plus className="w-3.5 h-3.5" />
                <span>New Lead</span>
              </button>
            </div>
          </div>

          {/* Tab 1: Lead Pipeline */}
          {activeTab === 'leads' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                  <span className="text-xs font-bold text-slate-300 uppercase">New Ingestion (42)</span>
                  <span className="text-[10px] bg-blue-900/50 text-blue-300 px-2 py-0.5 rounded font-mono">Auto-Scored</span>
                </div>
                <div className="p-3 bg-slate-900 rounded-xl border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white">Rohan Gupta</span>
                    <span className="text-[10px] font-mono bg-emerald-950 text-emerald-400 px-1.5 py-0.5 rounded font-bold">
                      Score: 94/100
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">₹15 Lakhs Business Loan • Source: Web Form</p>
                  <div className="text-[11px] text-blue-400 font-mono">Assigned: Deepak S. (Round-Robin)</div>
                </div>
                <div className="p-3 bg-slate-900 rounded-xl border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white">Aarti Sharma</span>
                    <span className="text-[10px] font-mono bg-blue-950 text-blue-400 px-1.5 py-0.5 rounded font-bold">
                      Score: 88/100
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">₹5 Lakhs Personal Loan • Source: WhatsApp Bot</p>
                  <div className="text-[11px] text-blue-400 font-mono">Assigned: Telecalling Pool</div>
                </div>
              </div>

              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                  <span className="text-xs font-bold text-slate-300 uppercase">Document Verification (18)</span>
                  <span className="text-[10px] bg-indigo-900/50 text-indigo-300 px-2 py-0.5 rounded font-mono">OCR Active</span>
                </div>
                <div className="p-3 bg-slate-900 rounded-xl border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white">Anand Infra Tech</span>
                    <span className="text-[10px] font-mono bg-emerald-950 text-emerald-400 px-1.5 py-0.5 rounded font-bold">
                      GST Verified
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">₹40 Lakhs Working Capital • Source: DSA Partner</p>
                  <div className="text-[11px] text-indigo-400 font-mono">Perfios Bank Parse Complete</div>
                </div>
              </div>

              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                  <span className="text-xs font-bold text-slate-300 uppercase">Converted to Application (124)</span>
                  <span className="text-[10px] bg-emerald-900/50 text-emerald-300 px-2 py-0.5 rounded font-mono">Pushed to LOS</span>
                </div>
                <div className="p-3 bg-slate-900 rounded-xl border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white">Siddharth Malhotra</span>
                    <span className="text-[10px] font-mono bg-blue-900 text-blue-200 px-1.5 py-0.5 rounded font-bold">
                      App #NX-10482
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">₹25 Lakhs Business Loan • BRE Passed</p>
                  <div className="text-[11px] text-emerald-400 font-mono">Underwriting In Progress</div>
                </div>
              </div>
            </div>
          )}

          {/* Tab 2: Telecalling */}
          {activeTab === 'telecalling' && (
            <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-4">
              <div className="flex items-center justify-between text-xs text-slate-300">
                <span className="font-bold uppercase text-blue-400">Integrated Dialing & WhatsApp Bot Queue</span>
                <span className="font-mono text-slate-400">Today Calls: 480 • PTP Rate: 64%</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="p-3 bg-slate-900 rounded-xl border border-slate-800 space-y-1">
                  <div className="font-bold text-white flex items-center justify-between">
                    <span>Telecaller Agent: Priya Singh</span>
                    <span className="text-emerald-400 font-mono">ACTIVE CALL</span>
                  </div>
                  <p className="text-slate-400">Calling: Vikram Mehta (App #NX-10484) • Status: Confirming Bank Statement</p>
                </div>
                <div className="p-3 bg-slate-900 rounded-xl border border-slate-800 space-y-1">
                  <div className="font-bold text-white flex items-center justify-between">
                    <span>WhatsApp Bot Trigger</span>
                    <span className="text-blue-400 font-mono">AUTOMATED</span>
                  </div>
                  <p className="text-slate-400">Sent KFS consent link to 34 leads • 28 clicked & verified OTP</p>
                </div>
              </div>
            </div>
          )}

          {/* Tab 3: Customer 360 */}
          {activeTab === 'customer360' && (
            <div className="p-5 bg-slate-950 rounded-2xl border border-slate-800 space-y-4 text-xs font-mono">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div>
                  <div className="text-sm font-bold text-white">Rahul Sharma (Ananya Enterprises)</div>
                  <div className="text-slate-400">PAN: ABCPS1234K • Aadhaar: Verified • CIBIL: 782</div>
                </div>
                <span className="px-3 py-1 bg-emerald-950 text-emerald-400 border border-emerald-800 rounded-full font-bold">
                  HIGH CREDITWORTHY (PRIME)
                </span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 bg-slate-900 rounded-xl border border-slate-800">
                  <span className="text-slate-400">Existing Loans:</span>
                  <div className="text-white font-bold text-sm mt-1">1 Closed (LN-9012)</div>
                </div>
                <div className="p-3 bg-slate-900 rounded-xl border border-slate-800">
                  <span className="text-slate-400">Repayment Track:</span>
                  <div className="text-emerald-400 font-bold text-sm mt-1">100% On-Time (0 DPD)</div>
                </div>
                <div className="p-3 bg-slate-900 rounded-xl border border-slate-800">
                  <span className="text-slate-400">Pre-Approved Offer:</span>
                  <div className="text-blue-400 font-bold text-sm mt-1">Up to ₹35 Lakhs</div>
                </div>
              </div>
            </div>
          )}

        </div>

      </div>
    </section>
  );
};
