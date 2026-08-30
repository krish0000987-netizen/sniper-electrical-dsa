import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Play, CheckCircle2, Calendar, ShieldCheck, Sparkles, Send, ArrowRight, User, Mail, Building, Phone } from 'lucide-react';

interface DemoModalProps {
  isOpen: boolean;
  type: 'demo' | 'tour' | 'live';
  onClose: () => void;
}

export const DemoModal: React.FC<DemoModalProps> = ({ isOpen, type, onClose }) => {
  const [submitted, setSubmitted] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    company: '',
    phone: '',
    product: 'MSME & Personal Loans',
    volume: '₹10 Cr - ₹50 Cr / month'
  });

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
        {/* Backdrop */}
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-md"
        />

        {/* Modal Window */}
        <motion.div 
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 20 }}
          transition={{ type: "spring", stiffness: 300, damping: 25 }}
          className="relative w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden text-white z-10 my-8"
        >
          {/* Header */}
          <div className="p-6 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center font-bold text-white shadow-lg">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="font-extrabold text-lg text-white">
                  {type === 'demo' && 'Schedule Executive Private Demo'}
                  {type === 'tour' && 'SNIPER Lending OS Product Tour'}
                  {type === 'live' && 'Instant Sandbox Exploration'}
                </h3>
                <p className="text-xs text-slate-400">
                  {type === 'demo' && '1-on-1 walkthrough with a Senior Solution Architect'}
                  {type === 'tour' && 'Full 4-minute overview of end-to-end loan lifecycle'}
                  {type === 'live' && 'Explore simulated CRM, LOS, LMS & BRE in real-time'}
                </p>
              </div>
            </div>

            <button 
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white rounded-full bg-slate-900 hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body Content */}
          <div className="p-6 sm:p-8 space-y-6">
            
            {type === 'tour' && (
              <div className="space-y-4">
                <div className="relative aspect-video rounded-2xl overflow-hidden border border-slate-800 bg-slate-950 flex items-center justify-center group">
                  <img 
                    src="https://images.unsplash.com/photo-1551836022-d5d88e9218df?auto=format&fit=crop&w=1200&q=80" 
                    alt="Product Tour Thumbnail"
                    className="absolute inset-0 w-full h-full object-cover opacity-50 group-hover:scale-105 transition-transform duration-700"
                    referrerPolicy="no-referrer"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/40 to-transparent" />
                  
                  <div className="relative z-10 text-center space-y-3 p-4">
                    <div className="w-16 h-16 rounded-full bg-blue-600/90 hover:bg-blue-500 text-white flex items-center justify-center mx-auto shadow-2xl transition-all cursor-pointer group-hover:scale-110">
                      <Play className="w-8 h-8 fill-white ml-1" />
                    </div>
                    <span className="text-xs font-mono text-blue-300 bg-blue-950/80 border border-blue-800 px-3 py-1 rounded-full block">
                      Watch HD Walkthrough (4 mins)
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 font-mono text-xs text-slate-300 text-center">
                  <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                    <span className="text-blue-400 font-bold block">01. ORIGINATION</span>
                    <span className="text-[10px] text-slate-500">Aadhaar + GST Pull</span>
                  </div>
                  <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                    <span className="text-blue-400 font-bold block">02. BRE DECISION</span>
                    <span className="text-[10px] text-slate-500">Sub-second Policy</span>
                  </div>
                  <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                    <span className="text-blue-400 font-bold block">03. LMS RECON</span>
                    <span className="text-[10px] text-slate-500">98.7% Auto Match</span>
                  </div>
                </div>
              </div>
            )}

            {(type === 'demo' || type === 'live') && (
              submitted ? (
                <div className="text-center py-12 space-y-4 font-sans">
                  <div className="w-16 h-16 rounded-full bg-emerald-950 border border-emerald-800 text-emerald-400 flex items-center justify-center mx-auto">
                    <CheckCircle2 className="w-8 h-8" />
                  </div>
                  <h4 className="text-2xl font-bold text-white">Demo Request Confirmed!</h4>
                  <p className="text-slate-300 text-sm max-w-md mx-auto">
                    Thank you, {formData.name}. Our Solutions Engineering team will reach out within 2 hours to schedule your customized SNIPER walkthrough.
                  </p>
                  <button
                    onClick={onClose}
                    className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs transition-colors cursor-pointer"
                  >
                    RETURN TO PLATFORM
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">Full Name</label>
                      <div className="relative">
                        <User className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                        <input
                          type="text"
                          required
                          placeholder="e.g. Vikram Mehta"
                          value={formData.name}
                          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">Work Email</label>
                      <div className="relative">
                        <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                        <input
                          type="email"
                          required
                          placeholder="vikram@nbfc-finance.in"
                          value={formData.email}
                          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">Institution Name</label>
                      <div className="relative">
                        <Building className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                        <input
                          type="text"
                          required
                          placeholder="e.g. Zenith Capital Services"
                          value={formData.company}
                          onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">Mobile Number</label>
                      <div className="relative">
                        <Phone className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                        <input
                          type="tel"
                          required
                          placeholder="+91 98765 43210"
                          value={formData.phone}
                          onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">Primary Loan Product</label>
                      <select
                        value={formData.product}
                        onChange={(e) => setFormData({ ...formData, product: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500"
                      >
                        <option>MSME Working Capital</option>
                        <option>Personal Loans</option>
                        <option>Loan Against Property (LAP)</option>
                        <option>Gold Loans</option>
                        <option>Co-Lending & Supply Chain</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">Monthly Loan Volume</label>
                      <select
                        value={formData.volume}
                        onChange={(e) => setFormData({ ...formData, volume: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500"
                      >
                        <option>&lt; ₹10 Crore / month</option>
                        <option>₹10 Crore - ₹50 Crore / month</option>
                        <option>₹50 Crore - ₹200 Crore / month</option>
                        <option>&gt; ₹200 Crore / month</option>
                      </select>
                    </div>
                  </div>

                  <div className="pt-2">
                    <button
                      type="submit"
                      className="w-full py-3.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs transition-all shadow-lg hover:shadow-blue-600/25 cursor-pointer flex items-center justify-center gap-2"
                    >
                      <span>CONFIRM DEMO RESERVATION</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </form>
              )
            )}

          </div>

          <div className="p-4 bg-slate-950 border-t border-slate-800 text-center text-[10px] text-slate-500 font-mono">
            Protected by SOC 2 Type II & ISO 27001 Security Standards • No Credit Card Required
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
