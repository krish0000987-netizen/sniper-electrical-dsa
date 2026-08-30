import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  FileSpreadsheet, 
  Mail, 
  MessageSquare, 
  CreditCard, 
  FileText, 
  PieChart, 
  AlertOctagon, 
  CheckCircle, 
  Sparkles,
  ShieldCheck
} from 'lucide-react';

export const ProblemSection: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false);

  const fragmentedSystems = [
    { name: 'Legacy CRM', icon: Mail, problem: 'Leads lost in emails', color: 'border-red-200 bg-red-50/50 text-red-700' },
    { name: 'Excel Spreadsheets', icon: FileSpreadsheet, problem: 'Manual loan tracking', color: 'border-amber-200 bg-amber-50/50 text-amber-700' },
    { name: 'WhatsApp Groups', icon: MessageSquare, problem: 'Untracked agent comms', color: 'border-emerald-200 bg-emerald-50/50 text-emerald-700' },
    { name: 'Standalone Bureau', icon: ShieldCheck, problem: 'Manual PDF bureau pulls', color: 'border-sky-200 bg-sky-50/50 text-sky-700' },
    { name: 'Manual Documents', icon: FileText, problem: 'Days wasted on paper OCR', color: 'border-indigo-200 bg-indigo-50/50 text-indigo-700' },
    { name: 'External Gateway', icon: CreditCard, problem: 'Unmatched bank payouts', color: 'border-purple-200 bg-purple-50/50 text-purple-700' },
    { name: 'Offline Collections', icon: AlertOctagon, problem: 'No real-time PTP tracking', color: 'border-rose-200 bg-rose-50/50 text-rose-700' },
    { name: 'Fragmented Reports', icon: PieChart, problem: 'Stale 30-day delayed MIS', color: 'border-slate-200 bg-slate-100/50 text-slate-700' }
  ];

  return (
    <section className="py-24 bg-white relative overflow-hidden border-b border-slate-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Section Header */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center max-w-3xl mx-auto space-y-4 mb-16"
        >
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-50 text-red-700 text-xs font-bold uppercase tracking-wider">
            <AlertOctagon className="w-3.5 h-3.5 text-red-600" />
            <span>THE OPERATIONAL BOTTLENECK</span>
          </div>

          <h2 className="text-3xl sm:text-5xl font-extrabold text-slate-950 tracking-tight leading-tight">
            LENDING OPERATIONS SHOULDN'T LIVE IN 12 DIFFERENT SYSTEMS.
          </h2>

          <p className="text-base sm:text-lg text-slate-600">
            Siloed tools create delayed approvals, unreconciled payments, compliance leaks, and broken borrower experiences.
          </p>

          <div className="pt-2">
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="px-6 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold tracking-wider uppercase transition-all cursor-pointer shadow-md inline-flex items-center gap-2 group"
            >
              <span>{collapsed ? "Expand Fragmented View" : "Simulate SNIPER Unification"}</span>
              <Sparkles className="w-4 h-4 text-blue-400 group-hover:rotate-12 transition-transform" />
            </button>
          </div>
        </motion.div>

        {/* Transformation Canvas */}
        <motion.div 
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="relative min-h-[380px] p-8 rounded-3xl bg-slate-50 border border-slate-200/90 shadow-inner flex flex-col justify-between transition-all duration-500"
        >
          <AnimatePresence mode="wait">
            {!collapsed ? (
              /* State 1: Fragmented Systems Scatter */
              <motion.div 
                key="fragmented"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.4 }}
                className="space-y-6"
              >
                <div className="flex items-center justify-between pb-4 border-b border-slate-200">
                  <span className="text-xs font-mono font-bold text-red-600 uppercase flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
                    STATUS: FRAGMENTED DISCONNECTED STACK (10+ VENDORS)
                  </span>
                  <span className="text-xs font-mono text-slate-500">High Risk • 14-Day Loan SLA</span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {fragmentedSystems.map((sys, idx) => (
                    <motion.div 
                      key={idx}
                      whileHover={{ scale: 1.03 }}
                      className={`p-4 rounded-2xl border ${sys.color} shadow-2xs transition-all flex flex-col justify-between space-y-2`}
                    >
                      <div className="flex items-center justify-between">
                        <sys.icon className="w-5 h-5" />
                        <span className="text-[10px] font-mono uppercase bg-white/80 px-1.5 py-0.5 rounded font-bold">
                          Isolated
                        </span>
                      </div>
                      <div>
                        <div className="text-sm font-bold text-slate-900">{sys.name}</div>
                        <div className="text-xs text-slate-500">{sys.problem}</div>
                      </div>
                    </motion.div>
                  ))}
                </div>

                <div className="text-center pt-4">
                  <p className="text-xs font-mono text-slate-500">
                    ↑ Click "Simulate SNIPER Unification" above to see how SNIPER merges all 12 modules into 1 unified engine.
                  </p>
                </div>
              </motion.div>
            ) : (
              /* State 2: Collapsed into One Connected SNIPER Engine */
              <motion.div 
                key="unified"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.5 }}
                className="py-6 space-y-8"
              >
                <div className="flex items-center justify-between pb-4 border-b border-blue-200">
                  <span className="text-xs font-mono font-bold text-blue-700 uppercase flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                    STATUS: SNIPER UNIFIED LENDING ENGINE ACTIVE
                  </span>
                  <span className="text-xs font-mono text-emerald-700 font-bold">Zero Reconciliation Gaps • Sub-3 Min SLA</span>
                </div>

                <div className="p-8 rounded-3xl bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 text-white shadow-2xl border border-blue-800 text-center relative overflow-hidden space-y-6">
                  <div className="w-16 h-16 rounded-2xl bg-blue-600 text-white mx-auto flex items-center justify-center font-extrabold text-2xl shadow-xl border border-blue-400">
                    SNIPER
                  </div>

                  <div className="max-w-2xl mx-auto space-y-2">
                    <h3 className="text-2xl font-extrabold tracking-tight text-white">
                      ONE CONNECTED OPERATING SYSTEM
                    </h3>
                    <p className="text-sm text-slate-300 leading-relaxed">
                      CRM, LOS, LMS, Credit BRE, Payments, Collections, Compliance and AI unified in a single high-performance engine.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-3xl mx-auto pt-2 text-xs font-mono">
                    <div className="p-2.5 rounded-xl bg-slate-800/90 border border-slate-700 text-emerald-400 flex items-center justify-center gap-1.5">
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Single Customer 360</span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-800/90 border border-slate-700 text-emerald-400 flex items-center justify-center gap-1.5">
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Instant KFS & APR</span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-800/90 border border-slate-700 text-emerald-400 flex items-center justify-center gap-1.5">
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Auto Reconciliation</span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-800/90 border border-slate-700 text-emerald-400 flex items-center justify-center gap-1.5">
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Autonomous AI Copilot</span>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

      </div>
    </section>
  );
};
