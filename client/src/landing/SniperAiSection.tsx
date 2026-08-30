import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, Send, ArrowRight, Bot } from 'lucide-react';

export const SniperAiSection: React.FC = () => {
  const [activePrompt, setActivePrompt] = useState<'attention' | 'unmatched' | 'risk'>('attention');
  const [customInput, setCustomInput] = useState('');

  return (
    <section id="sniper-ai" className="py-24 bg-slate-900 text-white relative overflow-hidden">
      
      {/* Background Accent Radial Overlay */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(37,99,235,0.25),rgba(255,255,255,0))]" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 space-y-12">
        
        {/* Section Header */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center max-w-3xl mx-auto space-y-4"
        >
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-blue-500/10 border border-blue-400/20 text-blue-300 text-xs font-bold uppercase tracking-wider">
            <Sparkles className="w-4 h-4 text-blue-400" />
            <span>SNIPER COGNITIVE INTELLIGENCE</span>
          </div>

          <h2 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight">
            MEET YOUR LENDING INTELLIGENCE LAYER.
          </h2>

          <p className="text-base sm:text-lg text-slate-300 leading-relaxed">
            An operational AI copilot designed specifically for lending executives. Synthesizes underwriting data, monitors SLA breaches, and recommends priority actions.
          </p>

          <div className="text-xs font-mono text-slate-400">
            * AI provides data synthesis & decision support. Autonomous credit approvals remain governed by your human maker-checker policy.
          </div>
        </motion.div>

        {/* Interactive Large AI Conversational Console */}
        <motion.div 
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="bg-slate-950 p-6 sm:p-8 rounded-3xl border border-slate-800 shadow-2xl max-w-4xl mx-auto space-y-6"
        >
          
          {/* Top Console Bar */}
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold shadow-lg">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-white text-base">SNIPER AI Copilot Engine v4.0</h3>
                <p className="text-xs text-slate-400">Connected to CRM, LOS, LMS & Bank Settlement Data</p>
              </div>
            </div>

            <span className="text-xs font-mono text-emerald-400 bg-emerald-950/80 border border-emerald-800 px-3 py-1 rounded-full font-bold flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              ONLINE & COPILOT READY
            </span>
          </div>

          {/* Quick Prompt Selectors */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-400 font-mono">Sample Operational Queries:</span>
            <button
              onClick={() => setActivePrompt('attention')}
              className={`px-3 py-1.5 rounded-lg border transition-all cursor-pointer ${
                activePrompt === 'attention' ? 'bg-blue-600 border-blue-500 text-white font-bold' : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
              }`}
            >
              "Which applications need my attention today?"
            </button>
            <button
              onClick={() => setActivePrompt('unmatched')}
              className={`px-3 py-1.5 rounded-lg border transition-all cursor-pointer ${
                activePrompt === 'unmatched' ? 'bg-blue-600 border-blue-500 text-white font-bold' : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
              }`}
            >
              "Show unmatched payments."
            </button>
            <button
              onClick={() => setActivePrompt('risk')}
              className={`px-3 py-1.5 rounded-lg border transition-all cursor-pointer ${
                activePrompt === 'risk' ? 'bg-blue-600 border-blue-500 text-white font-bold' : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
              }`}
            >
              "Analyze portfolio DPD trends."
            </button>
          </div>

          {/* Simulated Chat Dialogue Canvas */}
          <div className="space-y-4 font-sans">
            
            {/* User Message */}
            <div className="flex items-start gap-3 justify-end">
              <div className="bg-blue-600 text-white p-3.5 rounded-2xl rounded-tr-xs text-xs sm:text-sm font-medium max-w-lg shadow-md">
                {activePrompt === 'attention' && "Which applications need my attention today?"}
                {activePrompt === 'unmatched' && "Show unmatched payments."}
                {activePrompt === 'risk' && "Analyze portfolio DPD trends for this month."}
              </div>
            </div>

            {/* AI Assistant Response */}
            <AnimatePresence mode="wait">
              <motion.div 
                key={activePrompt}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                transition={{ duration: 0.3 }}
                className="flex items-start gap-3"
              >
                <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-lg">
                  <Bot className="w-4 h-4" />
                </div>
                <div className="bg-slate-900 border border-slate-800 text-slate-200 p-4 rounded-2xl rounded-tl-xs text-xs sm:text-sm space-y-3 max-w-2xl shadow-md">
                  
                  {activePrompt === 'attention' && (
                    <>
                      <p className="font-bold text-white text-sm">
                        12 applications require underwriter attention today:
                      </p>
                      <ul className="space-y-1.5 font-mono text-xs text-slate-300 list-disc list-inside">
                        <li><strong className="text-rose-400">4 applications</strong> breached their 30-minute approval SLA</li>
                        <li><strong className="text-amber-400">3 applications</strong> have missing GST 3B document uploads</li>
                        <li><strong className="text-sky-400">2 applications</strong> triggered a policy exception for FOIR &gt; 45%</li>
                        <li><strong className="text-blue-400">3 applications</strong> are awaiting final underwriter signoff</li>
                      </ul>
                      <div className="pt-2 flex items-center gap-2">
                        <a href="#los" className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-colors inline-flex items-center gap-1">
                          <span>OPEN PRIORITY QUEUE</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </a>
                      </div>
                    </>
                  )}

                  {activePrompt === 'unmatched' && (
                    <>
                      <p className="font-bold text-white text-sm">
                        12 unmatched transactions found requiring manual match verification:
                      </p>
                      <p className="text-xs text-slate-300 font-mono">
                        Top candidate match: ₹52,400 via NEFT UTR9823417721 linked with 98.4% confidence to Loan #LN-20481 (Rahul Sharma).
                      </p>
                      <div className="pt-2">
                        <a href="#reconciliation" className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-colors inline-flex items-center gap-1">
                          <span>REVIEW RECONCILIATION QUEUE</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </a>
                      </div>
                    </>
                  )}

                  {activePrompt === 'risk' && (
                    <>
                      <p className="font-bold text-white text-sm">
                        Portfolio DPD risk analysis complete:
                      </p>
                      <p className="text-xs text-slate-300 font-mono leading-relaxed">
                        Overall 30+ DPD reduced from 2.4% to 1.8% month-over-month. High collection efficiency observed in MSME Working Capital product segment (97.8%).
                      </p>
                      <div className="pt-2">
                        <a href="#analytics" className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-colors inline-flex items-center gap-1">
                          <span>VIEW PORTFOLIO ANALYTICS</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </a>
                      </div>
                    </>
                  )}

                </div>
              </motion.div>
            </AnimatePresence>

          </div>

          {/* Input Simulation Bar */}
          <div className="pt-2 flex items-center gap-2 border-t border-slate-800">
            <input 
              type="text" 
              placeholder="Ask SNIPER AI Copilot about loan applications, risk alerts, or repayments..."
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-sans"
            />
            <button 
              onClick={() => {
                if (customInput) {
                  setActivePrompt('attention');
                  setCustomInput('');
                }
              }}
              className="p-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl cursor-pointer transition-colors"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>

          {/* AI -> DATA -> INSIGHT -> ACTION Visualization */}
          <div className="pt-4 border-t border-slate-800 grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs font-mono">
            <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300">
              <span className="text-blue-400 font-bold block">1. AI INGESTION</span>
              <span className="text-[10px] text-slate-500">Live API Data Streams</span>
            </div>
            <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300">
              <span className="text-blue-400 font-bold block">2. DATA SYNTHESIS</span>
              <span className="text-[10px] text-slate-500">Dual Bureau + Banking</span>
            </div>
            <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300">
              <span className="text-blue-400 font-bold block">3. COPILOT INSIGHT</span>
              <span className="text-[10px] text-slate-500">Risk & SLA Breach Flag</span>
            </div>
            <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300">
              <span className="text-blue-400 font-bold block">4. HUMAN ACTION</span>
              <span className="text-[10px] text-slate-500">Underwriter Approval</span>
            </div>
          </div>

        </motion.div>

      </div>
    </section>
  );
};
