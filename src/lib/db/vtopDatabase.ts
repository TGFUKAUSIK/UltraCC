import { StudentProfile, AttendanceRecord, TimetableSlot, CourseMarksRecord, ExamRecord, AssignmentRecord, SemesterInfo, VtopSyncMetadata, GradeSummary, GradeHistory, SemesterGrades, OdSummary, AcademicCalendar, ArrearRecord, CircularRecord, CurriculumProgress, MakeupExamRecord, RefatInfo, CompreInfo, PaymentsInfo, CredentialsInfo, TransportInfo, SapInfo, PaymentReceiptsInfo, BankInfo, BiometricInfo, ProctorMessage, LoginHistoryRow, ClassMessage, HodDeanInfo, WalletInfo, ExtraCurricularInfo, SyllabusCacheEntry, CoursePageCacheEntry } from '../vtop/types';
import {
  LmsCourse,
  LmsAssignment,
  LmsQuizWindow,
  LmsGradeItem,
  LmsMaterial,
  LmsForumPost,
  LmsCalendarEvent,
  LmsSyncMetadata,
  QuizNotificationRecord,
  CachedMaterial,
} from '../lms/types';

const DB_NAME = 'VitUniCCDatabase';
/**
 * v12 exists because the "v6"-"v11" stores below were added while the version
 * was already 11, so early databases never ran their upgrade. Every store is
 * guarded by `objectStoreNames.contains()`, so bumping is idempotent.
 *
 * v13 adds `syllabusCache` (one VTOP Course Page syllabus per student, course
 * and semester). Not part of `VtopCachedData`: these documents are multi-
 * megabyte and `getAllData()` runs on every start, so reading them all back
 * would move tens of megabytes into memory for a tab the student may never open.
 *
 * v14 adds `coursePageCache`, VTOP's Course Page listing of registered classes.
 * The Syllabus tab no longer reads it; it stays declared so an existing profile
 * keeps its schema rather than being migrated for no data.
 */
const DB_VERSION = 14;

export interface VtopCachedData {
  profile: StudentProfile | null;
  attendance: AttendanceRecord[];
  timetable: TimetableSlot[];
  marks: CourseMarksRecord[];
  exams: ExamRecord[];
  assignments: AssignmentRecord[];
  semesters: SemesterInfo[];
  grades: GradeSummary | null;
  /** Cumulative grade history (effective grades + grade-count distribution). */
  gradeHistory: GradeHistory | null;
  /** Per-semester course grades + GPA for the selected semester. */
  semesterGrades: SemesterGrades | null;
  od: OdSummary | null;
  /** VIT academic calendar (3-step gateway flow). */
  calendar: AcademicCalendar | null;
  /** Backlog/arrear courses across all semesters. */
  arrears: ArrearRecord[];
  /** VTOP circulars/notices feed. */
  circulars: CircularRecord[];
  /** Degree/credit progress from the grade-history page. */
  curriculum: CurriculumProgress | null;
  /** Makeup exam schedule (semester-scoped). */
  makeupExams: MakeupExamRecord[];
  /** Re-exam / reFAT eligibility + courses. */
  refat: RefatInfo | null;
  /** Compre exam registration status. */
  compre: CompreInfo | null;
  /** Fee dues summary (/vtop/p2p/Payments). */
  payments: PaymentsInfo | null;
  /** VTOP-managed student credentials (accounts + usernames). */
  credentials: CredentialsInfo | null;
  /** Day-scholar transport registration (Chennai). */
  transport: TransportInfo | null;
  /** SAP ID info (/vtop/sap/SapInformation). */
  sapInfo: SapInfo | null;
  /** Fee payment receipts (/vtop/p2p/getReceiptsApplno). */
  paymentReceipts: PaymentReceiptsInfo | null;
  /** Bank information (/vtop/studentBankInformation/BankInfoStudent). */
  bankInfo: BankInfo | null;
  /** Biometric info (/vtop/academics/common/BiometricInfo). */
  biometric: BiometricInfo | null;
  /** Proctor messages (/vtop/proctor/viewMessagesSendByProctor). */
  proctorMessages: ProctorMessage[];
  /** Login history (/vtop/show/login/history). */
  loginHistory: LoginHistoryRow[];
  /** Class messages (/vtop/academics/common/StudentClassMessage). */
  classMessages: ClassMessage[];
  /** HOD / Dean details (/vtop/hrms/viewHodDeanDetails). */
  hodDean: HodDeanInfo | null;
  /** Student wallet (/vtop/finance/getStudentWallet). */
  wallet: WalletInfo | null;
  /** Extra-curricular activities (/vtop/academics/common/ExtraCurricular). */
  extraCurricular: ExtraCurricularInfo | null;
  metadata: VtopSyncMetadata;
  /** Sanitized marks diagnostic (component names VTOP served per course). */
  marksDiag?: { courseCode: string; courseTitle: string; assessments: string[] }[];
}

/**
 * Every store holding per-student VTOP data. The cache is single-tenant — a
 * second sign-in must replace it wholesale, never merge into it.
 */
const VTOP_STORES: string[] = ['profile', 'attendance', 'timetable', 'marks', 'exams', 'assignments', 'semesters', 'grades', 'gradeHistory', 'semesterGrades', 'od', 'calendar', 'arrears', 'circulars', 'curriculum', 'makeupExams', 'refat', 'compre', 'payments', 'credentials', 'transport', 'sapInfo', 'paymentReceipts', 'bankInfo', 'biometric', 'proctorMessages', 'loginHistory', 'classMessages', 'hodDean', 'wallet', 'extraCurricular', 'metadata'];

/** The per-course syllabus store. Not in `VTOP_STORES` — see DB_VERSION note. */
const SYLLABUS_STORE = 'syllabusCache';

/** VTOP Course Page's registered-class listing, per student and semester. */
const COURSE_PAGE_STORE = 'coursePageCache';

// Returns only the stores this database actually has. A transaction on a
// missing store throws `NotFoundError` for the whole call, so one store an old
// database never gained would make the whole cache unreadable.
function openStores(db: IDBDatabase, names: string[]): string[] {
  return names.filter((name) => db.objectStoreNames.contains(name));
}

// Clear a store and write replacement rows, skipping keyless rows. A keyless
// `put()` throws and would abort the transaction, discarding every dataset in
// the same sync.
function replaceRows(tx: IDBTransaction, storeName: string, keyPath: string, rows: object[]): void {
  if (!tx.objectStoreNames.contains(storeName)) return;
  const store = tx.objectStore(storeName);
  store.clear();
  for (const row of rows) {
    const key = (row as Record<string, unknown>)[keyPath];
    if (key === undefined || key === null) continue;
    store.put(row);
  }
}

/** Write one record, ignoring stores this database does not have. */
function putRow(tx: IDBTransaction, storeName: string, value: object): void {
  if (!tx.objectStoreNames.contains(storeName)) return;
  tx.objectStore(storeName).put(value);
}

/** Delete everything in a store, ignoring stores this database does not have. */
function clearRowStore(tx: IDBTransaction, storeName: string): void {
  if (!tx.objectStoreNames.contains(storeName)) return;
  tx.objectStore(storeName).clear();
}

/**
 * Pick the cached row for the semester actually selected in the UI.
 *
 * Some datasets are written under the semester id rather than 'current'
 * (semesterGrades is the grade card for one specific term). Reading them by
 * position returned whichever term was synced first, because IndexedDB walks
 * keys in ascending order — so a student who switched terms kept seeing the
 * previous term's SGPA under the new term's heading, indefinitely. When the
 * selected term has no row, the honest answer is "not synced for this term".
 */
function pickTermRow<T extends { id: string }>(rows: T[], selectedSemesterId?: string): T | null {
  if (!rows.length) return null;
  const wanted = (selectedSemesterId || '').trim();
  if (!wanted) return rows[0];
  return rows.find((row) => row.id === wanted) ?? null;
}

class VtopLocalDatabase {
  private dbPromise: Promise<IDBDatabase>;

  /** Message from the most recent failed cache read, or null when reads work. */
  lastCacheReadError: string | null = null;

  constructor() {
    this.dbPromise = new Promise((resolve, reject) => {
      if (typeof window === 'undefined' || !window.indexedDB) {
        reject('IndexedDB not available');
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (!db.objectStoreNames.contains('profile')) {
          db.createObjectStore('profile', { keyPath: 'registrationNo' });
        }
        if (!db.objectStoreNames.contains('attendance')) {
          db.createObjectStore('attendance', { keyPath: 'courseCode' });
        }
        if (!db.objectStoreNames.contains('timetable')) {
          db.createObjectStore('timetable', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('marks')) {
          db.createObjectStore('marks', { keyPath: 'courseCode' });
        }
        if (!db.objectStoreNames.contains('exams')) {
          db.createObjectStore('exams', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('assignments')) {
          db.createObjectStore('assignments', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('semesters')) {
          db.createObjectStore('semesters', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('grades')) {
          db.createObjectStore('grades', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('gradeHistory')) {
          db.createObjectStore('gradeHistory', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('semesterGrades')) {
          db.createObjectStore('semesterGrades', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('od')) {
          db.createObjectStore('od', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('metadata')) {
          db.createObjectStore('metadata', { keyPath: 'id' });
        }
        // --- Academic calendar / arrears / circulars / curriculum — v6 ---
        if (!db.objectStoreNames.contains('calendar')) {
          db.createObjectStore('calendar', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('arrears')) {
          db.createObjectStore('arrears', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('circulars')) {
          db.createObjectStore('circulars', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('curriculum')) {
          db.createObjectStore('curriculum', { keyPath: 'id' });
        }
        // --- Special-exam modules (makeup / refat / compre) — v7 ---
        if (!db.objectStoreNames.contains('makeupExams')) {
          db.createObjectStore('makeupExams', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('refat')) {
          db.createObjectStore('refat', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('compre')) {
          db.createObjectStore('compre', { keyPath: 'id' });
        }
        // --- Payments / credentials / transport — v8 ---
        if (!db.objectStoreNames.contains('payments')) {
          db.createObjectStore('payments', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('credentials')) {
          db.createObjectStore('credentials', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('transport')) {
          db.createObjectStore('transport', { keyPath: 'id' });
        }
        // --- SAP info / payment receipts — v9 ---
        if (!db.objectStoreNames.contains('sapInfo')) {
          db.createObjectStore('sapInfo', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('paymentReceipts')) {
          db.createObjectStore('paymentReceipts', { keyPath: 'id' });
        }
        // --- Bank info / biometric / proctor messages / login history — v10 ---
        if (!db.objectStoreNames.contains('bankInfo')) {
          db.createObjectStore('bankInfo', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('biometric')) {
          db.createObjectStore('biometric', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('proctorMessages')) {
          db.createObjectStore('proctorMessages', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('loginHistory')) {
          db.createObjectStore('loginHistory', { keyPath: 'id' });
        }
        // --- Class messages / HOD-Dean / wallet / extra-curricular — v11 ---
        if (!db.objectStoreNames.contains('classMessages')) {
          db.createObjectStore('classMessages', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('hodDean')) {
          db.createObjectStore('hodDean', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('wallet')) {
          db.createObjectStore('wallet', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('extraCurricular')) {
          db.createObjectStore('extraCurricular', { keyPath: 'id' });
        }
        // --- LMS (Moodle) stores — v5 ---
        if (!db.objectStoreNames.contains('lmsCourses')) {
          db.createObjectStore('lmsCourses', { keyPath: 'courseId' });
        }
        if (!db.objectStoreNames.contains('lmsAssignments')) {
          db.createObjectStore('lmsAssignments', { keyPath: 'assignmentId' });
        }
        if (!db.objectStoreNames.contains('lmsQuizzes')) {
          db.createObjectStore('lmsQuizzes', { keyPath: 'quizId' });
        }
        if (!db.objectStoreNames.contains('lmsGradebook')) {
          db.createObjectStore('lmsGradebook', { keyPath: 'courseId' });
        }
        if (!db.objectStoreNames.contains('lmsMaterials')) {
          db.createObjectStore('lmsMaterials', { keyPath: 'materialId' });
        }
        if (!db.objectStoreNames.contains('lmsForum')) {
          db.createObjectStore('lmsForum', { keyPath: 'courseId' });
        }
        if (!db.objectStoreNames.contains('lmsCalendar')) {
          db.createObjectStore('lmsCalendar', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('lmsMetadata')) {
          db.createObjectStore('lmsMetadata', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('quizNotifications')) {
          db.createObjectStore('quizNotifications', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('materialCache')) {
          db.createObjectStore('materialCache', { keyPath: 'materialId' });
        }
        // --- VTOP Course Page syllabus documents — v13 ---
        if (!db.objectStoreNames.contains('syllabusCache')) {
          db.createObjectStore('syllabusCache', { keyPath: 'cacheKey' });
        }
        // --- VTOP Course Page registered-class listing — v14 ---
        if (!db.objectStoreNames.contains('coursePageCache')) {
          db.createObjectStore('coursePageCache', { keyPath: 'cacheKey' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      // Without this the promise never settles: an open tab holding the old
      // version blocks the upgrade, and every caller hangs on `await this.dbPromise`.
      request.onblocked = () =>
        reject(new Error('another tab is still using this database — close it and reload'));
    });
  }

  async saveAllData(
    data: Partial<VtopCachedData>,
    source: 'LIVE_VTOP' | 'CACHED_INDEXEDDB' | 'DEMO_MODE',
    selectedSemesterId?: string,
    registrationNo?: string,
    /**
     * `syncedAt` is the moment data actually arrived. A sync in which every
     * dataset failed must not stamp this device as freshly synced — that
     * timestamp is what the "Synced …" label, the staleness check and the
     * auto-refresh cooldown all read, so stamping it turned an outage into six
     * hours of confidently displayed stale data.
     */
    opts?: { syncedAt?: number },
  ): Promise<void> {
    try {
      const db = await this.dbPromise;
      const tx = db.transaction(openStores(db, VTOP_STORES), 'readwrite');

      if (data.profile) {
        // Keep one profile/photo in the cache so a later account never inherits
        // the previous avatar. The store is keyed on registrationNo; a profile
        // served without one is written under the sync's registration number.
        clearRowStore(tx, 'profile');
        const regNo = data.profile.registrationNo || registrationNo || '';
        if (regNo) putRow(tx, 'profile', { ...data.profile, registrationNo: regNo });
      }
      if (data.attendance) replaceRows(tx, 'attendance', 'courseCode', data.attendance);
      if (data.timetable) replaceRows(tx, 'timetable', 'id', data.timetable);
      if (data.marks) replaceRows(tx, 'marks', 'courseCode', data.marks);
      if (data.exams) replaceRows(tx, 'exams', 'id', data.exams);
      if (data.assignments) replaceRows(tx, 'assignments', 'id', data.assignments);
      if (data.semesters) replaceRows(tx, 'semesters', 'id', data.semesters);
      if (data.grades) putRow(tx, 'grades', { id: 'current', ...data.grades });
      if (data.gradeHistory) putRow(tx, 'gradeHistory', { id: 'current', ...data.gradeHistory });
      if (data.semesterGrades) putRow(tx, 'semesterGrades', { id: selectedSemesterId || 'current', ...data.semesterGrades });
      if (data.od) putRow(tx, 'od', { id: 'current', ...data.od });
      if (data.calendar) putRow(tx, 'calendar', { id: 'current', ...data.calendar });
      if (data.arrears) {
        replaceRows(
          tx,
          'arrears',
          'id',
          data.arrears.map((item) => ({ id: item.courseCode + '-' + item.semesterId, ...item }))
        );
      }
      if (data.circulars) {
        replaceRows(tx, 'circulars', 'id', data.circulars.map((item) => ({ id: item.id, ...item })));
      }
      if (data.curriculum) putRow(tx, 'curriculum', { id: 'current', ...data.curriculum });
      if (data.makeupExams) replaceRows(tx, 'makeupExams', 'id', data.makeupExams);
      if (data.refat) putRow(tx, 'refat', { id: 'current', ...data.refat });
      if (data.compre) putRow(tx, 'compre', { id: 'current', ...data.compre });
      if (data.payments) putRow(tx, 'payments', { id: 'current', ...data.payments });
      if (data.credentials) putRow(tx, 'credentials', { id: 'current', ...data.credentials });
      if (data.transport) putRow(tx, 'transport', { id: 'current', ...data.transport });
      if (data.sapInfo) putRow(tx, 'sapInfo', { id: 'current', ...data.sapInfo });
      if (data.paymentReceipts) putRow(tx, 'paymentReceipts', { id: 'current', ...data.paymentReceipts });
      if (data.bankInfo) putRow(tx, 'bankInfo', { id: 'current', ...data.bankInfo });
      if (data.biometric) putRow(tx, 'biometric', { id: 'current', ...data.biometric });
      if (data.proctorMessages) {
        replaceRows(
          tx,
          'proctorMessages',
          'id',
          data.proctorMessages.map((item, i) => ({ id: `${i}-${item.subject}`, ...item }))
        );
      }
      if (data.loginHistory) {
        replaceRows(
          tx,
          'loginHistory',
          'id',
          data.loginHistory.map((item, i) => ({ id: `${i}-${item.date}-${item.time}`, ...item }))
        );
      }
      if (data.classMessages) {
        replaceRows(
          tx,
          'classMessages',
          'id',
          data.classMessages.map((item, i) => ({ id: `${i}-${item.subject}`, ...item }))
        );
      }
      if (data.hodDean) putRow(tx, 'hodDean', { id: 'current', ...data.hodDean });
      if (data.wallet) putRow(tx, 'wallet', { id: 'current', ...data.wallet });
      if (data.extraCurricular) putRow(tx, 'extraCurricular', { id: 'current', ...data.extraCurricular });

      const meta: VtopSyncMetadata = {
        lastSyncedAt: opts?.syncedAt ?? Date.now(),
        syncSource: source,
        isOnline: navigator.onLine,
        selectedSemesterId: selectedSemesterId || '',
        registrationNo: registrationNo || data.profile?.registrationNo || '',
        marksDiag: (data as { marksDiag?: VtopSyncMetadata['marksDiag'] }).marksDiag || undefined,
      };
      putRow(tx, 'metadata', { id: 'current', ...meta });

      return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        // An aborted transaction fires `abort`, not `error`.
        tx.onabort = () => reject(tx.error || new Error('cache write aborted'));
      });
    } catch (e) {
      // Rethrown: a swallowed write let a sync report success with an empty
      // cache. `syncSemesterData` turns it into a dataset failure, never a
      // rejected VTOP login.
      console.warn('Failed to save VTOP data to IndexedDB:', e);
      throw e;
    }
  }

  async getAllData(): Promise<VtopCachedData | null> {
    try {
      const db = await this.dbPromise;
      const tx = db.transaction(openStores(db, VTOP_STORES), 'readonly');
      // Stores this database could not be read from. Recorded, never fatal:
      // one unreadable section must not blank the whole cache.
      const unreadable: string[] = [];

      const getAll = <T>(storeName: string): Promise<T[]> => {
        return new Promise((resolve) => {
          if (!db.objectStoreNames.contains(storeName)) {
            resolve([]);
            return;
          }
          try {
            const req = tx.objectStore(storeName).getAll();
            req.onsuccess = () => resolve(req.result as T[]);
            req.onerror = () => {
              unreadable.push(storeName);
              resolve([]);
            };
          } catch {
            // A transaction aborted by an earlier request throws here instead
            // of firing onerror — same meaning: unreadable, not empty.
            unreadable.push(storeName);
            resolve([]);
          }
        });
      };

      const profiles = await getAll<StudentProfile>('profile');
      const attendance = await getAll<AttendanceRecord>('attendance');
      const timetable = await getAll<TimetableSlot>('timetable');
      const marks = await getAll<CourseMarksRecord>('marks');
      const exams = await getAll<ExamRecord>('exams');
      const assignments = await getAll<AssignmentRecord>('assignments');
      const semesters = await getAll<SemesterInfo>('semesters');
      const gradesRows = await getAll<{ id: string } & GradeSummary>('grades');
      const gradeHistoryRows = await getAll<{ id: string } & GradeHistory>('gradeHistory');
      const semesterGradesRows = await getAll<{ id: string } & SemesterGrades>('semesterGrades');
      const odRows = await getAll<{ id: string } & OdSummary>('od');
      const calendarRows = await getAll<{ id: string } & AcademicCalendar>('calendar');
      const arrearsRows = await getAll<{ id: string } & ArrearRecord>('arrears');
      const circularsRows = await getAll<{ id: string } & CircularRecord>('circulars');
      const curriculumRows = await getAll<{ id: string } & CurriculumProgress>('curriculum');
      const makeupRows = await getAll<MakeupExamRecord>('makeupExams');
      const refatRows = await getAll<{ id: string } & RefatInfo>('refat');
      const compreRows = await getAll<{ id: string } & CompreInfo>('compre');
      const paymentsRows = await getAll<{ id: string } & PaymentsInfo>('payments');
      const credentialsRows = await getAll<{ id: string } & CredentialsInfo>('credentials');
      const transportRows = await getAll<{ id: string } & TransportInfo>('transport');
      const sapInfoRows = await getAll<{ id: string } & SapInfo>('sapInfo');
      const paymentReceiptsRows = await getAll<{ id: string } & PaymentReceiptsInfo>('paymentReceipts');
      const bankInfoRows = await getAll<{ id: string } & BankInfo>('bankInfo');
      const biometricRows = await getAll<{ id: string } & BiometricInfo>('biometric');
      const proctorMessagesRows = await getAll<{ id: string } & ProctorMessage>('proctorMessages');
      const loginHistoryRows = await getAll<{ id: string } & LoginHistoryRow>('loginHistory');
      const classMessagesRows = await getAll<{ id: string } & ClassMessage>('classMessages');
      const hodDeanRows = await getAll<{ id: string } & HodDeanInfo>('hodDean');
      const walletRows = await getAll<{ id: string } & WalletInfo>('wallet');
      const extraCurricularRows = await getAll<{ id: string } & ExtraCurricularInfo>('extraCurricular');
      const metas = await getAll<{ id: string } & VtopSyncMetadata>('metadata');
      this.lastCacheReadError = unreadable.length
        ? `${unreadable.join(', ')} could not be read from this device`
        : null;

      if (!profiles.length && !attendance.length) {
        return null;
      }

      const meta = metas[0] || {
        lastSyncedAt: Date.now() - 300000,
        syncSource: 'CACHED_INDEXEDDB' as const,
        isOnline: navigator.onLine,
        selectedSemesterId: '',
        registrationNo: '',
      };

      return {
        profile: profiles.find((profile) => !meta.registrationNo || profile.registrationNo === meta.registrationNo) || null,
        attendance,
        timetable,
        marks,
        exams,
        assignments,
        semesters,
        grades: gradesRows[0] || null,
        gradeHistory: gradeHistoryRows[0] || null,
        // Term-keyed on write, so it must be term-selected on read. Taking the
        // first row handed back whichever semester was synced first, which put
        // last term's grade card under this term's heading and never changed.
        semesterGrades: pickTermRow(semesterGradesRows, meta.selectedSemesterId),
        od: odRows[0] || null,
        calendar: calendarRows[0] || null,
        arrears: arrearsRows.map(({ id: _id, ...rest }) => rest),
        circulars: circularsRows.map((row) => ({ id: row.id, title: row.title, category: row.category, date: row.date })),
        curriculum: curriculumRows[0] || null,
        makeupExams: makeupRows,
        refat: refatRows[0] || null,
        compre: compreRows[0] || null,
        payments: paymentsRows[0] || null,
        credentials: credentialsRows[0] || null,
        transport: transportRows[0] || null,
        sapInfo: sapInfoRows[0] || null,
        paymentReceipts: paymentReceiptsRows[0] || null,
        bankInfo: bankInfoRows[0] || null,
        biometric: biometricRows[0] || null,
        proctorMessages: proctorMessagesRows.map(({ id: _id, ...rest }) => rest),
        loginHistory: loginHistoryRows.map(({ id: _id, ...rest }) => rest),
        classMessages: classMessagesRows.map(({ id: _id, ...rest }) => rest),
        hodDean: hodDeanRows[0] || null,
        wallet: walletRows[0] || null,
        extraCurricular: extraCurricularRows[0] || null,
        metadata: {
          lastSyncedAt: meta.lastSyncedAt,
          syncSource: meta.syncSource || 'CACHED_INDEXEDDB',
          isOnline: navigator.onLine,
          selectedSemesterId: meta.selectedSemesterId || '',
          registrationNo: meta.registrationNo || '',
          marksDiag: (meta as { marksDiag?: VtopSyncMetadata['marksDiag'] }).marksDiag || undefined,
        },
      };
    } catch (e) {
      console.warn('Failed to read from IndexedDB:', e);
      this.lastCacheReadError = e instanceof Error ? e.message : String(e);
      return null;
    }
  }

  async clear(): Promise<void> {
    const db = await this.dbPromise;
    const stores = Array.from(db.objectStoreNames);
    const tx = db.transaction(stores, 'readwrite');
    stores.forEach((store) => tx.objectStore(store).clear());
    // Await the commit so callers don't reload while old rows are still readable.
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  // Drop the per-student VTOP stores on account switch. Object-shaped datasets
  // (grades, bank info, wallet) are only overwritten when present, so a plain
  // save would leave the previous student's rows readable.
  async clearVtopStores(): Promise<void> {
    const db = await this.dbPromise;
    // Single-tenant: syllabus documents carry the owner's reg no in their key,
    // so they go with everything else on switch.
    const stores = openStores(db, [...VTOP_STORES, SYLLABUS_STORE, COURSE_PAGE_STORE]);
    const tx = db.transaction(stores, 'readwrite');
    stores.forEach((store) => tx.objectStore(store).clear());
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  // ------------------------------------------------------------------
  // LMS (Moodle) data
  // ------------------------------------------------------------------

  async saveLmsCourses(courses: LmsCourse[]): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction('lmsCourses', 'readwrite');
    const store = tx.objectStore('lmsCourses');
    store.clear();
    courses.forEach((c) => store.put(c));
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getLmsCourses(): Promise<LmsCourse[]> {
    return this.getAll<LmsCourse>('lmsCourses');
  }

  async saveLmsCourseData(courseId: number, data: {
    assignments?: LmsAssignment[];
    quizzes?: LmsQuizWindow[];
    gradebook?: LmsGradeItem[];
    materials?: LmsMaterial[];
    forum?: LmsForumPost[];
  }): Promise<void> {
    // Read old rows before opening the write transaction. IndexedDB
    // transactions become inactive across an await, so getAll() inside the
    // readwrite transaction failed with TransactionInactiveError.
    const [oldAssignments, oldQuizzes, oldMaterials] = await Promise.all([
      data.assignments ? this.getAll<LmsAssignment>('lmsAssignments') : Promise.resolve([] as LmsAssignment[]),
      data.quizzes ? this.getAll<LmsQuizWindow>('lmsQuizzes') : Promise.resolve([] as LmsQuizWindow[]),
      data.materials ? this.getAll<LmsMaterial>('lmsMaterials') : Promise.resolve([] as LmsMaterial[]),
    ]);
    const db = await this.dbPromise;
    const tx = db.transaction(['lmsAssignments', 'lmsQuizzes', 'lmsGradebook', 'lmsMaterials', 'lmsForum'], 'readwrite');

    if (data.assignments) {
      const store = tx.objectStore('lmsAssignments');
      // Remove this course's old rows, then write new ones.
      for (const a of oldAssignments) if (a.courseId === courseId) store.delete(a.assignmentId);
      data.assignments.forEach((a) => store.put({ ...a, courseId }));
    }
    if (data.quizzes) {
      const store = tx.objectStore('lmsQuizzes');
      for (const q of oldQuizzes) if (q.courseId === courseId) store.delete(q.quizId);
      data.quizzes.forEach((q) => store.put({ ...q, courseId }));
    }
    if (data.gradebook) {
      tx.objectStore('lmsGradebook').put({ courseId, items: data.gradebook });
    }
    if (data.materials) {
      const store = tx.objectStore('lmsMaterials');
      for (const m of oldMaterials) if (m.courseId === courseId) store.delete(m.materialId);
      data.materials.forEach((m) => store.put({ ...m, courseId }));
    }
    if (data.forum) {
      tx.objectStore('lmsForum').put({ courseId, posts: data.forum });
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getLmsCourseData(courseId: number): Promise<{
    assignments: LmsAssignment[];
    quizzes: LmsQuizWindow[];
    gradebook: LmsGradeItem[];
    materials: LmsMaterial[];
    forum: LmsForumPost[];
  } | null> {
    const db = await this.dbPromise;
    const tx = db.transaction(['lmsAssignments', 'lmsQuizzes', 'lmsGradebook', 'lmsMaterials', 'lmsForum'], 'readonly');

    const allAssignments = await new Promise<LmsAssignment[]>((resolve) => {
      const req = tx.objectStore('lmsAssignments').getAll();
      req.onsuccess = () => resolve(req.result as LmsAssignment[]);
    });
    const allQuizzes = await new Promise<LmsQuizWindow[]>((resolve) => {
      const req = tx.objectStore('lmsQuizzes').getAll();
      req.onsuccess = () => resolve(req.result as LmsQuizWindow[]);
    });
    const gradebook = await new Promise<{ courseId: number; items: LmsGradeItem[] } | undefined>((resolve) => {
      const req = tx.objectStore('lmsGradebook').get(courseId);
      req.onsuccess = () => resolve(req.result as { courseId: number; items: LmsGradeItem[] } | undefined);
    });
    const materials = await new Promise<LmsMaterial[]>((resolve) => {
      const req = tx.objectStore('lmsMaterials').getAll();
      req.onsuccess = () => resolve((req.result as LmsMaterial[]).filter((m) => m.courseId === courseId));
    });
    const forum = await new Promise<{ courseId: number; posts: LmsForumPost[] } | undefined>((resolve) => {
      const req = tx.objectStore('lmsForum').get(courseId);
      req.onsuccess = () => resolve(req.result as { courseId: number; posts: LmsForumPost[] } | undefined);
    });

    return {
      assignments: allAssignments.filter((a) => a.courseId === courseId),
      quizzes: allQuizzes.filter((q) => q.courseId === courseId),
      gradebook: gradebook?.items ?? [],
      materials,
      forum: forum?.posts ?? [],
    };
  }

  async getLmsAllQuizzes(): Promise<LmsQuizWindow[]> {
    return this.getAll<LmsQuizWindow>('lmsQuizzes');
  }

  async saveLmsCalendar(events: LmsCalendarEvent[]): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction('lmsCalendar', 'readwrite');
    const store = tx.objectStore('lmsCalendar');
    store.clear();
    events.forEach((e) => store.put({ id: e.eventId || e.name + e.date, ...e }));
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getLmsCalendar(): Promise<LmsCalendarEvent[]> {
    const rows = await this.getAll<{ id: string } & LmsCalendarEvent>('lmsCalendar');
    return rows.map(({ id: _id, ...rest }) => rest);
  }

  async saveLmsMetadata(meta: LmsSyncMetadata): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction('lmsMetadata', 'readwrite');
    tx.objectStore('lmsMetadata').put({ id: 'current', ...meta });
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getLmsMetadata(): Promise<LmsSyncMetadata | null> {
    const rows = await this.getAll<{ id: string } & LmsSyncMetadata>('lmsMetadata');
    return rows[0] ? {
      lastSyncedAt: rows[0].lastSyncedAt || 0,
      lastAttemptedAt: rows[0].lastAttemptedAt,
      lastSyncStatus: rows[0].lastSyncStatus,
      usernameHint: rows[0].usernameHint || '',
      coursesSynced: rows[0].coursesSynced || 0,
    } : null;
  }

  // Quiz notification dedupe records
  async putQuizNotifications(records: QuizNotificationRecord[]): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction('quizNotifications', 'readwrite');
    const store = tx.objectStore('quizNotifications');
    records.forEach((r) => store.put(r));
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getQuizNotifications(): Promise<QuizNotificationRecord[]> {
    return this.getAll<QuizNotificationRecord>('quizNotifications');
  }

  // Offline material cache
  async putCachedMaterial(record: CachedMaterial): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction('materialCache', 'readwrite');
    tx.objectStore('materialCache').put(record);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getCachedMaterials(): Promise<CachedMaterial[]> {
    return this.getAll<CachedMaterial>('materialCache');
  }

  async deleteCachedMaterial(materialId: number): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction('materialCache', 'readwrite');
    tx.objectStore('materialCache').delete(materialId);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ------------------------------------------------------------------
  // VTOP Course Page syllabus — one entry per student + course + semester
  // ------------------------------------------------------------------

  // Cache one syllabus outcome. The key carries the registration number, course
  // and semester, so a document cannot be read back under another profile. A
  // database that predates v13 has nowhere to put it — a cache miss, not an error.
  async putSyllabus(record: SyllabusCacheEntry): Promise<void> {
    const db = await this.dbPromise;
    if (!db.objectStoreNames.contains(SYLLABUS_STORE)) return;
    const tx = db.transaction(SYLLABUS_STORE, 'readwrite');
    tx.objectStore(SYLLABUS_STORE).put(record);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getSyllabus(cacheKey: string): Promise<SyllabusCacheEntry | null> {
    const db = await this.dbPromise;
    if (!db.objectStoreNames.contains(SYLLABUS_STORE)) return null;
    return new Promise((resolve) => {
      const tx = db.transaction(SYLLABUS_STORE, 'readonly');
      const req = tx.objectStore(SYLLABUS_STORE).get(cacheKey);
      req.onsuccess = () => resolve((req.result as SyllabusCacheEntry | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
  }

  /** Keys currently cached — used to drop a course's entry before a refetch. */
  async getSyllabusKeys(): Promise<string[]> {
    const db = await this.dbPromise;
    if (!db.objectStoreNames.contains(SYLLABUS_STORE)) return [];
    return new Promise((resolve) => {
      const tx = db.transaction(SYLLABUS_STORE, 'readonly');
      const req = tx.objectStore(SYLLABUS_STORE).getAllKeys();
      req.onsuccess = () => resolve((req.result as IDBValidKey[]).map(String));
      req.onerror = () => resolve([]);
    });
  }

  async deleteSyllabus(cacheKey: string): Promise<void> {
    const db = await this.dbPromise;
    if (!db.objectStoreNames.contains(SYLLABUS_STORE)) return;
    const tx = db.transaction(SYLLABUS_STORE, 'readwrite');
    tx.objectStore(SYLLABUS_STORE).delete(cacheKey);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ------------------------------------------------------------------
  // VTOP Course Page registered-class listing — one entry per semester
  // ------------------------------------------------------------------

  // Cache VTOP's Course Page listing for one student and semester. A database
  // that predates v14 has nowhere to put it — a cache miss, not an error.
  // Nothing calls this pair any more (see the DB_VERSION note).
  async putCoursePageClasses(record: CoursePageCacheEntry): Promise<void> {
    const db = await this.dbPromise;
    if (!db.objectStoreNames.contains(COURSE_PAGE_STORE)) return;
    const tx = db.transaction(COURSE_PAGE_STORE, 'readwrite');
    tx.objectStore(COURSE_PAGE_STORE).put(record);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getCoursePageClasses(cacheKey: string): Promise<CoursePageCacheEntry | null> {
    const db = await this.dbPromise;
    if (!db.objectStoreNames.contains(COURSE_PAGE_STORE)) return null;
    return new Promise((resolve) => {
      const tx = db.transaction(COURSE_PAGE_STORE, 'readonly');
      const req = tx.objectStore(COURSE_PAGE_STORE).get(cacheKey);
      req.onsuccess = () => resolve((req.result as CoursePageCacheEntry | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
  }

  async clearLmsData(): Promise<void> {
    const db = await this.dbPromise;
    const stores = ['lmsCourses', 'lmsAssignments', 'lmsQuizzes', 'lmsGradebook', 'lmsMaterials', 'lmsForum', 'lmsCalendar', 'lmsMetadata', 'quizNotifications', 'materialCache'];
    const tx = db.transaction(stores, 'readwrite');
    stores.forEach((s) => tx.objectStore(s).clear());
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  private async getAll<T>(storeName: string): Promise<T[]> {
    const db = await this.dbPromise;
    if (!db.objectStoreNames.contains(storeName)) return [];
    return new Promise((resolve) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result as T[]);
      req.onerror = () => resolve([]);
    });
  }
}

export const vtopDb = new VtopLocalDatabase();

export function formatRelativeTime(timestamp: number): string {
  if (!timestamp) return 'Never synced';
  const diffMs = Date.now() - timestamp;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
}
