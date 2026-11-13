import { describe, it, expect } from 'vitest';
import {
  toUiProfile,
  toUiAttendance,
  toUiTimetable,
  toUiMarks,
  toUiExams,
  toUiAssignments,
} from '../adapters';
import { StudentProfile, AttendanceRecord, TimetableSlot, CourseMarksRecord, ExamRecord, AssignmentRecord, TransportInfo } from '../types';

const profile: StudentProfile = {
  registrationNo: '23BCE0000',
  name: 'Aarav',
  program: 'B.Tech',
  branch: 'Computer Science & Engineering',
  school: 'SCOPE',
  semester: 'Semester 4',
  cgpa: 8.92,
  proctorName: 'Dr. R. Ramanathan',
  proctorEmail: 'faculty.name@vit.ac.in',
  proctorMobile: '+91 98765 43210',
};

const attendanceRows: AttendanceRecord[] = [
  {
    courseCode: 'CSE2001',
    courseTitle: 'Data Structures and Algorithms',
    courseType: 'ETH',
    slot: 'A1 + TA1',
    facultyName: 'Dr. Vasudevan',
    attended: 20,
    totalHeld: 28,
    percentage: 71.4,
    category: 'Theory',
    lastUpdated: '2026-08-10',
  },
];

const timetableSlots: TimetableSlot[] = [
  {
    id: 'Monday-A1-CSE2001-1',
    slot: 'A1',
    courseCode: 'CSE2001',
    courseTitle: 'Data Structures and Algorithms',
    courseType: 'ETH',
    facultyName: 'Dr. Vasudevan',
    venue: 'SJT 204',
    building: 'SJT (Silver Jubilee Tower)',
    startTime: '08:00',
    endTime: '08:50',
    day: 'Monday',
  },
  {
    id: 'Tuesday-L31-CSE2001L-1',
    slot: 'L31 + L32',
    courseCode: 'CSE2001L',
    courseTitle: 'Data Structures Lab',
    courseType: 'ELA',
    facultyName: 'Dr. Vasudevan',
    venue: 'Lab Block 201',
    building: 'Lab Block',
    startTime: '08:00 AM',
    endTime: '08:50 AM',
    day: 'Tuesday',
  },
];

const marks: CourseMarksRecord[] = [
  {
    courseCode: 'CSE2001',
    courseTitle: 'Data Structures and Algorithms',
    cat1: { title: 'CAT 1', maxMarks: 50, scored: 42.5, weightageMax: 15, weightageScored: 12.75, status: 'Evaluated' },
    cat2: { title: 'CAT 2', maxMarks: 50, scored: 44, weightageMax: 15, weightageScored: 13.2, status: 'Evaluated' },
    da1: { title: 'DA 1', maxMarks: 10, scored: 9.5, weightageMax: 5, weightageScored: 4.75, status: 'Evaluated' },
    da2: { title: 'DA 2', maxMarks: 10, scored: 10, weightageMax: 5, weightageScored: 5, status: 'Evaluated' },
    da3: { title: 'DA 3', maxMarks: 10, scored: 0, weightageMax: 0, weightageScored: 0, status: 'Pending' },
    quiz: { title: 'Quiz', maxMarks: 10, scored: 9, weightageMax: 10, weightageScored: 9, status: 'Evaluated' },
    totalInternalWeightScored: 44.7,
    currentEstimatedGrade: 'A Grade pathway',
  },
];

const exams: ExamRecord[] = [
  {
    id: 'exam-1-CSE2001-CAT 1',
    slot: 'A1',
    courseCode: 'CSE2001',
    courseTitle: 'Data Structures and Algorithms',
    examType: 'CAT 1',
    date: '2026-08-18',
    time: '10:00 AM - 11:30 AM',
    venue: 'SJT 402',
    seatNo: '',
    syllabusTopics: [],
  },
];

const assignments: AssignmentRecord[] = [
  {
    id: 'asgn-0-CSE2001',
    courseCode: 'CSE2001',
    courseTitle: 'Data Structures and Algorithms',
    title: 'DA 2: Graph Algorithms',
    dueDate: '2026-08-18',
    weightage: 10,
    status: 'Pending',
  },
];

describe('adapters', () => {
  it('maps the VTOP profile into the UI profile view-model', () => {
    const ui = toUiProfile(profile);
    expect(ui).toMatchObject({
      name: 'Aarav',
      regNo: '23BCE0000',
      semester: 4,
      cgpa: 8.92,
      proctorName: 'Dr. R. Ramanathan',
    });
    expect(ui.proctorContact).toContain('faculty.name@vit.ac.in');
  });

  it('carries the VTOP photo through to profilePhotoUrl (all avatar surfaces share it)', () => {
    const withPhoto: StudentProfile = { ...profile, profilePhotoDataUrl: 'data:image/jpeg;base64,AAAA' };
    const ui = toUiProfile(withPhoto);
    expect(ui.profilePhotoUrl).toBe('data:image/jpeg;base64,AAAA');
  });

  it('leaves profilePhotoUrl undefined when VTOP provided no photo (fallback, no fabrication)', () => {
    const ui = toUiProfile(profile);
    expect(ui.profilePhotoUrl).toBeUndefined();
  });

  it('maps attendance to VTOP’s own course type, filling venue from the timetable', () => {
    const ui = toUiAttendance(attendanceRows, timetableSlots);
    expect(ui).toHaveLength(1);
    expect(ui[0]).toMatchObject({
      courseCode: 'CSE2001',
      type: 'ETH',
      percentage: 71.4,
      venue: 'SJT 204',
    });
    // The mapping carries no attendance verdict: a 71.4% row must not arrive
    // pre-labelled Safe/Critical, because every surface measures the student's
    // own bar and the slider can move after the sync.
    expect(Object.keys(ui[0])).not.toContain('category');
  });

  it('uses the grade summary for CGPA + credits and marks absence as null (never 0)', () => {
    const ui = toUiProfile(profile, {
      available: true,
      cgpa: 8.92,
      creditsRegistered: 86,
      creditsEarned: 78,
    });
    expect(ui.cgpa).toBe(8.92);
    expect(ui.totalCreditsCompleted).toBe(78);
    expect(ui.totalCreditsRequired).toBe(86);
  });

  it('shows null CGPA/credits when the grade summary is unavailable', () => {
    const noGrades = toUiProfile({ ...profile, cgpa: 0 }, null);
    expect(noGrades.cgpa).toBeNull();
    expect(noGrades.totalCreditsCompleted).toBeNull();
    expect(noGrades.totalCreditsRequired).toBeNull();
  });

  it('never fabricates a proctor name or faculty name', () => {
    const noProctor = toUiProfile({ ...profile, proctorName: '', proctorEmail: '', proctorMobile: '' }, null);
    expect(noProctor.proctorName).toBe('');
    expect(noProctor.proctorAvailable).toBe(false);

    const noFaculty = toUiAttendance([{ ...attendanceRows[0], facultyName: '' }]);
    expect(noFaculty[0].facultyName).toBe('');

    const noTtFaculty = toUiTimetable([{ ...timetableSlots[0], facultyName: '' }]);
    expect(noTtFaculty[0].facultyName).toBe('');
  });

  it('strips stale placeholder faculty values from older caches (never shows them)', () => {
    const placeholders = [
      'Faculty Member',
      'Faculty Name',
      'Faculty name defaultly present',
      'Faculty not provided',
      'Faculty',
      'Staff',
      'TBD',
    ];
    placeholders.forEach((placeholder) => {
      const fromAttendance = toUiAttendance([{ ...attendanceRows[0], facultyName: placeholder }]);
      expect(fromAttendance[0].facultyName).toBe('');

      const fromTimetable = toUiTimetable([{ ...timetableSlots[0], facultyName: placeholder }]);
      expect(fromTimetable[0].facultyName).toBe('');
    });

    // Real names survive untouched.
    const real = toUiTimetable([{ ...timetableSlots[0], facultyName: 'Dr. R. Ramanathan' }]);
    expect(real[0].facultyName).toBe('Dr. R. Ramanathan');
  });

  it('cleans VTOP course-title artifacts at read time (live-cache defect: "- Title ( Embedded Theory )")', () => {
    // Exact shape captured from the user's live IndexedDB cache (2026-09-13).
    const tt = toUiTimetable([{ ...timetableSlots[0], courseTitle: '- Microcontrollers and Embedded Programming ( Embedded Theory )' }]);
    expect(tt[0].courseTitle).toBe('Microcontrollers and Embedded Programming');

    // "CODE - Title" packed cell, as served on some Chennai pages.
    const withCode = toUiExams([{ ...exams[0], courseTitle: 'BAEEE103 - Analog Electronics ( Embedded Theory )', courseCode: 'BAEEE103' }]);
    expect(withCode[0].courseTitle).toBe('Analog Electronics');

    // Already-clean titles and course-type suffixes that are NOT the trailing
    // parenthetical survive untouched.
    const clean = toUiTimetable([{ ...timetableSlots[0], courseTitle: 'Control Systems' }]);
    expect(clean[0].courseTitle).toBe('Control Systems');
  });

  it('strips employee IDs and school suffixes from real VTOP faculty cells', () => {
    const raw = toUiAttendance([
      { ...attendanceRows[0], facultyName: '50596 BINU BEN JOSE D R SELECT' },
    ]);
    expect(raw[0].facultyName).toBe('BINU BEN JOSE D R');

    const withTitle = toUiTimetable([{ ...timetableSlots[0], facultyName: 'Dr. Vasudevan - Associate Professor' }]);
    expect(withTitle[0].facultyName).toBe('Dr. Vasudevan');

    // Live-cache shape: the school suffix was joined by a separator, so removing
    // it leaves an orphan dash. It must not print as "BINU BEN JOSE D R -".
    const orphan = toUiTimetable([{ ...timetableSlots[0], facultyName: 'BINU BEN JOSE D R - SELECT' }]);
    expect(orphan[0].facultyName).toBe('BINU BEN JOSE D R');

    // Vendor names without ID/school tokens stay intact.
    const vendor = toUiAttendance([{ ...attendanceRows[0], facultyName: 'ETHNUS ETHNUS (APT) ACAD' }]);
    expect(vendor[0].facultyName).toBe('ETHNUS ETHNUS (APT) ACAD');
  });

  it('maps timetable slots, normalizing times and deriving building/room/isLab', () => {
    const ui = toUiTimetable(timetableSlots);
    expect(ui).toHaveLength(2);
    expect(ui[0]).toMatchObject({ day: 'Monday', startTime: '08:00', endTime: '08:50', building: 'SJT', roomNo: '204', isLab: false });
    // "08:00 AM" style times are normalized to the 24h VTOP rows are compared in
    expect(ui[1].startTime).toBe('08:00');
    expect(ui[1].isLab).toBe(true);
    expect(ui[1].building).toBe('Lab Block');
  });

  it('combines the gateway\'s per-slot lab rows into ONE session and keeps VTOP\'s slot label', () => {
    // The deployed gateway parses VTOP's "L31+L32" course-list cell into TWO
    // single-token rows (one per period). The UI model must still show the one
    // 2-period teaching session the student actually attends — merged here at
    // the adapter chokepoint so every view, export and reminder agrees.
    const split: TimetableSlot[] = [
      { id: 'Monday-L31-CSE2001L-1', slot: 'L31', courseCode: 'CSE2001L', courseTitle: 'Data Structures Lab', courseType: 'ELA', facultyName: 'Dr. Vasudevan', venue: 'Lab Block 201', building: 'Lab Block', startTime: '14:00', endTime: '14:50', day: 'Monday' },
      { id: 'Monday-L32-CSE2001L-2', slot: 'L32', courseCode: 'CSE2001L', courseTitle: 'Data Structures Lab', courseType: 'ELA', facultyName: 'Dr. Vasudevan', venue: 'Lab Block 201', building: 'Lab Block', startTime: '14:50', endTime: '15:40', day: 'Monday' },
      { id: 'Monday-A1-CSE2001-1', slot: 'A1', courseCode: 'CSE2001', courseTitle: 'Data Structures and Algorithms', courseType: 'ETH', facultyName: 'Dr. Vasudevan', venue: 'SJT 204', building: 'SJT', startTime: '08:00', endTime: '08:50', day: 'Monday' },
    ];
    const ui = toUiTimetable(split);
    expect(ui).toHaveLength(2);
    const lab = ui.find((s) => s.courseCode === 'CSE2001L');
    expect(lab).toMatchObject({ slot: 'L31+L32', startTime: '14:00', endTime: '15:40', isLab: true });
    // Theory rows pass through untouched, slot preserved verbatim from VTOP.
    expect(ui.find((s) => s.courseCode === 'CSE2001')).toMatchObject({ slot: 'A1', startTime: '08:00', endTime: '08:50', isLab: false });
  });

  it('never merges lab rows that are not one contiguous session (honesty over prettiness)', () => {
    const gap: TimetableSlot[] = [
      { id: 'Monday-L31-X-1', slot: 'L31', courseCode: 'CSE2001L', courseTitle: 'Lab', courseType: 'ELA', facultyName: '', venue: 'Lab Block 201', building: 'Lab Block', startTime: '08:00', endTime: '08:50', day: 'Monday' },
      { id: 'Monday-L32-X-2', slot: 'L32', courseCode: 'CSE2001L', courseTitle: 'Lab', courseType: 'ELA', facultyName: '', venue: 'Lab Block 201', building: 'Lab Block', startTime: '10:00', endTime: '10:50', day: 'Monday' },
    ];
    expect(toUiTimetable(gap)).toHaveLength(2);
  });

  it('maps marks into the UI CourseMarks shape', () => {
    const ui = toUiMarks(marks);
    // VTOP's own evaluation state travels with the row: without it the UI
    // cannot tell a graded zero from an exam that has not been held yet.
    expect(ui[0].cat1).toEqual({ scored: 42.5, max: 50, weightage: 15, status: 'Evaluated' });
    // FAT with no real score maps to max 0 AND weightage 0 — the UI renders
    // "not evaluated" (never a fabricated "/100"), and pending-weight math
    // doesn't count a weight VTOP has not declared.
    expect(ui[0].fat).toEqual({ scored: 0, max: 0, weightage: 0 });
    expect(ui[0].totalScoredSoFar).toBe(44.7);
  });

  it('keeps a Pending assessment row honest — real max/weightage, ungraded status', () => {
    // Live fresh-semester shape: VTOP publishes CAT 2 as a row with a declared
    // max and weightage but status 'Pending' and scored 0. Dropping the status
    // made every consumer read an unheld exam as a scored zero.
    const pending = [{
      ...marks[0],
      cat2: { title: 'CAT 2', maxMarks: 50, scored: 0, weightageMax: 15, weightageScored: 0, status: 'Pending' as const },
    }];
    const ui = toUiMarks(pending);
    expect(ui[0].cat2).toEqual({ scored: 0, max: 50, weightage: 15, status: 'Pending' });
  });

  it('maps a real evaluated FAT score when VTOP exposes one', () => {
    const withFat = [{ ...marks[0], fat: { title: 'FAT', maxMarks: 100, scored: 82, weightageMax: 50, weightageScored: 41, status: 'Evaluated' as const } }];
    const ui = toUiMarks(withFat);
    expect(ui[0].fat).toEqual({ scored: 82, max: 100, weightage: 50, status: 'Evaluated' });
  });

  it('keeps each FAT in the class VTOP served it in', () => {
    // The gateway merges an embedded course's two tables into one record; the
    // lab FAT still has to arrive marked 'L', or the grade model adds it to
    // the theory half and one class's mark looks like the whole course's.
    const embedded = [{
      ...marks[0],
      fat: { title: 'FAT', maxMarks: 100, scored: 62, weightageMax: 100, weightageScored: 62, status: 'Evaluated' as const, part: 'T' as const },
      labFat: { title: 'Lab FAT', maxMarks: 50, scored: 40, weightageMax: 100, weightageScored: 80, status: 'Evaluated' as const, part: 'L' as const },
    }];
    const ui = toUiMarks(embedded);
    expect(ui[0].fat).toMatchObject({ scored: 62, part: 'T' });
    expect(ui[0].labFat).toMatchObject({ scored: 40, part: 'L' });
  });

  it('maps exams with priority and safe seat fallback', () => {
    const ui = toUiExams(exams);
    expect(ui[0]).toMatchObject({
      examType: 'CAT 1',
      date: '2026-08-18',
      seatNo: '',
      topicsCompleted: 0,
    });
  });

  it('maps assignments and maps Graded -> Submitted', () => {
    const ui = toUiAssignments(assignments);
    expect(ui[0]).toMatchObject({ dueDate: '2026-08-18', weightage: '10 Marks', status: 'Pending' });
    const graded = toUiAssignments([{ ...assignments[0], status: 'Graded' }]);
    expect(graded[0].status).toBe('Submitted');
  });
});

describe('timetable venue → building mapping never guesses', () => {
  const at = (venue: string) => toUiTimetable([{ ...timetableSlots[0], venue }]);

  it('resolves the buildings this campus map knows', () => {
    expect(at('SJT 204')[0].building).toBe('SJT');
    expect(at('SILVER JUBILEE TOWER 101')[0].building).toBe('SJT');
    expect(at('AB1 320')[0].building).toBe('AB1');
    expect(at('AB2 118')[0].building).toBe('AB2');
    expect(at('Main Block 402')[0].building).toBe('MB');
    expect(at('TT 302')[0].building).toBe('Lab Block');
  });

  it('leaves an unknown venue unresolved instead of defaulting to SJT', () => {
    // CCE / CRIS / hostel-block rooms used to be reported as SJT, so students
    // were walked to the wrong building by the next-class card.
    expect(at('CCE Seminar Hall')[0].building).toBe('');
    expect(at('CRIS 214')[0].building).toBe('');
    expect(at('')[0].building).toBe('');
  });

  it('keeps the raw venue and room so the UI can still show what VTOP said', () => {
    const ui = at('CRIS 214');
    expect(ui[0].venue).toBe('CRIS 214');
    expect(ui[0].roomNo).toBe('214');
  });
});

describe('assignment deadlines do not invent a cut-off time', () => {
  it('leaves dueTime empty when VTOP publishes only a due date', () => {
    const ui = toUiAssignments(assignments);
    expect(ui[0].dueDate).toBeTruthy();
    expect(ui[0].dueTime).toBe('');
  });
});

/**
 * The profile screen's "School" row is not the student's school for many
 * Chennai records — it carries the faculty/research centre the row is grouped
 * under. A real B.Tech EEE profile reads "Centre for e-Automation Technologies"
 * there, and the portal printed that as the student's own school on the
 * dashboard heading, My Info and the AI Advisor payload.
 */
describe('profile school is the student\'s, not the proctor\'s', () => {
  const centre = { ...profile, school: 'Centre for e-Automation Technologies', branch: 'Electrical and Electronics Engineering' };

  it('derives the school from the branch when VTOP\'s row is a research centre', () => {
    expect(toUiProfile(centre).school).toBe('SELECT');
  });

  it('keeps VTOP\'s school when the row genuinely names one', () => {
    expect(toUiProfile(profile).school).toBe('SCOPE');
    expect(toUiProfile({ ...profile, school: 'School of Advanced Sciences' }).school).toBe('School of Advanced Sciences');
  });

  it('takes the branch from the transport record when the profile row is the +2 group', () => {
    const transport = {
      hasRegistration: true, registerNumber: '23BCE0000', name: 'Aarav',
      branch: 'Electronics and Communication Engineering', programme: 'B.Tech',
    } as unknown as TransportInfo;
    const ui = toUiProfile({ ...profile, branch: '', school: 'Centre for e-Automation Technologies' }, null, transport);
    expect(ui.branch).toBe('Electronics and Communication Engineering');
    expect(ui.school).toBe('SENSE');
  });

  it('shows nothing rather than the proctor\'s centre when no branch is known', () => {
    const ui = toUiProfile({ ...profile, branch: '', school: 'Centre for e-Automation Technologies' });
    expect(ui.school).toBe('');
    expect(ui.school).not.toContain('Centre');
  });
});
