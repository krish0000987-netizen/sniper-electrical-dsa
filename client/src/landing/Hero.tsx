import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ArrowRight, 
  ShieldCheck, 
  Sparkles, 
  Play, 
  CheckCircle2, 
  Zap, 
  TrendingUp, 
  Layers, 
  Cpu,
  Activity,
  CreditCard,
  Building2,
  Lock,
  Globe
} from 'lucide-react';

interface HeroProps {
  onOpenBookDemo: () => void;
  onOpenTour: () => void;
  onOpenLiveDemo: () => void;
}

export const Hero: React.FC<HeroProps> = ({ onOpenBookDemo, onOpenTour, onOpenLiveDemo }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [activePreview, setActivePreview] = useState<'analytics' | 'bre' | 'reconcile'>('analytics');

  // High-Tech Animated Particle Mesh Canvas Background Effect
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let width = (canvas.width = canvas.offsetWidth);
    let height = (canvas.height = canvas.offsetHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = canvas.offsetWidth;
      height = canvas.height = canvas.offsetHeight;
    };
    window.addEventListener('resize', handleResize);

    const particles: Array<{ x: number; y: number; vx: number; vy: number; radius: number }> = [];
    for (let i = 0; i < 45; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        radius: Math.random() * 2 + 1,
      });
    }

    const render = () => {
      ctx.clearRect(0, 0, width, height);

      // Draw subtle connecting lines
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < 130) {
            ctx.beginPath();
            ctx.strokeStyle = `rgba(37, 99, 235, ${0.15 * (1 - dist / 130)})`;
            ctx.lineWidth = 1;
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.stroke();
          }
        }
      }

      // Render nodes
      particles.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;

        if (p.x < 0 || p.x > width) p.vx *= -1;
        if (p.y < 0 || p.y > height) p.vy *= -1;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = '#2563eb';
        ctx.fill();
      });

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <section className="relative pt-28 pb-20 md:pt-36 md:pb-28 bg-slate-950 text-white overflow-hidden border-b border-slate-800">
      
      {/* Background High Tech Particle Canvas */}
      <canvas 
        ref={canvasRef} 
        className="absolute inset-0 w-full h-full opacity-40 pointer-events-none z-0" 
      />

      {/* Background Radial Glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[750px] h-[500px] bg-blue-600/20 blur-[150px] rounded-full pointer-events-none" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 space-y-12">
        <div className="text-center max-w-4xl mx-auto space-y-8">
          
          {/* Top Brand Logo & Trust Badge */}
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="inline-flex items-center gap-3 px-5 py-2 rounded-full bg-slate-900/90 border border-slate-800 text-slate-200 text-xs font-mono shadow-2xl backdrop-blur-md"
          >
            {/* Logo Emblem */}
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-blue-600 flex items-center justify-center font-black text-white text-xs shadow-md shadow-blue-600/50">
                N
              </div>
              <span className="font-extrabold text-white tracking-widest text-sm">SNIPER</span>
            </div>

            <span className="text-slate-700">|</span>
            
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="font-bold text-slate-200">LENDING OS v4.0</span>
            </div>

            <span className="text-slate-700 hidden sm:inline">|</span>

            <span className="text-slate-400 hidden sm:flex items-center gap-1">
              RBI Compliant Infrastructure
              <ShieldCheck className="w-3.5 h-3.5 text-blue-400 inline ml-0.5" />
            </span>
          </motion.div>

          {/* Main Headline */}
          <motion.h1 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.1 }}
            className="text-4xl sm:text-6xl lg:text-7xl font-black tracking-tight text-white leading-[1.05] text-balance"
          >
            THE ENTERPRISE <br className="hidden sm:inline" />
            <span className="bg-gradient-to-r from-blue-400 via-indigo-200 to-emerald-400 bg-clip-text text-transparent underline decoration-blue-500/40 underline-offset-8">
              OPERATING SYSTEM
            </span> <br />
            FOR MODERN CREDIT.
          </motion.h1>

          {/* Supporting Line */}
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="text-lg sm:text-xl font-bold text-blue-300 tracking-tight flex items-center justify-center gap-2 flex-wrap font-mono"
          >
            <span>Originate.</span>
            <span className="text-slate-600">•</span>
            <span>Underwrite.</span>
            <span className="text-slate-600">•</span>
            <span>Service.</span>
            <span className="text-slate-600">•</span>
            <span>Reconcile.</span>
            <span className="text-slate-600">•</span>
            <span>Collect.</span>
          </motion.p>

          {/* Subheadline */}
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.3 }}
            className="text-base sm:text-lg text-slate-300 font-normal leading-relaxed max-w-3xl mx-auto"
          >
            Unified CRM, LOS, LMS, credit decisioning engine, automated bank reconciliation, collections, and AI copilot engineered for high-volume Indian financial institutions.
          </motion.p>

          {/* CTAs */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.4 }}
            className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4"
          >
            <button
              onClick={onOpenBookDemo}
              className="w-full sm:w-auto px-8 py-4 text-xs font-bold uppercase tracking-wider text-white bg-blue-600 hover:bg-blue-500 rounded-xl shadow-xl shadow-blue-600/30 transition-all cursor-pointer flex items-center justify-center gap-2 group"
            >
              <span>BOOK PRIVATE DEMO</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </button>

            <button
              onClick={onOpenTour}
              className="w-full sm:w-auto px-7 py-4 text-xs font-bold uppercase tracking-wider text-slate-200 hover:text-white bg-slate-900/80 hover:bg-slate-800 border border-slate-800 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2 backdrop-blur-md"
            >
              <Play className="w-4 h-4 text-blue-400 fill-blue-400" />
              <span>WATCH PRODUCT TOUR</span>
            </button>

            <button
              onClick={onOpenLiveDemo}
              className="w-full sm:w-auto px-6 py-4 text-xs font-bold uppercase tracking-wider text-emerald-300 hover:text-emerald-200 bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-800/80 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 backdrop-blur-md"
            >
              <Sparkles className="w-4 h-4 text-emerald-400" />
              <span>EXPLORE SANDBOX</span>
            </button>
          </motion.div>

        </div>

        {/* High Quality Animated Business Image Showcase Container */}
        <motion.div 
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, delay: 0.5 }}
          className="relative max-w-5xl mx-auto rounded-3xl bg-slate-900 border border-slate-800 p-2 sm:p-4 shadow-2xl overflow-hidden"
        >
          
          {/* Floating Motion Badge 1 - Top Left */}
          <motion.div 
            animate={{ y: [0, -8, 0] }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            className="absolute top-6 left-6 z-20 hidden md:flex items-center gap-3 px-4 py-2.5 bg-slate-950/90 border border-blue-500/40 rounded-2xl shadow-2xl backdrop-blur-md text-xs font-mono"
          >
            <div className="w-8 h-8 rounded-xl bg-emerald-950 border border-emerald-800 text-emerald-400 flex items-center justify-center font-bold">
              <TrendingUp className="w-4 h-4" />
            </div>
            <div>
              <div className="text-[10px] text-slate-400 font-bold uppercase">DISBURSED VOLUME</div>
              <div className="text-white font-extrabold text-sm">₹10,000 Cr+ Processed</div>
            </div>
          </motion.div>

          {/* Floating Motion Badge 2 - Bottom Right */}
          <motion.div 
            animate={{ y: [0, 8, 0] }}
            transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
            className="absolute bottom-10 right-6 z-20 hidden md:flex items-center gap-3 px-4 py-2.5 bg-slate-950/90 border border-emerald-500/40 rounded-2xl shadow-2xl backdrop-blur-md text-xs font-mono"
          >
            <div className="w-8 h-8 rounded-xl bg-blue-950 border border-blue-800 text-blue-400 flex items-center justify-center font-bold">
              <Zap className="w-4 h-4 animate-bounce" />
            </div>
            <div>
              <div className="text-[10px] text-slate-400 font-bold uppercase">BRE DECISION SPEED</div>
              <div className="text-emerald-400 font-extrabold text-sm">&lt; 350 Milliseconds</div>
            </div>
          </motion.div>

          {/* Image Canvas Window */}
          <div className="relative h-72 sm:h-96 md:h-[420px] rounded-2xl overflow-hidden border border-slate-800 bg-slate-950 group">
            
            {/* High Quality Business & Financial Tech Image */}
            <img 
              src="https://images.unsplash.com/photo-1551836022-d5d88e9218df?auto=format&fit=crop&w=1600&q=80" 
              alt="SNIPER Lending Operating System Dashboard" 
              className="w-full h-full object-cover opacity-60 group-hover:scale-105 transition-transform duration-1000"
              referrerPolicy="no-referrer"
            />
            
            {/* Overlay Gradient */}
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/40 to-transparent" />

            {/* Laser Scanning Motion Line */}
            <motion.div 
              animate={{ y: [0, 320, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
              className="absolute inset-x-0 h-1 bg-gradient-to-r from-transparent via-blue-400 to-transparent shadow-[0_0_15px_#3b82f6]"
            />

            {/* Live Interactive Dashboard Controls Overlay */}
            <div className="absolute top-4 right-4 z-10 flex items-center gap-2 bg-slate-950/80 backdrop-blur-md p-1.5 rounded-xl border border-slate-800 text-xs font-mono">
              <button 
                onClick={() => setActivePreview('analytics')}
                className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  activePreview === 'analytics' ? 'bg-blue-600 text-white font-bold' : 'text-slate-400 hover:text-white'
                }`}
              >
                Executive Command
              </button>
              <button 
                onClick={() => setActivePreview('bre')}
                className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  activePreview === 'bre' ? 'bg-blue-600 text-white font-bold' : 'text-slate-400 hover:text-white'
                }`}
              >
                BRE Decision Engine
              </button>
              <button 
                onClick={() => setActivePreview('reconcile')}
                className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  activePreview === 'reconcile' ? 'bg-blue-600 text-white font-bold' : 'text-slate-400 hover:text-white'
                }`}
              >
                Bank Reconciliation
              </button>
            </div>

            {/* Bottom Telemetry Ticker Overlay */}
            <div className="absolute bottom-4 left-4 right-4 z-10 p-4 bg-slate-950/90 border border-slate-800 rounded-2xl backdrop-blur-md space-y-2">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-blue-400 font-bold flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                  LIVE SYSTEM TELEMETRY STREAM
                </span>
                <span className="text-slate-400 hidden sm:inline">256,000+ Active Loans under Management</span>
              </div>

              <AnimatePresence mode="wait">
                <motion.div
                  key={activePreview}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.3 }}
                  className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono"
                >
                  {activePreview === 'analytics' && (
                    <>
                      <div className="p-2 bg-slate-900/90 rounded-xl border border-slate-800">
                        <span className="text-[10px] text-slate-500">Monthly Sanctions</span>
                        <div className="text-white font-bold text-xs sm:text-sm">₹1,480 Crore</div>
                      </div>
                      <div className="p-2 bg-slate-900/90 rounded-xl border border-slate-800">
                        <span className="text-[10px] text-slate-500">Auto Approval Rate</span>
                        <div className="text-emerald-400 font-bold text-xs sm:text-sm">74.2%</div>
                      </div>
                      <div className="p-2 bg-slate-900/90 rounded-xl border border-slate-800">
                        <span className="text-[10px] text-slate-500">Gross NPA %</span>
                        <div className="text-emerald-400 font-bold text-xs sm:text-sm">0.82%</div>
                      </div>
                      <div className="p-2 bg-slate-900/90 rounded-xl border border-slate-800">
                        <span className="text-[10px] text-slate-500">Collection Eff.</span>
                        <div className="text-blue-400 font-bold text-xs sm:text-sm">98.7%</div>
                      </div>
                    </>
                  )}

                  {activePreview === 'bre' && (
                    <>
                      <div className="p-2 bg-slate-900/90 rounded-xl border border-slate-800">
                        <span className="text-[10px] text-slate-500">Rule Evaluation</span>
                        <div className="text-emerald-400 font-bold text-xs sm:text-sm">Sub-second</div>
                      </div>
                      <div className="p-2 bg-slate-900/90 rounded-xl border border-slate-800">
                        <span className="text-[10px] text-slate-500">Bureau Pulls</span>
                        <div className="text-white font-bold text-xs sm:text-sm">CIBIL + Experian</div>
                      </div>
                      <div className="p-2 bg-slate-900/90 rounded-xl border border-slate-800">
                        <span className="text-[10px] text-slate-500">Account Aggregator</span>
                        <div className="text-blue-400 font-bold text-xs sm:text-sm">Setu AA Parsed</div>
                      </div>
                      <div className="p-2 bg-slate-900/90 rounded-xl border border-slate-800">
                        <span className="text-[10px] text-slate-500">Policy Breach</span>
                        <div className="text-emerald-400 font-bold text-xs sm:text-sm">0 Exceptions</div>
                      </div>
                    </>
                  )}

                  {activePreview === 'reconcile' && (
                    <>
                      <div className="p-2 bg-slate-900/90 rounded-xl border border-slate-800">
                        <span className="text-[10px] text-slate-500">UTR Matching Rate</span>
                        <div className="text-emerald-400 font-bold text-xs sm:text-sm">98.7% Auto Match</div>
                      </div>
                      <div className="p-2 bg-slate-900/90 rounded-xl border border-slate-800">
                        <span className="text-[10px] text-slate-500">Unmatched Queue</span>
                        <div className="text-amber-400 font-bold text-xs sm:text-sm">12 Transactions</div>
                      </div>
                      <div className="p-2 bg-slate-900/90 rounded-xl border border-slate-800">
                        <span className="text-[10px] text-slate-500">Bank Feeds</span>
                        <div className="text-white font-bold text-xs sm:text-sm">HDFC / ICICI / AXIS</div>
                      </div>
                      <div className="p-2 bg-slate-900/90 rounded-xl border border-slate-800">
                        <span className="text-[10px] text-slate-500">Ledger Status</span>
                        <div className="text-emerald-400 font-bold text-xs sm:text-sm">Real-time Sync</div>
                      </div>
                    </>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>

          </div>

        </motion.div>

        {/* Capabilities quick trust row */}
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, delay: 0.7 }}
          className="pt-4 border-t border-slate-800/80 max-w-4xl mx-auto grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono text-slate-300"
        >
          <div className="flex items-center justify-center gap-2 bg-slate-900/80 py-2.5 px-3 rounded-xl border border-slate-800">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>End-to-End Lifecycle</span>
          </div>
          <div className="flex items-center justify-center gap-2 bg-slate-900/80 py-2.5 px-3 rounded-xl border border-slate-800">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>RBI KFS & APR Ready</span>
          </div>
          <div className="flex items-center justify-center gap-2 bg-slate-900/80 py-2.5 px-3 rounded-xl border border-slate-800">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>Sub-Second BRE Rules</span>
          </div>
          <div className="flex items-center justify-center gap-2 bg-slate-900/80 py-2.5 px-3 rounded-xl border border-slate-800">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>Multi-Tenant Architecture</span>
          </div>
        </motion.div>

      </div>
    </section>
  );
};

