import React, { useMemo, useState } from 'react';
import { Gauge, Sparkles, Target, TrendingUp } from 'lucide-react';
import { AttendanceRecord, CourseMarks } from '../types';
import { buildCourseIntelRows, CourseIntel, TargetGrade } from '../utils/courseIntel';
import { componentLabel } from '../utils/attendanceComponents';

/**
 * CourseIntelView — compact per-course analytics from data VTOP already
 * provides. Reuses the safe-bunk and grade-band arithmetic; never invents
 * grades or marks.
 */

const TARGET_GRADES: TargetGrade[] = ['S', 'A', 'B', 'C', 'D', 'E'];
const TARGETS_KEY = 'ultracc.courseIntel.targets';

function readTargets(): Record<string, TargetGrade> {
  try {
    const raw = localStorage.getItem(TARGETS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, TargetGrade>) : {};
  } catch {
    return {};
  }
}

export const CourseIntelView: React.FC<{ attendance: AttendanceRecord[]; marks: CourseMarks[] }> = ({ attendance, marks }) => {
  const [targets, setTargets] = useState<Record<string, TargetGrade>>(() => readTargets());

  const rows = useMemo(() => buildCourseIntelRows(attendance, marks, targets), [attendance, marks, targets]);

  if (!attendance.length && !marks.length) {
    return (
      <div className="bg-white border border-zinc-200 rounded-3xl p-8 text-center shadow-xl">
        <Gauge className="h-7 w-7 text-zinc-900 mx-auto mb-2" />
        <p className="text-sm font-bold text-zinc-800">Course intelligence needs your synced data</p>
        <p className="text-[11px] text-zinc-500 mt-1 max-w-sm mx-auto">
          Sync VTOP once and every course gets attendance risk, weighted performance and a target-grade plan here.
        </p>
      </div>
    );
  }

  const setTarget = (code: string, grade: TargetGrade) => {
    setTargets((prev) => {
      const next = { ...prev, [code]: grade };
      try { localStorage.setItem(TARGETS_KEY, JSON.stringify(next)); } catch { /* device-local only */ }
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-extrabold text-zinc-900 tracking-tight flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-violet-500" /> Course intelligence
          </h3>
          <p className="text-xs text-zinc-500 font-medium">Attendance risk, weighted performance and what your target grade needs — per course.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {rows.map((row) => <CourseCard key={`${row.courseCode}-${row.component}`} row={row} targets={targets} onSetTarget={setTarget} />)}
      </div>
    </div>
  );
};

function CourseCard({ row, targets, onSetTarget }: { key?: React.Key; row: CourseIntel; targets: Record<string, TargetGrade>; onSetTarget: (code: string, grade: TargetGrade) => void }) {
  const att = row.attendance;
  const riskColor = att.risk === 'risk' ? 'text-rose-600' : att.risk === 'borderline' ? 'text-amber-600' : 'text-emerald-600';
  const targetGrade = targets[row.courseCode] ?? 'B';

  return (
    <div className="bg-white border border-zinc-200 rounded-3xl p-5 shadow-xl">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono font-bold text-zinc-900 text-sm flex items-center gap-1.5">
            {row.courseCode}
            {/* VTOP tracks theory and lab separately — say which half this card
                is about instead of showing two identical-looking cards. */}
            <span className="text-[9px] font-extrabold uppercase tracking-widest text-zinc-500 border border-zinc-200 rounded px-1 py-px">{componentLabel(row.component)}</span>
          </p>
          {row.courseTitle && <p className="text-[11px] text-zinc-500 truncate mt-0.5">{row.courseTitle}</p>}
        </div>
        <label className="flex items-center gap-1.5 shrink-0">
          <Target className="h-3.5 w-3.5 text-violet-500" />
          <select
            value={targetGrade}
            onChange={(e) => onSetTarget(row.courseCode, e.target.value as TargetGrade)}
            aria-label={`Target grade for ${row.courseCode}`}
            className="bg-white border border-zinc-200 rounded-lg px-2 py-1 text-[11px] font-bold text-zinc-900 outline-none cursor-pointer"
          >
            {TARGET_GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-2xl bg-zinc-50 border border-zinc-100 p-3">
          <p className="text-[9px] font-extrabold uppercase tracking-widest text-zinc-500">{componentLabel(row.component)} attendance</p>
          <p className={`text-lg font-extrabold ${att.percentage === null ? 'text-zinc-500' : riskColor}`}>
            {att.percentage !== null ? `${att.percentage.toFixed(1)}%` : '—'}
          </p>
          <p className="text-[10px] text-zinc-500 font-medium">
            {att.totalHeld <= 0
              ? 'No classes conducted yet'
              : att.risk === 'risk'
                ? `Attend ${att.mustAttend} in a row`
                : att.risk === 'borderline'
                  ? `${att.attended}/${att.totalHeld} — borderline, stay present`
                  : `${att.attended}/${att.totalHeld} · ${att.safeBunks} safe bunk${att.safeBunks === 1 ? '' : 's'}`}
          </p>
        </div>
        <div className="rounded-2xl bg-zinc-50 border border-zinc-100 p-3">
          <p className="text-[9px] font-extrabold uppercase tracking-widest text-zinc-500">Weighted so far</p>
          <p className="text-lg font-extrabold text-zinc-900 flex items-center gap-1">
            <TrendingUp className="h-4 w-4 text-blue-500" />
            {row.marks.evaluated.length ? row.marks.weightedSoFar.toFixed(1) : '—'}
            <span className="text-[10px] text-zinc-500 font-bold">/100</span>
          </p>
          <p className="text-[10px] text-zinc-500 font-medium">
            {!row.marks.evaluated.length
              ? 'No graded assessments yet'
              : row.marks.weightRemaining > 0
                // Name the rows VTOP has not graded — "35% ungraded" alone
                // leaves the student guessing which assessment is missing.
                ? `${row.marks.weightRemaining.toFixed(0)}% of course weight still ungraded${
                  row.marks.pending.length
                    ? ` (${row.marks.pending.slice(0, 3).map((p) => p.name).join(', ')}${row.marks.pending.length > 3 ? ', …' : ''})`
                    : ''
                }`
                : 'All graded assessments are in'}
          </p>
        </div>
      </div>

      {row.target && (
        <p className={`mt-3 text-[11px] font-bold rounded-xl px-3 py-2 border ${
          row.target.status === 'achieved' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
          : row.target.status === 'not_achievable' ? 'bg-rose-50 text-rose-700 border-rose-200'
          : row.target.status === 'pending_final' ? 'bg-violet-50 text-violet-700 border-violet-200'
          : row.target.status === 'awaiting_final' ? 'bg-zinc-50 text-zinc-600 border-zinc-200'
          : 'bg-blue-50 text-blue-700 border-blue-200'
        }`}>
          {row.nextAction}
        </p>
      )}
      {!row.target && (
        <p className="mt-3 text-[11px] text-zinc-600 px-3 py-2 rounded-xl bg-zinc-50 border border-zinc-100">{row.nextAction}</p>
      )}
    </div>
  );
};
