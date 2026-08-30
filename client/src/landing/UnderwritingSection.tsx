import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ShieldCheck, Sparkles, FileText, CheckCircle2, Building2, CreditCard, Receipt, FileSpreadsheet, AlertTriangle, UserCheck, Eye } from 'lucide-react';

export const UnderwritingSection: React.FC = () => {
  const [activeUwTab, setActiveUwTab] = useState<'customer' | 'credit' | 'banking' | 'gst' | 'risk'>('credit');

  return (
    <section id="underwriting" className="py-24 bg-slate-50 border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
        
        {/* Section Header */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center max-w-3xl mx-auto space-y-4"
        >
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-100 text-indigo-800 text-xs font-bold uppercase tracking-wider">
            <ShieldCheck className="w-3.5 h-3.5 text-indigo-600" />
            <span>CREDIT UNDERWRITING WORKSPACE</span>
          </div>

          <h2 className="text-3xl sm:text-5xl font-extrabold text-slate-950 tracking-tight">
            GIVE CREDIT TEAMS THE COMPLETE PICTURE.
          </h2>

          <p className="text-base sm:text-lg text-slate-600">
            Unified credit analyst workbench bringing together dual bureau reports, Account Aggregator cashflows, GST 3B reconciliations, and AI credit summaries.
          </p>
        </motion.div>

        {/* Workspace Frame */}
        <motion.div 
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden p-6 lg:p-8 space-y-6"
        >
          
          {/* Top Tabs */}
          <div className="flex items-center justify-between pb-4 border-b border-slate-200 overflow-x-auto gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase text-slate-400 mr-2">Underwriter View:</span>
              {[
                { id: 'customer', name: 'Customer 360' },
                { id: 'credit', name: 'Credit & Bureau' },
                { id: 'banking', name: 'Banking & AA' },
                { id: 'gst', name: 'GST & Tax Returns' },
                { id: 'risk', name: 'Policy Exceptions' }
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveUwTab(tab.id as any)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                    activeUwTab === tab.id 
                      ? 'bg-slate-900 text-white shadow-md' 
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {tab.name}
                </button>
              ))}
            </div>

            <div className="text-xs font-mono text-slate-500 hidden sm:block">
              Analyst: Senior Underwriter #UW-804
            </div>
          </div>

          {/* High Quality Unsplash Visual Media Banner with Animated Scanner Overlay */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
            
            <div className="lg:col-span-4 relative rounded-2xl overflow-hidden border border-slate-200 h-48 bg-slate-950 group">
              <img 
                src="https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?auto=format&fit=crop&w=800&q=80" 
                alt="Underwriting Credit Analytics" 
                className="w-full h-full object-cover opacity-70 group-hover:scale-105 transition-transform duration-700"
                referrerPolicy="no-referrer"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/40 to-transparent" />
              
              {/* Laser Beam Scanning Line Animation */}
              <motion.div 
                animate={{ y: [0, 180, 0] }}
                transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                className="absolute inset-x-0 h-1 bg-gradient-to-r from-transparent via-blue-400 to-transparent shadow-[0_0_12px_#3b82f6]"
              />

              <div className="absolute bottom-3 left-3 right-3 text-white font-mono text-xs space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-blue-300">
                  <Eye className="w-3.5 h-3.5" />
                  <span>OCR DOCUMENT SCANNING</span>
                </div>
                <p className="text-[10px] text-slate-300">GST 3B + Bank Statement Authenticated</p>
              </div>
            </div>

            {/* AI Credit Summary Callout Box */}
            <div className="lg:col-span-8 p-5 rounded-2xl bg-gradient-to-r from-blue-50 via-indigo-50 to-blue-50 border border-blue-200 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
                  <Sparkles className="w-4 h-4 text-blue-600" />
                  <span>SNIPER AI Credit Summary</span>
                  <span className="text-[10px] font-mono bg-blue-600 text-white px-2 py-0.5 rounded uppercase font-bold">
                    AI ASSISTANT • HUMAN SIGN-OFF REQUIRED
                  </span>
                </div>
                <span className="text-xs font-mono text-emerald-700 font-bold bg-emerald-100 border border-emerald-200 px-3 py-1 rounded-full">
                  RECOMMENDED: APPROVE ₹25,00,000
                </span>
              </div>
              <p className="text-xs text-slate-700 font-medium leading-relaxed">
                "Strong repayment capacity. Low recent delinquency. Banking trend stable with average monthly balance of ₹4.82 Lakhs. No major policy exception detected across CIBIL & Experian tradelines."
              </p>
            </div>

          </div>

          {/* Tab Content Display */}
          <AnimatePresence mode="wait">
            <motion.div
              key={activeUwTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
            >
              {activeUwTab === 'credit' && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="p-5 rounded-2xl bg-slate-900 text-white space-y-3 font-mono text-xs">
                    <div className="text-slate-400 font-bold border-b border-slate-800 pb-2">CIBIL COMMERCIAL REPORT</div>
                    <div className="flex justify-between"><span>Credit Score:</span> <strong className="text-emerald-400">782 / 900</strong></div>
                    <div className="flex justify-between"><span>Active Tradelines:</span> <strong className="text-white">4 Accounts</strong></div>
                    <div className="flex justify-between"><span>DPD History:</span> <strong className="text-emerald-400">0 DPD in 24 Months</strong></div>
                    <div className="flex justify-between"><span>Total Exposure:</span> <strong className="text-white">₹18.5 Lakhs</strong></div>
                  </div>

                  <div className="p-5 rounded-2xl bg-slate-900 text-white space-y-3 font-mono text-xs">
                    <div className="text-slate-400 font-bold border-b border-slate-800 pb-2">EXPERIAN CONSUMER PULL</div>
                    <div className="flex justify-between"><span>Credit Score:</span> <strong className="text-emerald-400">790 / 900</strong></div>
                    <div className="flex justify-between"><span>Enquiries (30d):</span> <strong className="text-emerald-400">1 Enquiry</strong></div>
                    <div className="flex justify-between"><span>Written Off:</span> <strong className="text-emerald-400">₹0</strong></div>
                    <div className="flex justify-between"><span>Suit Filed Status:</span> <strong className="text-emerald-400">NO SUIT FILED</strong></div>
                  </div>

                  <div className="p-5 rounded-2xl bg-slate-900 text-white space-y-3 font-mono text-xs">
                    <div className="text-slate-400 font-bold border-b border-slate-800 pb-2">POLICY RULES & FOIR</div>
                    <div className="flex justify-between"><span>Calculated FOIR:</span> <strong className="text-blue-400">38.2% (Max 45%)</strong></div>
                    <div className="flex justify-between"><span>DSCR Ratio:</span> <strong className="text-blue-400">1.85 (Min 1.30)</strong></div>
                    <div className="flex justify-between"><span>Maximum Sanction:</span> <strong className="text-emerald-400 font-bold">₹25,00,000</strong></div>
                    <div className="flex justify-between"><span>CAM Note Status:</span> <strong className="text-emerald-400">Auto-Generated</strong></div>
                  </div>
                </div>
              )}

              {activeUwTab === 'banking' && (
                <div className="p-5 rounded-2xl bg-slate-900 text-white font-mono text-xs space-y-3">
                  <div className="text-slate-400 font-bold border-b border-slate-800 pb-2">ACCOUNT AGGREGATOR (SETU / PERFIOS 12M BANKING PARSE)</div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                      <span className="text-slate-400 text-[10px]">Avg Bank Balance</span>
                      <div className="text-white font-bold text-sm">₹4,82,000</div>
                    </div>
                    <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                      <span className="text-slate-400 text-[10px]">Monthly Inflow</span>
                      <div className="text-emerald-400 font-bold text-sm">₹12,40,000</div>
                    </div>
                    <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                      <span className="text-slate-400 text-[10px]">Inward Bounces</span>
                      <div className="text-emerald-400 font-bold text-sm">0 Bounces</div>
                    </div>
                    <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                      <span className="text-slate-400 text-[10px]">Outward Bounces</span>
                      <div className="text-emerald-400 font-bold text-sm">0 Bounces</div>
                    </div>
                  </div>
                </div>
              )}

              {(activeUwTab === 'customer' || activeUwTab === 'gst' || activeUwTab === 'risk') && (
                <div className="p-5 rounded-2xl bg-slate-900 text-white font-mono text-xs space-y-3">
                  <div className="text-slate-400 font-bold border-b border-slate-800 pb-2">AUDITABLE VERIFICATION RECORDS</div>
                  <p className="text-slate-300 font-sans">
                    All document authentications are timestamped and cryptographically hashed in compliance with RBI Digital Lending Guidelines.
                  </p>
                </div>
              )}
            </motion.div>
          </AnimatePresence>

        </motion.div>

      </div>
    </section>
  );
};
