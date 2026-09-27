import React, { useMemo, useState } from 'react';
import { AlertCircle, Calculator, Check, X } from 'lucide-react';
import type { AttendanceRecord, TimetableSlot } from '../types';
import { projectAttendance, type AttendancePredictionAction } from '../utils/attendancePredictor';
import { TIMETABLE_DAYS } from '../utils/timetableGrid';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useDialog } from '../hooks/useDialog';

interface Props {
  timetable: TimetableSlot[];
  attendance: AttendanceRecord[];
  initialDay?: TimetableSlot['day'];
  onClose: () => void;
}

const dayFromDate = (dateValue: string): TimetableSlot['day'] | null => {
  const date = new Date(`${dateValue}T12:00:00`);
  const day = date.toLocaleDateString('en-US', { weekday: 'long' }) as TimetableSlot['day'];
  return TIMETABLE_DAYS.includes(day) ? day : null;
};

const pct = (value: number) => `${value.toFixed(1)}%`;

export const AttendancePredictorSheet: React.FC<Props> = ({ timetable, attendance, initialDay = 'Monday', onClose }) => {
  useBodyScrollLock(true);
  const panelRef = useDialog({ isOpen: true, onClose });
  const [selectedDay, setSelectedDay] = useState<TimetableSlot['day']>(initialDay);
  const [selectedDate, setSelectedDate] = useState('');
  const [showAdvancedDate, setShowAdvancedDate] = useState(false);
  const [actions, setActions] = useState<Record<string, AttendancePredictionAction>>({});
  const daySlots = useMemo(() => timetable.filter((slot) => slot.day === selectedDay).sort((a, b) => a.startTime.localeCompare(b.startTime)), [timetable, selectedDay]);
  const projection = useMemo(() => projectAttendance(daySlots, attendance, actions), [daySlots, attendance, actions]);

  const setAction = (id: string, action: AttendancePredictionAction) => {
    setActions((current) => ({ ...current, [id]: current[id] === action ? 'ignore' : action }));
  };

  // "Skip whole day" marks every class on the selected day absent in one tap;
  // the reverse (clear) returns the day to its neutral default. Both only touch
  // the local actions map — VTOP attendance is never modified.
  const skipWholeDay = () => {
    setActions(() => {
      const next: Record<string, AttendancePredictionAction> = {};
      for (const slot of daySlots) next[slot.id] = 'absent';
      return next;
    });
  };

  const clearDay = () => setActions({});

  const selectDay = (day: TimetableSlot['day']) => {
    setSelectedDay(day);
    setSelectedDate('');
    setActions({});
  };

  return (
    <div ref={panelRef} className="attendance-predictor-overlay" role="dialog" aria-modal="true" aria-labelledby="attendance-predictor-title">
      <section className="attendance-predictor-sheet">
        <header className="attendance-predictor-header">
          <div><span className="portal-eyebrow">Hypothetical only</span><h2 id="attendance-predictor-title"><Calculator size={17} /> Attendance predictor</h2><p>{selectedDay} · {daySlots.length} {daySlots.length === 1 ? 'class' : 'classes'} · VTOP attendance is unchanged.</p></div>
          <button className="attendance-predictor-close" onClick={onClose} aria-label="Close attendance predictor"><X size={18} /></button>
        </header>
        <div className="attendance-predictor-body">
          {/* Toggle buttons, not tabs: selecting a day swaps the summary and the
              class list together, so there is no single tabpanel to point at. */}
          <div className="attendance-predictor-day-tabs" role="group" aria-label="Predict attendance by day">{TIMETABLE_DAYS.map((day) => <button key={day} type="button" aria-pressed={selectedDay === day} className={selectedDay === day ? 'active' : ''} onClick={() => selectDay(day)}>{day.slice(0, 3)}</button>)}</div>
          <div className="attendance-predictor-summary sticky-summary">
            <div><span>Overall</span><strong>{projection.overall ? `${pct(projection.overall.currentPercentage)} → ${pct(projection.overall.projectedPercentage)}` : 'Not available'}</strong><small>{projection.overall ? `${projection.overall.projectedAttended}/${projection.overall.projectedTotal} after selection` : 'Sync attendance first'}</small></div>
            <div><span>{selectedDay}</span><strong>{daySlots.length} classes</strong><small>Neutral default · updates instantly</small></div>
          </div>
          <div className="attendance-predictor-day-actions" role="group" aria-label="Whole-day prediction shortcuts">
            <button type="button" onClick={skipWholeDay} disabled={daySlots.length === 0}><X size={13} /> Skip whole day</button>
            <button type="button" onClick={clearDay} disabled={daySlots.length === 0 || Object.keys(actions).length === 0}>Reset day</button>
          </div>
          <button className="attendance-predictor-advanced-toggle" onClick={() => setShowAdvancedDate((value) => !value)}>{showAdvancedDate ? 'Hide date context' : 'Use an exact date (optional)'}</button>
          {showAdvancedDate && <label className="attendance-predictor-date">Optional class date<input type="date" value={selectedDate} onChange={(event) => { const value = event.target.value; setSelectedDate(value); const day = dayFromDate(value); if (day) { setSelectedDay(day); setActions({}); } }} /></label>}
          {daySlots.length === 0 ? <div className="attendance-predictor-empty">No timetable classes are scheduled for this date.</div> : <div className="attendance-predictor-list">{projection.classes.map((item) => <article className="attendance-predictor-row" key={item.slot.id}><div className="attendance-predictor-class"><time>{item.slot.startTime}<small>{item.slot.endTime}</small></time><div><strong>{item.slot.courseCode}</strong><span>{item.slot.courseTitle}</span><small>{item.slot.facultyName || 'Faculty not available'} · {item.slot.venue || 'Venue not available'}</small></div></div>{item.mapping === 'unavailable' ? <div className="attendance-predictor-unavailable"><AlertCircle size={14} /> Attendance row not confidently mapped</div> : <div className="attendance-predictor-actions" aria-label={`Prediction for ${item.slot.courseCode}`}><button className={item.action === 'present' ? 'selected present' : ''} onClick={() => setAction(item.slot.id, 'present')}><Check size={13} /> Present</button><button className={item.action === 'absent' ? 'selected absent' : ''} onClick={() => setAction(item.slot.id, 'absent')}><X size={13} /> Absent</button><button className={item.action === 'ignore' ? 'selected ignore' : ''} onClick={() => setAction(item.slot.id, 'ignore')}>Ignore</button></div>}</article>)}</div>}
          {projection.courses.length > 0 && <section className="attendance-predictor-courses"><h3>Projected by course</h3>{projection.courses.filter((course) => course.classCount > 0).map((course) => <div key={course.key}><span><strong>{course.courseCode}</strong><small>{course.courseTitle}</small></span><b>{pct(course.currentPercentage)} → {pct(course.projectedPercentage)}</b></div>)}</section>}
        </div>
        <footer className="attendance-predictor-footer"><span>Prediction is local and temporary.</span><button onClick={onClose}>Done</button></footer>
      </section>
    </div>
  );
};
