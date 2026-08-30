import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Play, 
  Pause, 
  RotateCcw, 
  CheckCircle, 
  Cpu, 
  FileText, 
  CreditCard, 
  ShieldCheck, 
  Sparkles,
  Users,
  Activity,
  Zap,
  Layers
} from 'lucide-react';

export const HeroVideo: React.FC = () => {
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentStep, setCurrentStep] = useState(0);

  const steps = [
    { 
      title: '01. CRM Lead Ingestion', 
      desc: 'Real-time lead scoring & WhatsApp intent parsing with dual attribution', 
      icon: Users, 
      color: 'from-blue-500 to-indigo-600',
      image: 'https://images.unsplash.com/photo-1551836022-d5d88e9218df?auto=format&fit=crop&w=800&q=80'
    },
    { 
      title: '02. Application & KYC', 
      desc: 'Aadhaar eKYC, CKYC pull & OCR document verification in sub-3 seconds', 
      icon: FileText, 
      color: 'from-indigo-500 to-purple-600',
      image: 'https://images.unsplash.com/photo-1563986768609-322da13575f3?auto=format&fit=crop&w=800&q=80'
    },
    { 
      title: '03. Bureau & Banking AA', 
      desc: 'CIBIL dual pull & Account Aggregator cashflow analysis', 
      icon: Activity, 
      color: 'from-purple-500 to-sky-600',
      image: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=800&q=80'
    },
    { 
      title: '04. Autonomous BRE', 
      desc: 'FOIR <= 45%, DSCR >= 1.4, Sub-second credit policy rule execution', 
      icon: Cpu, 
      color: 'from-sky-500 to-emerald-600',
      image: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=800&q=80'
    },
    { 
      title: '05. Underwriting & CAM', 
      desc: 'AI credit synthesis, risk rating & maker-checker signoff workflow', 
      icon: ShieldCheck, 
      color: 'from-emerald-500 to-teal-600',
      image: 'https://images.unsplash.com/photo-1507679799987-c73779587ccf?auto=format&fit=crop&w=800&q=80'
    },
    { 
      title: '06. KFS & eSign', 
      desc: 'RBI Key Fact Statement, APR audit & Aadhaar eSign vaulting', 
      icon: FileText, 
      color: 'from-teal-500 to-blue-600',
      image: 'https://images.unsplash.com/photo-1450133064473-71024230f91b?auto=format&fit=crop&w=800&q=80'
    },
    { 
      title: '07. Disbursement', 
      desc: 'Instant bank payout via Razorpay / Cashfree API with zero delay', 
      icon: Zap, 
      color: 'from-blue-600 to-indigo-700',
      image: 'https://images.unsplash.com/photo-1559526324-4b87b5e36e44?auto=format&fit=crop&w=800&q=80'
    },
    { 
      title: '08. LMS & Servicing', 
      desc: 'Automated EMI scheduling, principal accounting & interest accrual', 
      icon: Layers, 
      color: 'from-indigo-600 to-purple-700',
      image: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?auto=format&fit=crop&w=800&q=80'
    },
    { 
      title: '09. Auto Reconciliation', 
      desc: '98.7% automated bank statement matching via NEFT/RTGS UTR', 
      icon: CreditCard, 
      color: 'from-purple-600 to-pink-600',
      image: 'https://images.unsplash.com/photo-1526304640581-d334cdbbf45e?auto=format&fit=crop&w=800&q=80'
    },
    { 
      title: '10. Smart Collections & AI', 
      desc: 'SNIPER Copilot risk alerts, PTP WhatsApp & field dispatch route opt', 
      icon: Sparkles, 
      color: 'from-blue-600 to-cyan-600',
      image: 'https://images.unsplash.com/photo-1573164713988-8665fc963095?auto=format&fit=crop&w=800&q=80'
    }
  ];

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isPlaying) {
      interval = setInterval(() => {
        setCurrentStep((prev) => (prev + 1) % steps.length);
      }, 3500);
    }
    return () => clearInterval(interval);
  }, [isPlaying]);

  return (
    <section className="relative -mt-6 pb-20 bg-slate-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Browser Frame */}
        <motion.div 
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="relative rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden"
        >
          
          {/* Top Browser Bar */}
          <div className="bg-slate-950 px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-rose-500" />
              <div className="w-3 h-3 rounded-full bg-amber-500" />
              <div className="w-3 h-3 rounded-full bg-emerald-500" />
              <div className="ml-4 text-xs font-mono text-slate-400 bg-slate-900 px-3 py-1 rounded-md border border-slate-800 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                <span>app.sniperlending.in/live-lifecycle-monitor</span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-[11px] font-mono text-emerald-400 bg-emerald-950/80 border border-emerald-800/80 px-3 py-1 rounded-full flex items-center gap-1.5 font-bold">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                REAL-TIME MOTION
              </span>
              <button 
                onClick={() => setIsPlaying(!isPlaying)}
                className="text-slate-400 hover:text-white p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 transition-colors cursor-pointer"
                title={isPlaying ? "Pause Motion" : "Play Motion"}
              >
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </button>
              <button 
                onClick={() => setCurrentStep(0)}
                className="text-slate-400 hover:text-white p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 transition-colors cursor-pointer"
                title="Reset Flow"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Screen Content - Simulated Live Product Workspace */}
          <div className="p-6 md:p-8 bg-slate-950 text-slate-100 min-h-[480px] flex flex-col justify-between relative">
            
            {/* Top Workspace Bar */}
            <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center text-white font-bold text-sm shadow-lg">
                  NX
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-extrabold text-base text-white">Application #NX-10482 Workspace</h3>
                    <span className="text-xs bg-blue-900/80 text-blue-300 border border-blue-700/80 px-2.5 py-0.5 rounded font-mono font-bold">
                      ₹25,00,000 Business Loan
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 font-mono">Applicant: Rahul Sharma (Ananya Corp) • Product: MSME Expansion Credit</p>
                </div>
              </div>

              {/* Progress Indicator */}
              <div className="flex items-center gap-2 text-xs font-mono text-slate-400 bg-slate-900 px-3 py-1.5 rounded-xl border border-slate-800">
                <span>STAGE {currentStep + 1} OF 10</span>
                <span className="text-slate-600">|</span>
                <span className="text-blue-400 font-bold">{steps[currentStep].title}</span>
              </div>
            </div>

            {/* Middle Main Animated Canvas */}
            <div className="my-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
              
              {/* Left Stage Details & Live Metrics */}
              <div className="lg:col-span-7 space-y-4">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-xs font-mono text-blue-400 font-bold">
                  <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                  AUTOMATED LIFECYCLE PIPELINE
                </div>

                <AnimatePresence mode="wait">
                  <motion.div
                    key={currentStep}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ duration: 0.4 }}
                    className="space-y-4"
                  >
                    <h2 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight">
                      {steps[currentStep].title}
                    </h2>

                    <p className="text-sm sm:text-base text-slate-300 leading-relaxed max-w-xl">
                      {steps[currentStep].desc}
                    </p>

                    {/* Live Processing Cards */}
                    <div className="grid grid-cols-2 gap-3 pt-2">
                      <div className="bg-slate-900/90 p-4 rounded-2xl border border-slate-800">
                        <span className="text-[10px] uppercase font-mono text-slate-400 font-bold">System Evaluation</span>
                        <div className="text-sm font-bold text-emerald-400 flex items-center gap-1.5 mt-1">
                          <CheckCircle className="w-4 h-4 text-emerald-400" />
                          <span>PASSED & VERIFIED</span>
                        </div>
                      </div>
                      <div className="bg-slate-900/90 p-4 rounded-2xl border border-slate-800">
                        <span className="text-[10px] uppercase font-mono text-slate-400 font-bold">Execution Speed</span>
                        <div className="text-sm font-bold text-blue-400 flex items-center gap-1.5 mt-1">
                          <Zap className="w-4 h-4 text-blue-400" />
                          <span>420 milliseconds</span>
                        </div>
                      </div>
                    </div>

                    {/* Stage Specific Payload */}
                    <div className="p-3.5 bg-slate-900/80 rounded-xl border border-slate-800 text-xs font-mono text-slate-300 flex items-center justify-between">
                      <span className="text-slate-400 font-bold">Data Payload:</span>
                      <span className="text-blue-300 font-semibold truncate ml-2">
                        {currentStep === 0 && '{ leadScore: 94, crmChannel: "WhatsApp_Bot", assignedOfficer: "Deepak R." }'}
                        {currentStep === 1 && '{ kycType: "Aadhaar_eKYC", panStatus: "VALID", ckycNo: "90214819" }'}
                        {currentStep === 2 && '{ cibilScore: 782, experianScore: 790, aaBankBalanceAvg: "₹4.8L" }'}
                        {currentStep === 3 && '{ breResult: "ELIGIBLE", foir: "38%", dscr: "1.85", maxSanction: "₹25L" }'}
                        {currentStep === 4 && '{ uwOpinion: "RECOMMENDED_APPROVE", riskGrade: "A+", camGenerated: true }'}
                        {currentStep === 5 && '{ kfsApr: "12.85%", totalCharges: "₹12,500", eSignStatus: "COMPLETED" }'}
                        {currentStep === 6 && '{ payoutStatus: "SUCCESS", bankAccount: "HDFC..9012", utr: "UTR901824" }'}
                        {currentStep === 7 && '{ lmsAccountNo: "LMS-90182", emiAmount: "₹51,000", nextDueDate: "05 Sep" }'}
                        {currentStep === 8 && '{ matchConfidence: "99.2%", autoPosted: true, ledgerStatus: "CLEARED" }'}
                        {currentStep === 9 && '{ riskAlerts: 0, ptpStatus: "ON_TIME", copilotAssessment: "STRONG" }'}
                      </span>
                    </div>
                  </motion.div>
                </AnimatePresence>
              </div>

              {/* Right Morphing UI + Unsplash High Quality Media Card */}
              <div className="lg:col-span-5">
                <AnimatePresence mode="wait">
                  <motion.div 
                    key={currentStep}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.4 }}
                    className="relative rounded-2xl bg-slate-900 border border-slate-800 overflow-hidden shadow-2xl group"
                  >
                    <div className="relative h-56 sm:h-64 overflow-hidden">
                      <img 
                        src={steps[currentStep].image} 
                        alt={steps[currentStep].title} 
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 opacity-60"
                        referrerPolicy="no-referrer"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/50 to-transparent" />

                      <div className="absolute top-3 left-3 flex items-center gap-2">
                        <span className="text-[10px] font-mono bg-blue-900/90 text-blue-200 border border-blue-700 px-2.5 py-1 rounded-full font-bold">
                          LIVE TELEMETRY
                        </span>
                      </div>

                      <div className="absolute bottom-4 left-4 right-4 space-y-1">
                        <div className="flex items-center gap-2 text-white font-extrabold text-lg">
                          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
                            {React.createElement(steps[currentStep].icon, { className: "w-4 h-4 text-white" })}
                          </div>
                          <span>{steps[currentStep].title}</span>
                        </div>
                        <p className="text-xs text-slate-300 line-clamp-1">{steps[currentStep].desc}</p>
                      </div>
                    </div>

                    {/* Step Selector Buttons */}
                    <div className="p-4 bg-slate-950 border-t border-slate-800 space-y-2">
                      <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
                        <span>Click stage to preview:</span>
                        <span className="text-blue-400 font-bold">{currentStep + 1}/10</span>
                      </div>
                      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                        {steps.map((_, idx) => (
                          <button
                            key={idx}
                            onClick={() => { setCurrentStep(idx); setIsPlaying(false); }}
                            className={`h-2.5 rounded-full transition-all cursor-pointer ${
                              idx === currentStep ? 'w-8 bg-blue-500' : 'w-2.5 bg-slate-800 hover:bg-slate-700'
                            }`}
                            title={`Go to step ${idx + 1}`}
                          />
                        ))}
                      </div>
                    </div>
                  </motion.div>
                </AnimatePresence>
              </div>

            </div>

            {/* Bottom Stepper Nav */}
            <div className="pt-4 border-t border-slate-800/80 grid grid-cols-2 sm:grid-cols-5 lg:grid-cols-10 gap-1.5">
              {steps.map((step, idx) => {
                const isActive = idx === currentStep;
                const isPast = idx < currentStep;
                return (
                  <button
                    key={idx}
                    onClick={() => { setCurrentStep(idx); setIsPlaying(false); }}
                    className={`p-2.5 rounded-xl text-left transition-all cursor-pointer border ${
                      isActive 
                        ? 'bg-blue-600/30 border-blue-500 text-white font-bold' 
                        : isPast 
                          ? 'bg-slate-900/60 border-slate-800 text-slate-300 hover:border-slate-700'
                          : 'bg-slate-950 border-slate-900 text-slate-500 hover:text-slate-400'
                    }`}
                  >
                    <div className="text-[10px] font-mono font-semibold truncate">
                      {idx + 1}. {step.title.split(' ')[1] || step.title}
                    </div>
                  </button>
                );
              })}
            </div>

          </div>

        </motion.div>

      </div>
    </section>
  );
};
