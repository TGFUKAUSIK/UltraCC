import { TimetableSlot, AttendanceRecord, ExamSchedule, AssignmentTask, NextActionState } from '../types';
import { matchAttendanceRecord } from './attendancePredictor';
import { examStartMs, isSameIstDay, istTodayStartMs } from './examUtils';

/**
 * The VTOP attendance row that belongs to THIS session. A course's theory and
 * lab halves are separate records, so matching on the course code alone can
 * quote the wrong half (a lab period shown with the theory percentage).
 * Returns undefined when VTOP has no confidently matching row.
 */
function attendanceForSlot(slot: TimetableSlot, attendance: AttendanceRecord[]): AttendanceRecord | undefined {
  const index = matchAttendanceRecord(slot, attendance);
  return index === null ? undefined : attendance[index];
}

export function calculateNextAction(
  timetable: TimetableSlot[],
  attendance: AttendanceRecord[],
  exams: ExamSchedule[],
  now: Date = new Date(),
  assignments: AssignmentTask[] = []
): NextActionState {

  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const currentTimeMinutes = currentHour * 60 + currentMinute;

  // Find day name
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const todayName = days[now.getDay()] as any;

  const todaySlots = timetable.filter((s) => s.day === todayName);

  // A day can hold two papers (a lab FAT in the morning, a theory FAT after).
  // Pick the one that matters now: the next to start, falling back to the
  // earliest when they are all under way.
  const examToday = exams
    .filter((e) => isSameIstDay(e.date, now))
    .map((exam) => ({ exam, startsAtMs: examStartMs(exam.date, exam.time) ?? Number.MAX_SAFE_INTEGER }))
    .sort((a, b) => a.startsAtMs - b.startsAtMs);
  const catExam = examToday.length ? examToday[0].exam : null;

  if (catExam) {
    // The card used to say "CAT Exam Today" for whatever row came first, and
    // "Starts in 45m" regardless of the real start time. Both the type and the
    // countdown now come from VTOP's own row; when the time is not published
    // yet there is no countdown rather than an invented one.
    const startsAtMs = examStartMs(catExam.date, catExam.time);
    const minutesToStart = startsAtMs === null ? 0 : Math.round((startsAtMs - now.getTime()) / 60000);
    return {
      currentStatus: 'Exam Day',
      title: `${catExam.examType === 'Other' ? 'Exam' : catExam.examType} Today: ${catExam.courseCode} (${catExam.courseTitle})`,
      timeContext: catExam.time ? `Exam Time: ${catExam.time}` : 'Exam time not released by VTOP',
      locationContext: `${catExam.venue || 'Venue not released'}${catExam.seatNo ? ` (Seat ${catExam.seatNo})` : ''}`,
      reasoning: 'Review formula sheets & carry your VIT student ID card.',
      nextStep: 'Reach venue 15 minutes before exam start time.',
      countdownMinutes: minutesToStart > 0 ? minutesToStart : 0,
      urgency: 'critical',
    };
  }

  // Saturday is a teaching day at Chennai (the slot table has SAT times), so an
  // empty-looking Saturday must be decided by the timetable, not the weekday.
  if (todayName === 'Sunday' || (todayName === 'Saturday' && todaySlots.length === 0)) {
    const dayStart = istTodayStartMs(now);
    const nextExam = exams
      .map((exam) => ({ exam, time: examStartMs(exam.date, '00:00') ?? Number.NaN }))
      .filter((item) => Number.isFinite(item.time) && item.time >= dayStart)
      .sort((a, b) => a.time - b.time)[0]?.exam;
    const nextAssignment = assignments
      .filter((assignment) => assignment.status === 'Pending' && assignment.dueDate)
      .map((assignment) => ({ assignment, time: new Date(assignment.dueDate).getTime() }))
      .filter((item) => Number.isFinite(item.time) && item.time >= dayStart)
      .sort((a, b) => a.time - b.time)[0]?.assignment;
    return {
      currentStatus: 'Evening Free',
      title: 'No classes scheduled today',
      timeContext: 'No scheduled academic classes today.',
      locationContext: 'No classroom assigned',
      reasoning: nextExam ? `${nextExam.examType || 'Exam'}: ${nextExam.courseCode || 'Course'} on ${nextExam.date}.` : nextAssignment ? `${nextAssignment.title} is due on ${nextAssignment.dueDate}.` : 'No upcoming exam or pending assignment is available from the synced data.',
      nextStep: nextAssignment ? `Review ${nextAssignment.title}${nextAssignment.courseCode ? ` (${nextAssignment.courseCode})` : ''}.` : nextExam ? `Prepare for ${nextExam.courseCode || nextExam.examType || 'the next exam'}.` : 'Review your synced academic records or refresh VTOP data.',
      countdownMinutes: 0,
      urgency: 'low',
    };
  }

  let activeSlot: TimetableSlot | null = null;
  let nextSlot: TimetableSlot | null = null;
  let minDiff = Infinity;

  for (const slot of todaySlots) {
    const [startH, startM] = slot.startTime.split(':').map(Number);
    const [endH, endM] = slot.endTime.split(':').map(Number);
    const slotStartMins = startH * 60 + startM;
    const slotEndMins = endH * 60 + endM;

    if (currentTimeMinutes >= slotStartMins && currentTimeMinutes < slotEndMins) {
      activeSlot = slot;
      break;
    } else if (slotStartMins > currentTimeMinutes) {
      const diff = slotStartMins - currentTimeMinutes;
      if (diff < minDiff) {
        minDiff = diff;
        nextSlot = slot;
      }
    }
  }

  if (activeSlot) {
    const courseAttendance = attendanceForSlot(activeSlot, attendance);
    const pct = courseAttendance ? `${courseAttendance.percentage}%` : 'not published by VTOP yet';

    return {
      currentStatus: 'Class Active',
      title: `${activeSlot.courseCode}: ${activeSlot.courseTitle}`,
      timeContext: `Active Slot ${activeSlot.slot} (${activeSlot.startTime} - ${activeSlot.endTime})`,
      locationContext: `Venue: ${activeSlot.venue} | Faculty: ${activeSlot.facultyName}`,
      reasoning: `Current attendance is ${pct}. Attending today maintains your safe buffer.`,
      nextStep: 'Mark attendance in faculty log if required & take module notes.',
      countdownMinutes: 0,
      urgency: courseAttendance && courseAttendance.percentage < 78 ? 'high' : 'medium',
    };
  }

  if (nextSlot) {
    const courseAttendance = attendanceForSlot(nextSlot, attendance);
    const pct = courseAttendance ? `${courseAttendance.percentage}%` : 'not available';

    return {
      currentStatus: 'Upcoming Class',
      title: `Next Class: ${nextSlot.courseCode} (${nextSlot.courseTitle})`,
      timeContext: `Starts at ${nextSlot.startTime} (in ${minDiff} minutes)`,
      locationContext: [nextSlot.building, nextSlot.roomNo ? `Room ${nextSlot.roomNo}` : '', nextSlot.venue].filter(Boolean).join(' | ') || 'Venue not published by VTOP',
      reasoning: `Attendance is ${pct}. Slot: ${nextSlot.slot}. Faculty: ${nextSlot.facultyName}`,
      nextStep: `Head to ${nextSlot.venue || nextSlot.building || 'the venue shown on VTOP'}${nextSlot.roomNo ? `, Room ${nextSlot.roomNo}` : ''}.`,
      countdownMinutes: minDiff,
      urgency: minDiff <= 15 ? 'high' : 'medium',
    };
  }

  return {
    currentStatus: 'Evening Free',
    title: 'Classes Done for Today!',
    timeContext: 'All scheduled slots completed.',
    locationContext: 'No classroom assigned',
    reasoning: 'All scheduled timetable slots are complete. Review your synced academic records for pending work.',
    nextStep: 'Review pending assignments and upcoming exams from the synced data.',
    countdownMinutes: 0,
    urgency: 'low',
  };
}

export function calculateBunkStats(attendanceRecord: AttendanceRecord, targetPct: number = 75) {
  const { attended, totalHeld } = attendanceRecord;
  const currentPct = totalHeld > 0 ? (attended / totalHeld) * 100 : 100;

  if (currentPct < targetPct) {
    // How many consecutive classes MUST be attended to reach targetPct?
    // (attended + x) / (totalHeld + x) = targetPct / 100
    // 100*(attended + x) = targetPct*(totalHeld + x)
    // 100*attended + 100*x = targetPct*totalHeld + targetPct*x
    // (100 - targetPct)*x = targetPct*totalHeld - 100*attended
    const required = Math.ceil((targetPct * totalHeld - 100 * attended) / (100 - targetPct));
    return {
      status: 'Debarred Risk',
      canBunk: 0,
      mustAttend: Math.max(0, required),
      message: `CRITICAL: You must attend the next ${required} consecutive classes without missing to reach ${targetPct}%.`,
      safeToBunk: false,
    };
  } else {
    // How many classes can be safely skipped while staying >= targetPct?
    // attended / (totalHeld + x) >= targetPct / 100
    // 100 * attended >= targetPct * totalHeld + targetPct * x
    // targetPct * x <= 100 * attended - targetPct * totalHeld
    const maxBunk = Math.floor((100 * attended - targetPct * totalHeld) / targetPct);
    return {
      status: 'Safe Buffer',
      canBunk: Math.max(0, maxBunk),
      mustAttend: 0,
      message: maxBunk > 0
        ? `SAFE: You can safely miss ${maxBunk} class${maxBunk > 1 ? 'es' : ''} while maintaining above ${targetPct}%.`
        : `BORDERLINE: You are currently at ${currentPct.toFixed(1)}%. Missing 1 class drops you below ${targetPct}%.`,
      safeToBunk: maxBunk > 0,
    };
  }
}
