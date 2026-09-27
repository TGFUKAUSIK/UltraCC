import React, { useEffect, useMemo, useState } from 'react';
import { Building, Calendar, Calculator, CheckCircle2, Clock, Coffee, Image as ImageIcon, MapPin, Printer, Share2, ShieldCheck, Sparkles, X } from 'lucide-react';
import type { AttendanceRecord, TimetableSlot } from '../types';
import { encodeTimetableShare, describeShareContents, describeExpiry, decodeTimetableShare, ShareOptions } from '../lib/timetableShare';
import { computeFreeClasses } from '../utils/freeClasses';
import { AttendancePredictorSheet } from './AttendancePredictorSheet';
import { exportTimetableToPdf } from '../utils/printExport';
import { exportTimetableImage } from '../utils/imageExport';
import { currentTimetableDay, getOngoingTimetableSlot, getNextTimetableSlot, getTimetableCellSlots, getTimetableContinuationSlots, getTimetableDaySlots, getTimetableDays, getTimetableGap, getTimetableTimeRows, isTimetableSlotOngoing } from '../utils/timetableGrid';

interface TimetableViewProps {
  timetable: TimetableSlot[];
  attendance: AttendanceRecord[];
  onNavigateMap: (building: string) => void;
}

const formatDay = (day: TimetableSlot['day']) => day.slice(0, 3).toUpperCase();

function facultyLabel(name: string): string {
  return name && name.trim() ? name : 'Faculty not available';
}

function formatTime(value: string): string {
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return value || 'Time unavailable';
  const hour = Number(match[1]);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${match[2]} ${suffix}`;
}

function courseTone(code: string): string {
  const tones = ['blue', 'teal', 'violet', 'amber', 'rose', 'slate'];
  const value = [...code].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return tones[value % tones.length];
}

interface GridClassProps {
  slot: TimetableSlot;
  currentDay: TimetableSlot['day'] | null;
  nextSlotId?: string;
  now: Date;
  onNavigateMap: (building: string) => void;
  compact?: boolean;
}

const GridClass: React.FC<GridClassProps> = ({ slot, currentDay, nextSlotId, now, onNavigateMap, compact = false }) => {
  const ongoing = isTimetableSlotOngoing(slot, now);
  const upcoming = slot.id === nextSlotId;
  return (
    <article className={`timetable-grid-class tone-${courseTone(slot.courseCode)} ${ongoing ? 'is-ongoing' : ''} ${upcoming ? 'is-next' : ''} ${compact ? 'is-compact' : ''}`}>
      <div className="timetable-grid-class-top">
        <span className="timetable-grid-slotwrap">
          <span className="timetable-grid-code">{slot.courseCode || 'Course unavailable'}</span>
          {/* VTOP's own slot label for this session ("A1", "L31+L32"). Kept
              visually secondary to the code but always scannable — omitted
              cleanly when VTOP provided none. */}
          {slot.slot && <span className="timetable-grid-slot">{slot.slot}</span>}
        </span>
        {ongoing && <span className="timetable-state ongoing" title={`Happening now · until ${formatTime(slot.endTime)}`}><span className="timetable-live-dot" aria-hidden="true" />Ongoing</span>}
        {!ongoing && upcoming && <span className="timetable-state next">Next</span>}
      </div>
      <strong>{slot.courseTitle || 'Course name unavailable'}</strong>
      {!compact && <span className="timetable-grid-meta">{slot.isLab ? 'Lab' : 'Theory'} · {facultyLabel(slot.facultyName)}</span>}
      <span className="timetable-grid-meta"><MapPin size={11} /><span>{slot.venue || 'Venue not available'}</span></span>
      {!compact && <span className="timetable-grid-time">{formatTime(slot.startTime)} – {formatTime(slot.endTime)}</span>}
      {compact && slot.venue && <button className="timetable-map-link" onClick={() => onNavigateMap(slot.venue)}><Building size={12} /> Map</button>}
      {currentDay === slot.day && !compact && <span className="timetable-current-marker"><CheckCircle2 size={11} /> Today</span>}
    </article>
  );
};

export const TimetableView: React.FC<TimetableViewProps> = ({ timetable, attendance, onNavigateMap }) => {
  const [selectedDay, setSelectedDay] = useState<TimetableSlot['day']>(currentTimetableDay() || 'Monday');
  const [predictorOpen, setPredictorOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareOptions, setShareOptions] = useState<ShareOptions>({});
  const [shareCode, setShareCode] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const currentDay = currentTimetableDay();
  // Re-evaluate "Ongoing"/"Next" states on a minute ticker so a class that
  // starts or ends while the timetable is on screen updates by itself.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const timeRows = useMemo(() => getTimetableTimeRows(timetable), [timetable]);
  const weekDays = useMemo(() => getTimetableDays(timetable), [timetable]);
  const daySlots = useMemo(() => getTimetableDaySlots(timetable, selectedDay), [timetable, selectedDay]);
  const nextSlot = useMemo(() => getNextTimetableSlot(timetable, now), [timetable, now]);
  const ongoingSlot = useMemo(() => getOngoingTimetableSlot(timetable, now), [timetable, now]);
  const windows = useMemo(() => {
    const ordered = [...daySlots].sort((a, b) => a.startTime.localeCompare(b.startTime));
    const free: { start: string; end: string; minutes: number }[] = [];
    const asMinutes = (value: string) => { const [h, m] = value.split(':').map(Number); return h * 60 + m; };
    for (let index = 0; index < ordered.length - 1; index += 1) {
      const minutes = asMinutes(ordered[index + 1].startTime) - asMinutes(ordered[index].endTime);
      if (minutes >= 40) free.push({ start: ordered[index].endTime, end: ordered[index + 1].startTime, minutes });
    }
    return free;
  }, [daySlots]);
  const freeClassSummary = computeFreeClasses(selectedDay, daySlots);

  return (
    <div className="timetable-view timetable-portal-view space-y-5 pb-12">
      <section className="timetable-page-header">
        <div>
          <span className="portal-eyebrow">Academic schedule</span>
          <h2><Calendar size={20} /> Timetable</h2>
          <p>Weekly class schedule from synced VTOP timetable data.</p>
        </div>
        <div className="timetable-header-actions">
          <span className="timetable-sync-state"><Sparkles size={13} /> Synced data</span>
          <button className="timetable-predictor-trigger" onClick={() => setPredictorOpen(true)}><Calculator size={14} /> Predict attendance</button>
          {timetable.length > 0 && <button className="timetable-predictor-trigger" aria-label="Print or save timetable as PDF" onClick={() => exportTimetableToPdf(timetable.map((s) => ({ day: s.day, startTime: s.startTime, endTime: s.endTime, courseCode: s.courseCode, courseTitle: s.courseTitle || '', slot: s.slot || '', venue: s.venue || '', faculty: s.facultyName || '', isLab: s.isLab })), {})}><Printer size={14} /> PDF</button>}
          {timetable.length > 0 && <button className="timetable-predictor-trigger" aria-label="Download timetable as image" onClick={() => exportTimetableImage(timetable.map((s) => ({ day: s.day, startTime: s.startTime, endTime: s.endTime, courseCode: s.courseCode, courseTitle: s.courseTitle || '', slot: s.slot || '', venue: s.venue || '', faculty: s.facultyName || '', isLab: s.isLab })), {})}><ImageIcon size={14} /> Image</button>}
          {timetable.length > 0 && <button className="timetable-predictor-trigger" aria-label="Share timetable read-only" onClick={() => { setShareCode(null); setShareOpen(true); }}><Share2 size={14} /> Share</button>}
        </div>
      </section>

      <section className="timetable-week-panel">
        <header className="timetable-section-header">
          <div><h3>Weekly timetable</h3><p>See every VTOP class, slot, room and duration in one view.</p></div>
          {ongoingSlot ? (
            <span className="timetable-current-note timetable-now-note" role="status">
              <span className="timetable-live-dot" aria-hidden="true" />
              Ongoing now: {ongoingSlot.courseCode}{ongoingSlot.venue ? ` · ${ongoingSlot.venue}` : ''} · until {formatTime(ongoingSlot.endTime)}
            </span>
          ) : <span className="timetable-current-note">{currentDay ? `Today: ${currentDay}` : 'Select a day to view classes'}</span>}
        </header>
        {timeRows.length > 0 ? (
          <div className="timetable-week-scroll">
            <table className="timetable-week-table">
              <thead><tr><th scope="col" className="timetable-time-heading">Time</th>{weekDays.map((day) => <th scope="col" key={day} className={currentDay === day ? 'is-today' : ''}><span>{formatDay(day)}</span><small>{getTimetableDaySlots(timetable, day).length} classes</small></th>)}</tr></thead>
              <tbody>
                {timeRows.map((row, index) => {
                  const gap = getTimetableGap(timetable, row, timeRows[index + 1]);
                  return <React.Fragment key={row.startTime}>
                    <tr>
                      <th scope="row" className="timetable-time-cell"><strong>{formatTime(row.startTime)}</strong><small>to {formatTime(row.endTime)}</small></th>
                      {weekDays.map((day) => {
                        const cells = getTimetableCellSlots(timetable, day, row.startTime);
                        if (cells.length > 0) return <td key={`${day}-${row.startTime}`} className={currentDay === day ? 'is-today' : ''}>{cells.map((slot) => <GridClass key={slot.id} slot={slot} currentDay={currentDay} nextSlotId={nextSlot?.id} now={now} onNavigateMap={onNavigateMap} />)}</td>;
                        // A two-period lab starts in an earlier row but still covers
                        // this one. Calling that cell "Free" contradicted the class
                        // card directly above it, so say which session continues.
                        const continues = getTimetableContinuationSlots(timetable, day, row.startTime);
                        const continuesUntil = continues.reduce((latest, slot) => (slot.endTime.localeCompare(latest) > 0 ? slot.endTime : latest), continues[0]?.endTime ?? '');
                        return <td key={`${day}-${row.startTime}`} className={currentDay === day ? 'is-today' : ''}>{continues.length > 0 ? <span className="timetable-continues-cell">{continues.map((slot) => slot.courseCode || 'Class').join(' · ')} <small>continues until {formatTime(continuesUntil)}</small></span> : <span className="timetable-free-cell">Free</span>}</td>;
                      })}
                    </tr>
                    {gap && <tr className="timetable-lunch-row"><th scope="row">{gap.isLunch ? 'Lunch' : 'Break'}</th><td colSpan={weekDays.length}>{formatTime(gap.start)} – {formatTime(gap.end)} <span>No scheduled classes</span></td></tr>}
                  </React.Fragment>;
                })}
              </tbody>
            </table>
          </div>
        ) : <div className="timetable-empty-state"><Clock size={22} /><strong>Timetable data is not available</strong><span>Sync VTOP to load the weekly schedule.</span></div>}
      </section>

      <section className="timetable-mobile-panel">
        <div className="timetable-mobile-day-tabs" role="tablist" aria-label="Timetable day selection">
          {weekDays.map((day) => <button key={day} role="tab" aria-selected={selectedDay === day} className={`${selectedDay === day ? 'active' : ''} ${currentDay === day ? 'today' : ''}`} onClick={() => setSelectedDay(day)}><span>{formatDay(day)}</span><small>{getTimetableDaySlots(timetable, day).length}</small></button>)}
        </div>
        <header className="timetable-mobile-heading"><div><span className="portal-eyebrow">{currentDay === selectedDay ? 'Today' : 'Selected day'}</span><h3>{selectedDay}</h3></div><strong>{daySlots.length} {daySlots.length === 1 ? 'class' : 'classes'}</strong></header>
        <div className="timetable-mobile-list">
          {daySlots.length > 0 ? daySlots.map((slot) => <div className="timetable-mobile-row" key={slot.id}><div className="timetable-mobile-time"><strong>{formatTime(slot.startTime)}</strong><span>{formatTime(slot.endTime)}</span></div><GridClass slot={slot} currentDay={currentDay} nextSlotId={nextSlot?.id} now={now} onNavigateMap={onNavigateMap} compact /></div>) : <div className="timetable-empty-state"><Clock size={20} /><strong>Free day</strong><span>No classes scheduled for {selectedDay}.</span></div>}
        </div>
        <button className="timetable-mobile-predictor" onClick={() => setPredictorOpen(true)}><Calculator size={15} /> Predict attendance for {formatDay(selectedDay)}</button>
      </section>

      <section className="timetable-support-grid">
        <div className="timetable-support-card"><div className="timetable-support-title"><div><span className="portal-eyebrow">Selected day</span><h3>{selectedDay} availability</h3></div><Coffee size={17} /></div><div className="timetable-free-summary"><strong>{freeClassSummary.freeCount}<small> / {freeClassSummary.totalPeriods} free periods</small></strong>{/* freeMinutes only counts gaps long enough to actually use (>=40 min between
            classes), so saying "N minutes without a class" contradicted the free
            period count whenever the day had only short changeovers. */}<span>{freeClassSummary.freeMinutes > 0
              ? `${freeClassSummary.freeMinutes} minutes in usable gaps of 40+ between classes`
              : 'No gap of 40+ minutes between classes'}</span></div>{windows.length > 0 && <div className="timetable-free-windows">{windows.slice(0, 3).map((window) => <span key={`${window.start}-${window.end}`}>{formatTime(window.start)} – {formatTime(window.end)} · {window.minutes}m</span>)}</div>}</div>
        <div className="timetable-support-card"><div className="timetable-support-title"><div><span className="portal-eyebrow">Venue lookup</span><h3>Find a classroom</h3></div><MapPin size={17} /></div><p>Open the campus map for a room from the live timetable.</p><button className="timetable-map-link" onClick={() => onNavigateMap('')}><Building size={13} /> Open VIT WayFinder</button></div>
      </section>

      {predictorOpen && <AttendancePredictorSheet timetable={timetable} attendance={attendance} initialDay={selectedDay} onClose={() => setPredictorOpen(false)} />}

      {shareOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShareOpen(false)}>
          <div className="bg-white border border-zinc-200 rounded-2xl p-5 shadow-2xl max-w-md w-full mx-4 max-h-[85dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-extrabold text-zinc-900">Share timetable (read-only)</h3>
              <button onClick={() => setShareOpen(false)} className="p-1 rounded-lg hover:bg-zinc-100 text-zinc-500" aria-label="Close share dialog"><X className="h-4 w-4" /></button>
            </div>
            {shareCode ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-[11px] text-emerald-700 bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-3 py-2">
                  <ShieldCheck className="h-4 w-4 shrink-0" />
                  <span>{describeExpiry(decodeTimetableShare(shareCode)?.data?.expiresAt ?? 0)} · paste this code into another UltraCC to view</span>
                </div>
                <textarea readOnly value={shareCode} rows={5} onFocus={(e) => e.currentTarget.select()} className="w-full px-3 py-2.5 bg-white border border-zinc-200 rounded-xl text-[10px] font-mono text-zinc-900 outline-none resize-y" aria-label="Timetable share code" />
                <button
                  onClick={async () => {
                    try { await navigator.clipboard.writeText(shareCode); } catch { /* clipboard unavailable — text is selectable */ }
                    setShareCopied(true);
                    setTimeout(() => setShareCopied(false), 2000);
                  }}
                  className="w-full px-4 py-2.5 rounded-xl bg-blue-600 text-zinc-900 text-xs font-bold hover:bg-blue-500 transition cursor-pointer"
                >
                  {shareCopied ? 'Copied!' : 'Copy share code'}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-zinc-500">Generate a read-only code a friend can paste into their UltraCC. Nothing is uploaded — the code is self-contained text.</p>
                <ul className="text-[11px] text-zinc-500 space-y-1">
                  {describeShareContents(shareOptions).map((item) => (
                    <li key={item} className="flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5 text-zinc-600 shrink-0" /> {item}</li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setShareOptions((o) => ({ ...o, includeVenue: !o.includeVenue }))}
                    aria-pressed={Boolean(shareOptions.includeVenue)}
                    className={`px-3 py-1.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider border transition cursor-pointer ${shareOptions.includeVenue ? 'bg-blue-600 text-zinc-900 border-blue-500' : 'bg-white text-zinc-500 border-zinc-200 hover:text-zinc-900'}`}
                  >Venues</button>
                  <button
                    onClick={() => setShareOptions((o) => ({ ...o, includeFaculty: !o.includeFaculty }))}
                    aria-pressed={Boolean(shareOptions.includeFaculty)}
                    className={`px-3 py-1.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider border transition cursor-pointer ${shareOptions.includeFaculty ? 'bg-blue-600 text-zinc-900 border-blue-500' : 'bg-white text-zinc-500 border-zinc-200 hover:text-zinc-900'}`}
                  >Faculty</button>
                  <select
                    value={shareOptions.expiresInDays ?? 7}
                    onChange={(e) => setShareOptions((o) => ({ ...o, expiresInDays: Number(e.target.value) }))}
                    aria-label="Share code expiry"
                    className="px-3 py-1.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-white text-zinc-500 border border-zinc-200 cursor-pointer"
                  >
                    <option value={1}>1 day</option>
                    <option value={7}>7 days</option>
                    <option value={30}>30 days</option>
                    <option value={90}>90 days</option>
                  </select>
                </div>
                <button
                  onClick={() => setShareCode(encodeTimetableShare(timetable, shareOptions))}
                  className="w-full px-4 py-2.5 rounded-xl bg-blue-600 text-zinc-900 text-xs font-bold hover:bg-blue-500 transition cursor-pointer"
                >
                  Generate share code
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

