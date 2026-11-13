import React, { useState } from 'react';
import { StudentProfile } from '../types';
import { ExternalLink, Info, GraduationCap, Target, CheckCircle2, XCircle } from 'lucide-react';
import { useCgpaPrivacy } from '../lib/cgpaPrivacy';
import { gpaLabel } from '../utils/gradeModel';

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
  },
  {
    tier: 'Dream',
    ctcRange: '₹6 – 10 LPA',
    typicalCgpa: 7.5,
    description: 'High-growth tech product & core engineering firms (Deloitte, Samsung, Oracle, Optum, Schneider).',
  },
  {
    tier: 'Regular / Mass',
    ctcRange: '₹3.5 – 6 LPA',
    typicalCgpa: 6.0,
    description: 'IT consulting, enterprise services & analytics (TCS, Infosys, Wipro, Cognizant, Accenture).',
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
    <div className="uc-index pb-12">
      <section className="uc-plate uc-dir-mast">
        <div className="uc-dir-head">
          <div className="uc-dir-id">
            <span className="uc-cap">Campus placement matrix</span>
            <h2 className="uc-dir-name">VIT placements &amp; readiness</h2>
            <p className="uc-note">Eligibility cut-offs, dream tier bands &amp; the community B.Tech 2026 drive tracker.</p>
          </div>
          <div className="uc-dir-rail">
            <a href={TRACKER_URL} target="_blank" rel="noopener noreferrer" className="uc-dir-go acc-bg">
              Live 2026 drive tracker
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </div>
        </div>
        <div className="uc-dir-detail">
          <div className="uc-note-row">
            <Info aria-hidden="true" />
            <span>Placement drives are conducted centrally by the VIT Career Development Centre (CDC) across Vellore, Chennai, AP, and Bhopal.</span>
          </div>
        </div>
      </section>

      <section className="uc-plate">
        <div className="uc-plate-head"><GraduationCap aria-hidden="true" /><span>Your academic profile snapshot</span></div>
        <div className="uc-place-facts">
          <div className="uc-place-fact">
            <p>Your CGPA</p>
            <b className="uc-num">{cgpaAvailable ? (cgpaHidden ? '••••' : gpaLabel(cgpa)) : 'Not synced'}</b>
            {!cgpaAvailable && <small>Sync live VTOP data to populate</small>}
          </div>
          <div className="uc-place-fact">
            <p>Programme</p>
            {/* Was `student.branch || 'B.Tech'` — a hardcoded degree shown even
                when VTOP never said it. Programme and branch are separate rows
                in VTOP and are now joined only when actually synced. */}
            <b>{[student.program, student.branch].filter(Boolean).join(' · ') || 'Not synced from VTOP'}</b>
          </div>
          <div className="uc-place-fact">
            <p>Semester</p>
            {/* semester is a number; 0/absent means VTOP never said — the same
                rule MyInfoView uses, rather than printing "Semester —". */}
            <b>{student.semester > 0 ? `Semester ${student.semester}` : 'Not synced from VTOP'}</b>
          </div>
          <div className="uc-place-fact">
            <p>Campus</p>
            <b className="is-good">VIT Chennai (CDC Central)</b>
          </div>
        </div>
      </section>

      <section className="uc-plate">
        <div className="uc-plate-head"><Target aria-hidden="true" /><span>Placement company eligibility calculator</span></div>
        <div className="uc-place-sim">
          <div className="uc-place-sim-head">
            <span>Simulate CGPA</span>
            <b className="uc-num">{gpaLabel(simulatedCgpa)} CGPA</b>
          </div>
          <input
            type="range"
            aria-label="Simulated CGPA"
            min={5.0}
            max={10.0}
            step={0.05}
            value={simulatedCgpa}
            onChange={(e) => setSimulatedCgpa(parseFloat(e.target.value))}
            className="uc-place-range"
          />
          <div className="uc-place-scale uc-num">
            <span>5.0</span><span>6.0</span><span>7.0</span><span>8.0</span><span>9.0</span><span>10.0</span>
          </div>
          <p className="uc-place-status">{status.level}</p>
          <p className="uc-place-hint">Estimated ~{status.pct}% of recruiting companies permit test registration</p>
          <div className="uc-meter"><i style={{ width: `${status.pct}%` }} /></div>
        </div>
      </section>

      <section className="uc-plate uc-dir-ledger">
        <div className="uc-plate-head"><span>Company tiers</span><span className="uc-dir-count">Benchmarked on historical VIT cut-offs</span></div>
        {PLACEMENT_TIERS.map((t) => {
          const isEligible = simulatedCgpa >= t.typicalCgpa;
          return (
            <article key={t.tier} className="uc-dir-card">
              <div className="uc-dir-card-top">
                <h3 className="uc-dir-title">{t.tier}</h3>
                {isEligible
                  ? <span className="uc-dir-tag is-good"><CheckCircle2 className="h-3 w-3" aria-hidden="true" />Eligible</span>
                  : <span className="uc-dir-tag is-warn"><XCircle className="h-3 w-3" aria-hidden="true" />Below &ge;{gpaLabel(t.typicalCgpa)}</span>}
              </div>
              <p className="uc-dir-meta uc-num">{t.ctcRange}</p>
              <p className="uc-dir-sub">{t.description}</p>
              {/* .uc-dir-card-foot is a flex strip that expects a <small>; hung
                  on a <p> it kept the paragraph's own bottom margin. */}
              <div className="uc-dir-card-foot">
                <small className="uc-num">Benchmark CGPA: &ge; {gpaLabel(t.typicalCgpa)}</small>
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
};
