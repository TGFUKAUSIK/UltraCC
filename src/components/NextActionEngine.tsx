import React from 'react';
import { NextActionState } from '../types';
import { Clock, MapPin, ArrowRight, AlertTriangle, CheckCircle2, Navigation } from 'lucide-react';

interface NextActionEngineProps {
  state: NextActionState;
  onNavigateMap: (building: string) => void;
}

export const NextActionEngine: React.FC<NextActionEngineProps> = ({ state, onNavigateMap }) => {
  const getStatusBadge = () => {
    switch (state.currentStatus) {
      case 'Class Active':
        return { bg: 'bg-blue-500/10 text-blue-600 border-blue-500/20', label: 'Class Active Right Now' };
      case 'Upcoming Class':
        return { bg: 'bg-blue-500/10 text-blue-600 border-blue-500/20', label: 'Upcoming Class' };
      case 'Exam Day':
        return { bg: 'bg-rose-500/10 text-rose-600 border-rose-500/20', label: 'CAT Exam Alert' };
      case 'Free Period':
        return { bg: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20', label: 'Free Slot Available' };
      default:
        return { bg: 'bg-zinc-100 text-zinc-900 border-zinc-200', label: 'Academic Standing Safe' };
    }
  };

  const badge = getStatusBadge();

  return (
    <div className="bg-white border border-zinc-200 rounded-3xl p-6 sm:p-8 relative overflow-hidden shadow-xl">
      {/* Background Watermark in Bento style */}
      <div className="absolute top-0 right-0 p-6 text-8xl font-black text-zinc-900/[0.03] pointer-events-none select-none">
        NEXT
      </div>

      <div className="relative z-10 space-y-6">
        {/* Header Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center space-x-2.5">
            <span className={`text-xs font-bold px-3 py-1 rounded-md border tracking-widest uppercase ${badge.bg}`}>
              {badge.label}
            </span>
            <span className="text-xs text-zinc-500 font-mono flex items-center gap-1.5 bg-white px-3 py-1 rounded-md border border-zinc-200">
              <Clock className="h-3.5 w-3.5 text-blue-600" />
              {state.timeContext}
            </span>
          </div>

          {state.countdownMinutes > 0 && (
            <div className="flex items-center space-x-2 px-3 py-1 rounded-full bg-white border border-zinc-200 text-amber-600 font-mono text-xs font-bold">
              <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse"></span>
              <span>Starts in {state.countdownMinutes}m</span>
            </div>
          )}
        </div>

        {/* Main Title & Building */}
        <div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-zinc-900 tracking-tight mb-2">
            {state.title}
          </h2>
          <p className="text-lg text-zinc-500 flex items-center gap-2 font-medium">
            <MapPin className="h-5 w-5 text-blue-600 shrink-0" />
            <span className="text-zinc-900 font-bold">{state.locationContext}</span>
          </p>
        </div>

        {/* 3 Bento Sub-Cards: WHAT -> WHERE -> WHY */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Sub-card 1 */}
          <div className="bg-zinc-50 rounded-2xl p-4 border border-zinc-200 flex flex-col justify-between">
            <div>
              <div className="text-zinc-500 text-[10px] uppercase font-bold tracking-wider mb-1">
                1. Class / Activity Status
              </div>
              <div className="text-sm font-bold text-zinc-900 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                <span>FFCS Timetable Verified</span>
              </div>
            </div>
            <p className="text-xs text-zinc-500 mt-2">Slot confirmed for active semester.</p>
          </div>

          {/* Sub-card 2 */}
          <div className="bg-zinc-50 rounded-2xl p-4 border border-zinc-200 flex flex-col justify-between">
            <div>
              <div className="text-zinc-500 text-[10px] uppercase font-bold tracking-wider mb-1">
                2. Building & Floor Map
              </div>
              <div className="text-sm font-bold text-zinc-900">{state.locationContext}</div>
            </div>
            <button
              onClick={() => onNavigateMap(state.locationContext)}
              className="mt-2 inline-flex items-center text-xs font-bold text-blue-600 hover:text-blue-700 transition cursor-pointer"
            >
              <Navigation className="h-3.5 w-3.5 mr-1" />
              Locate Room Floor Map
            </button>
          </div>

          {/* Sub-card 3 */}
          <div className="bg-zinc-50 rounded-2xl p-4 border border-zinc-200 flex flex-col justify-between">
            <div>
              <div className="text-zinc-500 text-[10px] uppercase font-bold tracking-wider mb-1">
                3. Academic Impact Reason
              </div>
              <p className="text-xs text-zinc-900 leading-relaxed font-medium">{state.reasoning}</p>
            </div>
            <div className="mt-2 flex items-center text-[11px] text-amber-600 font-medium">
              <AlertTriangle className="h-3.5 w-3.5 mr-1 shrink-0" />
              <span>Attendance Calculator Synced</span>
            </div>
          </div>
        </div>

        {/* Footer Action Bar */}
        <div className="pt-4 border-t border-zinc-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center space-x-2 text-sm text-zinc-900">
            <span className="font-bold text-blue-600">Next Action:</span>
            <span className="font-medium text-zinc-900">{state.nextStep}</span>
          </div>

          <div className="flex items-center space-x-2 text-xs text-zinc-500 font-mono">
            <span>P0 Next-Action Engine</span>
            <ArrowRight className="h-4 w-4 text-blue-600 animate-pulse" />
          </div>
        </div>
      </div>
    </div>
  );
};
