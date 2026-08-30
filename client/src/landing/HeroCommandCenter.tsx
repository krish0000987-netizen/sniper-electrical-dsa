import React, { useState } from 'react';
import { 
  TrendingUp, 
  Users, 
  CreditCard, 
  AlertTriangle, 
  CheckCircle2, 
  FileCheck, 
  ArrowUpRight, 
  PieChart, 
  Activity,
  ChevronRight
} from 'lucide-react';

interface HeroCommandCenterProps {
  onOpenLiveDemo: () => void;
}

export const HeroCommandCenter: React.FC<HeroCommandCenterProps> = ({ onOpenLiveDemo }) => {
  const [selectedTimeframe, setSelectedTimeframe] = useState<'today' | 'month' | 'quarter'>('month');

  return (
    <section className="py-12 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Section Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-8 pb-4 border-b border-slate-100 gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-semibold mb-2">
              <Activity className="w-3.5 h-3.5 text-blue-600" />
              <span>SNIPER REAL-TIME COMMAND CENTER</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              Unified Lending Operations At a Glance
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Live operational metrics aggregating origination, servicing, payments & risk across branches.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-slate-400 uppercase bg-slate-100 px-2 py-1 rounded">
              [DEMO ENVIRONMENT]
            </span>
            <button
              onClick={onOpenLiveDemo}
              className="px-3.5 py-2 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <span>Launch Live Simulator</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* 6 Core Metric Cards Frame */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          
          {/* Card 1: Portfolio */}
          <div className="p-6 rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900 to-blue-950 text-white shadow-lg border border-slate-800 relative overflow-hidden group hover:border-slate-700 transition-all">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-3">
              <span className="font-semibold uppercase tracking-wider text-slate-300">Total Portfolio Under Mgmt</span>
              <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 font-mono text-[11px]">+14.2% YoY</span>
            </div>
            <div className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight font-mono">
              ₹4,82,40,00,000
            </div>
            <p className="text-xs text-slate-400 mt-2 flex items-center gap-1">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
              <span>₹482.4 Crore active loan book</span>
            </p>
            <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:opacity-20 transition-opacity pointer-events-none">
              <PieChart className="w-20 h-20 text-blue-400" />
            </div>
          </div>

          {/* Card 2: Applications */}
          <div className="p-6 rounded-2xl bg-white text-slate-900 shadow-sm border border-slate-200/80 hover:shadow-md transition-all">
            <div className="flex items-center justify-between text-xs text-slate-500 mb-3">
              <span className="font-semibold uppercase tracking-wider">Total Applications</span>
              <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                <Users className="w-4 h-4" />
              </div>
            </div>
            <div className="text-3xl font-extrabold text-slate-900 tracking-tight font-mono">
              12,840
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-100">
              <span>Avg Approval SLA: <strong className="text-slate-800">14 Mins</strong></span>
              <span className="text-emerald-600 font-semibold">68% Auto-Passed</span>
            </div>
          </div>

          {/* Card 3: Active Loans */}
          <div className="p-6 rounded-2xl bg-white text-slate-900 shadow-sm border border-slate-200/80 hover:shadow-md transition-all">
            <div className="flex items-center justify-between text-xs text-slate-500 mb-3">
              <span className="font-semibold uppercase tracking-wider">Active Serviced Loans</span>
              <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                <FileCheck className="w-4 h-4" />
              </div>
            </div>
            <div className="text-3xl font-extrabold text-slate-900 tracking-tight font-mono">
              8,420
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-100">
              <span>Next EMI Due Date: <strong className="text-slate-800">15th Aug</strong></span>
              <span className="text-blue-600 font-semibold">0% Accounting Errors</span>
            </div>
          </div>

          {/* Card 4: Collection Efficiency */}
          <div className="p-6 rounded-2xl bg-white text-slate-900 shadow-sm border border-slate-200/80 hover:shadow-md transition-all">
            <div className="flex items-center justify-between text-xs text-slate-500 mb-3">
              <span className="font-semibold uppercase tracking-wider">Collection Efficiency</span>
              <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <CheckCircle2 className="w-4 h-4" />
              </div>
            </div>
            <div className="text-3xl font-extrabold text-slate-900 tracking-tight font-mono text-emerald-600">
              96.4%
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-100">
              <span>Total Month Collections: <strong className="text-slate-800">₹46.5 Cr</strong></span>
              <span className="text-emerald-600 font-semibold">+1.8% vs Target</span>
            </div>
          </div>

          {/* Card 5: Applications at Risk */}
          <div className="p-6 rounded-2xl bg-white text-slate-900 shadow-sm border border-slate-200/80 hover:shadow-md transition-all">
            <div className="flex items-center justify-between text-xs text-slate-500 mb-3">
              <span className="font-semibold uppercase tracking-wider">Applications at Risk / Exception</span>
              <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
                <AlertTriangle className="w-4 h-4" />
              </div>
            </div>
            <div className="text-3xl font-extrabold text-amber-600 tracking-tight font-mono">
              27
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-100">
              <span>SLA Breach: <strong className="text-slate-800">4 Apps</strong></span>
              <span className="text-amber-700 font-medium">Underwriting Escalated</span>
            </div>
          </div>

          {/* Card 6: Unreconciled Payments */}
          <div className="p-6 rounded-2xl bg-white text-slate-900 shadow-sm border border-slate-200/80 hover:shadow-md transition-all">
            <div className="flex items-center justify-between text-xs text-slate-500 mb-3">
              <span className="font-semibold uppercase tracking-wider">Unreconciled Payments</span>
              <div className="w-8 h-8 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center">
                <CreditCard className="w-4 h-4" />
              </div>
            </div>
            <div className="text-3xl font-extrabold text-sky-600 tracking-tight font-mono">
              12
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-100">
              <span>Auto-Match Rate: <strong className="text-slate-800">98.7%</strong></span>
              <span className="text-sky-600 font-semibold">AI Match Suggestions</span>
            </div>
          </div>

        </div>

      </div>
    </section>
  );
};
