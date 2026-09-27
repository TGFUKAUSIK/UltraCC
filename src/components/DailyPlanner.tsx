/**
 * DailyPlanner — today's class planner showing each class
 * with attendance status, slot, venue, and faculty.
 */

import React from 'react';
import { Clock, MapPin, User, BookOpen, AlertTriangle, CheckCircle } from 'lucide-react';
import { AttendanceRecord, TimetableSlot } from '../lib/vtop/types';

interface DailyPlannerProps {
  attendance: AttendanceRecord[];
  timetable: TimetableSlot[];
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function parseTime(t: string): number {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export const DailyPlanner: React.FC<DailyPlannerProps> = ({ attendance, timetable }) => {
  const now = new Date();
  const dayIdx = now.getDay();
  const dayName = DAY_SHORT[dayIdx];
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const isWeekend = dayIdx === 0 || dayIdx === 6;

  // Filter today's timetable entries
  const todaySlots = timetable
    .filter((s) => s.day === dayName)
    .sort((a, b) => parseTime(a.startTime) - parseTime(b.startTime));

  // Match each slot with attendance data
  const plannerItems = todaySlots.map((slot) => {
    const att = attendance.find((a) => a.courseCode === slot.courseCode);
    const startMin = parseTime(slot.startTime);
    const endMin = parseTime(slot.endTime);
    const isPast = nowMin > endMin;
    const isCurrent = nowMin >= startMin && nowMin <= endMin;
    const isUpcoming = nowMin < startMin;

    return {
      slot,
      attendance: att,
      percentage: att?.percentage ?? 0,
      attended: att?.attended ?? 0,
      totalHeld: att?.totalHeld ?? 0,
      isPast,
      isCurrent,
      isUpcoming,
      risk: (att?.percentage ?? 100) < 75 ? 'danger' : (att?.percentage ?? 100) < 80 ? 'warning' : 'safe',
    };
  });

  const nextUpcoming = plannerItems.find((p) => p.isUpcoming);

  if (isWeekend) {
    return (
      <div className="bg-white border border-zinc-200 rounded-3xl p-5 shadow-xl">
        <div className="flex items-center gap-2 mb-3">
          <BookOpen className="h-5 w-5 text-emerald-600" />
          <h3 className="text-sm font-extrabold text-zinc-900">{DAY_NAMES[dayIdx]}</h3>
        </div>
        <p className="text-xs text-zinc-500 text-center py-6">No classes today 🎉 — enjoy the break!</p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-zinc-200 rounded-3xl p-5 shadow-xl">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-emerald-600" />
          <div>
            <h3 className="text-sm font-extrabold text-zinc-900">Today's Schedule</h3>
            <p className="text-[10px] text-zinc-500">{DAY_NAMES[dayIdx]} · {todaySlots.length} classes</p>
          </div>
        </div>
        {nextUpcoming && (
          <div className="text-right">
            <p className="text-[10px] text-zinc-500">Next up</p>
            <p className="text-xs font-bold text-blue-600">{nextUpcoming.slot.courseCode}</p>
            <p className="text-[10px] text-zinc-500">{nextUpcoming.slot.startTime}</p>
          </div>
        )}
      </div>

      {plannerItems.length === 0 ? (
        <p className="text-xs text-zinc-500 text-center py-4">No timetable entries for today.</p>
      ) : (
        <div className="space-y-2">
          {plannerItems.map((item, idx) => (
            <div
              key={`${item.slot.courseCode}-${idx}`}
              className={`flex items-center gap-3 p-3 rounded-xl border transition ${
                item.isCurrent
                  ? 'bg-blue-500/10 border-blue-500/30 ring-1 ring-blue-500/20'
                  : item.isPast
                    ? 'bg-zinc-50 border-zinc-200 opacity-60'
                    : 'bg-zinc-50 border-zinc-200'
              }`}
            >
              {/* Time */}
              <div className="w-16 shrink-0 text-center">
                <p className="text-[11px] font-mono font-bold text-zinc-900">{item.slot.startTime}</p>
                <p className="text-[9px] text-zinc-600">{item.slot.endTime}</p>
                {item.isCurrent && <span className="text-[8px] font-bold text-blue-600 uppercase">Now</span>}
              </div>

              {/* Course info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-zinc-900 truncate">{item.slot.courseCode}</span>
                  {item.risk === 'danger' && <AlertTriangle className="h-3 w-3 text-red-600 shrink-0" />}
                  {item.risk === 'safe' && <CheckCircle className="h-3 w-3 text-emerald-600 shrink-0" />}
                </div>
                <p className="text-[10px] text-zinc-500 truncate">{item.slot.courseTitle}</p>
                <div className="flex items-center gap-2 mt-0.5 text-[9px] text-zinc-600">
                  <span className="flex items-center gap-0.5"><User className="h-2.5 w-2.5" /> {item.slot.facultyName}</span>
                  <span className="flex items-center gap-0.5"><MapPin className="h-2.5 w-2.5" /> {item.slot.venue}</span>
                </div>
              </div>

              {/* Attendance */}
              <div className="text-right shrink-0">
                <p className={`text-lg font-black font-mono ${
                  item.percentage >= 80 ? 'text-emerald-600' :
                  item.percentage >= 75 ? 'text-amber-600' : 'text-red-600'
                }`}>
                  {item.percentage}%
                </p>
                <p className="text-[9px] text-zinc-600">{item.attended}/{item.totalHeld}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Summary bar */}
      {plannerItems.length > 0 && (
        <div className="mt-3 pt-3 border-t border-zinc-200 flex items-center justify-between text-[10px] text-zinc-500">
          <span>{plannerItems.filter((p) => p.isPast).length} completed · {plannerItems.filter((p) => p.isUpcoming).length} upcoming</span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      )}
    </div>
  );
};
