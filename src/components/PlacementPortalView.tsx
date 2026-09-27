import React, { useState } from 'react';
import { StudentProfile } from '../types';
import { Briefcase, ExternalLink, Info, GraduationCap, Target, CheckCircle2, XCircle } from 'lucide-react';
import { useCgpaPrivacy } from '../lib/cgpaPrivacy';

interface PlacementPortalViewProps {
  student: StudentProfile;
}

const TRACKER_URL = 'https://placements-tracker-btech2026.streamlit.app/';

const PLACEMENT_TIERS = [
  {
    tier: 'Super Dream',
    ctcRange: '₹10+ LPA (Up to ₹50+ LPA)',
    typicalCgpa: 8.5,
    description: 'Tier-1 tech giants, product firms & fintech (Google, Microsoft, Amazon, DE Shaw, PayPal, Cisco).',
    color: 'border-purple-500/30 bg-purple-500/10 text-purple-600',
  },
  {
    tier: 'Dream',
    ctcRange: '₹6 – 10 LPA',
    typicalCgpa: 7.5,
    description: 'High-growth tech product & core engineering firms (Deloitte, Samsung, Oracle, Optum, Schneider).',
    color: 'border-blue-500/30 bg-blue-500/10 text-blue-600',
  },
  {
    tier: 'Regular / Mass',
    ctcRange: '₹3.5 – 6 LPA',
    typicalCgpa: 6.0,
    description: 'IT consulting, enterprise services & analytics (TCS, Infosys, Wipro, Cognizant, Accenture).',
    color: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600',
  },
];

export const PlacementPortalView: React.FC<PlacementPortalViewProps> = ({ student }) => {
  const [cgpaHidden] = useCgpaPrivacy();
  const cgpa = student.cgpa;
  const cgpaAvailable = cgpa !== null && Number.isFinite(cgpa) && cgpa > 0;
  const activeCgpa = cgpaAvailable ? cgpa : 8.0;

  const [simulatedCgpa, setSimulatedCgpa] = useState<number>(activeCgpa);

  // Estimate percentage of eligible companies based on historical VIT thresholds
  const estimateEligibility = (val: number) => {
    if (val >= 9.0) return { pct: 98, level: 'Exceptional (Eligible for >98% of companies)' };
    if (val >= 8.5) return { pct: 92, level: 'Excellent (Eligible for ~92% of Super Dream firms)' };
    if (val >= 8.0) return { pct: 85, level: 'Strong (Eligible for ~85% of companies)' };
    if (val >= 7.5) return { pct: 72, level: 'Good (Eligible for most Dream & Regular firms)' };
    if (val >= 7.0) return { pct: 55, level: 'Moderate (Meets standard 7.0 eligibility cutoffs)' };
    if (val >= 6.0) return { pct: 35, level: 'Basic (Eligible for 6.0 cutoff companies)' };
    return { pct: 15, level: 'Below standard 6.0 campus placement cut-off' };
  };

  const status = estimateEligibility(simulatedCgpa);

  return (
    <div className="space-y-6 pb-12">
      {/* Header Banner Bento Card */}
      <div className="bg-white border border-zinc-200 rounded-3xl p-6 sm:p-8 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="text-zinc-500 text-xs font-bold uppercase tracking-wider mb-1">
              Campus Placement Matrix
            </div>
            <h2 className="text-2xl font-extrabold text-zinc-900 flex items-center gap-2 tracking-tight">
              <Briefcase className="h-6 w-6 text-purple-600" />
              VIT Placements &amp; Readiness
            </h2>
            <p className="text-sm text-zinc-500 mt-1 font-medium">
              Eligibility cut-offs, dream tier bands &amp; community B.Tech 2026 drive tracker.
            </p>
            <p className="text-[11px] text-zinc-500 mt-2 flex items-start gap-1.5 font-medium">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-zinc-600" />
              Placement drives are conducted centrally by the VIT Career Development Centre (CDC) across Vellore, Chennai, AP, and Bhopal.
            </p>
          </div>
          <a
            href={TRACKER_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-purple-600 hover:bg-purple-500 text-zinc-900 rounded-2xl text-xs font-extrabold transition cursor-pointer shadow-lg shadow-purple-900/30 shrink-0 self-start md:self-auto"
          >
            Live 2026 Drive Tracker
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      </div>

      {/* Readiness Snapshot */}
      <div className="bg-white border border-zinc-200 rounded-3xl p-6 shadow-xl">
        <h3 className="text-base font-bold text-zinc-900 flex items-center gap-2 mb-4">
          <GraduationCap className="h-4 w-4 text-purple-600" />
          Your Academic Profile Snapshot
        </h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-zinc-50 px-5 py-4 rounded-2xl border border-zinc-200">
            <p className="text-zinc-500 text-[10px] uppercase font-extrabold">Your CGPA</p>
            <p className="text-2xl font-black text-zinc-900 mt-1">
              {cgpaAvailable ? (cgpaHidden ? '••••' : cgpa.toFixed(2)) : <span className="text-zinc-500 text-base">Not synced</span>}
            </p>
            {!cgpaAvailable && (
              <p className="text-[10px] text-zinc-500 mt-1">Sync live VTOP data to populate</p>
            )}
          </div>
          <div className="bg-zinc-50 px-5 py-4 rounded-2xl border border-zinc-200">
            <p className="text-zinc-500 text-[10px] uppercase font-extrabold">Programme</p>
            {/* Was `student.branch || 'B.Tech'` — a hardcoded degree shown even
                when VTOP never said it. Programme and branch are separate rows
                in VTOP and are now joined only when actually synced. */}
            <p className="text-sm font-black text-zinc-900 mt-2 truncate">
              {[student.program, student.branch].filter(Boolean).join(' · ') || 'Not synced from VTOP'}
            </p>
          </div>
          <div className="bg-zinc-50 px-5 py-4 rounded-2xl border border-zinc-200">
            <p className="text-zinc-500 text-[10px] uppercase font-extrabold">Semester</p>
            <p className="text-sm font-black text-zinc-900 mt-2">Semester {student.semester || '—'}</p>
          </div>
          <div className="bg-zinc-50 px-5 py-4 rounded-2xl border border-zinc-200">
            <p className="text-zinc-500 text-[10px] uppercase font-extrabold">Campus</p>
            <p className="text-sm font-black text-emerald-600 mt-2">VIT Chennai (CDC Central)</p>
          </div>
        </div>
      </div>

      {/* Interactive Eligibility Estimator */}
      <div className="bg-white border border-zinc-200 rounded-3xl p-6 sm:p-8 shadow-xl space-y-6">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-blue-500/10 border border-blue-500/20 rounded-2xl text-blue-600">
            <Target className="h-6 w-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-zinc-900 tracking-tight">Placement Company Eligibility Calculator</h3>
            <p className="text-xs text-zinc-500 font-medium">Estimate company shortlisting rate across CGPA cut-off thresholds</p>
          </div>
        </div>

        <div className="bg-zinc-50 border border-zinc-200 rounded-2xl p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <span className="text-xs font-bold text-zinc-900">Simulate CGPA:</span>
            <span className="font-mono text-xl font-black text-blue-600">{simulatedCgpa.toFixed(2)} CGPA</span>
          </div>
          <input
            type="range"
            aria-label="Simulated CGPA"
            min={5.0}
            max={10.0}
            step={0.05}
            value={simulatedCgpa}
            onChange={(e) => setSimulatedCgpa(parseFloat(e.target.value))}
            className="w-full h-2 bg-zinc-100 rounded-lg appearance-none cursor-pointer accent-blue-500"
          />
          <div className="flex justify-between text-[10px] text-zinc-600 font-mono">
            <span>5.0</span>
            <span>6.0</span>
            <span>7.0</span>
            <span>8.0</span>
            <span>9.0</span>
            <span>10.0</span>
          </div>

          <div className="pt-3 border-t border-zinc-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-zinc-900">{status.level}</p>
              <p className="text-[11px] text-zinc-500 mt-0.5">Estimated ~{status.pct}% of recruiting companies permit test registration</p>
            </div>
            <div className="w-full sm:w-48 h-3 bg-white rounded-full overflow-hidden border border-zinc-200">
              <div
                className="h-full bg-gradient-to-r from-blue-600 to-purple-600 rounded-full transition-all duration-300"
                style={{ width: `${status.pct}%` }}
              />
            </div>
          </div>
        </div>

        {/* Tier Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {PLACEMENT_TIERS.map((t) => {
            const isEligible = simulatedCgpa >= t.typicalCgpa;
            return (
              <div key={t.tier} className={`p-5 rounded-2xl border ${t.color} flex flex-col justify-between space-y-3`}>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-extrabold uppercase tracking-wider">{t.tier}</span>
                    {isEligible ? (
                      <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Eligible
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[10px] font-bold text-rose-600">
                        <XCircle className="h-3.5 w-3.5" /> Below &ge;{t.typicalCgpa}
                      </span>
                    )}
                  </div>
                  <p className="text-base font-black text-zinc-900 font-mono">{t.ctcRange}</p>
                  <p className="text-[11px] text-zinc-900 mt-2 leading-relaxed">{t.description}</p>
                </div>
                <div className="pt-2 border-t border-white/10 text-[10px] text-zinc-500 font-mono">
                  Benchmark CGPA: &ge; {t.typicalCgpa.toFixed(1)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
