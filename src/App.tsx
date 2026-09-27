import React, { Suspense, lazy, useState, useEffect, useCallback, useRef } from 'react';
import { AlertCircle, WifiOff } from 'lucide-react';
import { fresherGuideTerms } from './data/fresherGuideData';
import { MeridianHeader } from './components/MeridianHeader';
import { MeridianDashboard } from './components/MeridianDashboard';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastContainer } from './components/ToastContainer';
import { PwaStatusBar } from './components/PwaStatusBar';
import { SyncStatusPanel } from './components/SyncStatusPanel';
import { Bed } from 'lucide-react';
import { UltraCCLogo } from './components/UltraCCLogo';
import { FirstRunLanding } from './components/FirstRunLanding';
import { vtopDb } from './lib/db/vtopDatabase';
import { StudentProfile, AttendanceRecord, TimetableSlot, CourseMarksRecord, ExamRecord, AssignmentRecord, GradeSummary, GradeHistory, SemesterGrades, OdSummary, SemesterInfo, AcademicCalendar, ArrearRecord, CircularRecord, CurriculumProgress, MakeupExamRecord, RefatInfo, CompreInfo, PaymentsInfo, CredentialsInfo, TransportInfo, SapInfo, PaymentReceiptsInfo, BankInfo, BiometricInfo, ProctorMessage, LoginHistoryRow, ClassMessage, HodDeanInfo, WalletInfo, ExtraCurricularInfo } from './lib/vtop/types';
import { toUiProfile, toUiAttendance, toUiTimetable, toUiMarks, toUiExams, toUiAssignments } from './lib/vtop/adapters';
import { hadLiveSessionThisTab, isLiveSessionActive, resetLiveClient } from './lib/vtop/liveSession';
import {
  getSyncCoordinatorState,
  subscribeSyncCoordinator,
  seedSyncCoordinator,
  markSyncedAt,
  maybeAutoRefresh,
  refreshVtopData,
  resetSyncCoordinator,
  type SyncCoordinatorState,
} from './lib/vtop/syncCoordinator';
import { humanErrorCopy } from './lib/errorCopy';
import { applySavedAccent, applySavedTheme, clearSavedLmsCredentials, getSavedCredentials, getSavedLmsCredentials, getFeatureMode } from './lib/settings';
import { type FeatureMode } from './lib/navVisibility';
import { LMS_NEEDS_CREDENTIALS, resetLmsClient, runFullLmsSync } from './lib/lms/lmsClient';
import { evaluateQuizNotifications, startQuizNotificationWatcher } from './lib/lms/notifications';
import { toastInfo, toastSuccess, toastSync } from './lib/toast';
import { useBackgroundPush } from './hooks/useBackgroundPush';
import {
  LmsCourse, LmsAssignment, LmsQuizWindow, LmsGradeItem,
  LmsMaterial, LmsForumPost,
} from './lib/lms/types';

// Keep the dashboard and login shell in the initial chunk. Screens and
// optional dialogs are fetched only when the user opens them, which avoids
// downloading charts, maps, planners, and secondary feature code at start.
const AcademicsView = lazy(() => import('./components/AcademicsView').then((m) => ({ default: m.AcademicsView })));
const FacultyView = lazy(() => import('./components/FacultyView').then((m) => ({ default: m.FacultyView })));
const TimetableView = lazy(() => import('./components/TimetableView').then((m) => ({ default: m.TimetableView })));
const ExamsView = lazy(() => import('./components/ExamsView').then((m) => ({ default: m.ExamsView })));
const CourseIntelView = lazy(() => import('./components/CourseIntelView').then((m) => ({ default: m.CourseIntelView })));
const AcademicCalendarView = lazy(() => import('./components/AcademicCalendarView').then((m) => ({ default: m.AcademicCalendarView })));
const CampusMapView = lazy(() => import('./components/CampusMapView').then((m) => ({ default: m.CampusMapView })));
const CampusUtilitiesView = lazy(() => import('./components/CampusUtilitiesView').then((m) => ({ default: m.CampusUtilitiesView })));
const FresherGuideView = lazy(() => import('./components/FresherGuideView').then((m) => ({ default: m.FresherGuideView })));
const PlacementPortalView = lazy(() => import('./components/PlacementPortalView').then((m) => ({ default: m.PlacementPortalView })));
const AiAdvisorView = lazy(() => import('./components/AiAdvisorView').then((m) => ({ default: m.AiAdvisorView })));
const LmsView = lazy(() => import('./components/LmsView').then((m) => ({ default: m.LmsView })));
const GradesView = lazy(() => import('./components/GradesView').then((m) => ({ default: m.GradesView })));
const CourseHubView = lazy(() => import('./components/CourseHubView').then((m) => ({ default: m.CourseHubView })));
const MyInfoView = lazy(() => import('./components/MyInfoView').then((m) => ({ default: m.MyInfoView })));
const TransportView = lazy(() => import('./components/TransportView').then((m) => ({ default: m.TransportView })));
const EventHubView = lazy(() => import('./components/EventHubView').then((m) => ({ default: m.EventHubView })));
const CabShareView = lazy(() => import('./components/CabShareView').then((m) => ({ default: m.CabShareView })));
const QbankView = lazy(() => import('./components/QbankView').then((m) => ({ default: m.QbankView })));
const FfcsPlannerView = lazy(() => import('./components/FfcsPlannerView').then((m) => ({ default: m.FfcsPlannerView })));
const FacultyDirectoryView = lazy(() => import('./components/FacultyDirectoryView').then((m) => ({ default: m.FacultyDirectoryView })));
const FreeClassroomsView = lazy(() => import('./components/FreeClassroomsView').then((m) => ({ default: m.FreeClassroomsView })));
const HostelSubTabs = lazy(() => import('./components/HostelSubTabs').then((m) => ({ default: m.HostelSubTabs })));
const LibraryView = lazy(() => import('./components/LibraryView').then((m) => ({ default: m.LibraryView })));
const SocialTab = lazy(() => import('./components/SocialTab').then((m) => ({ default: m.SocialTab })));
const ToolsHub = lazy(() => import('./components/ToolsHub').then((m) => ({ default: m.ToolsHub })));
const SyllabusView = lazy(() => import('./components/SyllabusView').then((m) => ({ default: m.SyllabusView })));
const ClubHub = lazy(() => import('./components/ClubHub').then((m) => ({ default: m.ClubHub })));
const CommandCenterModal = lazy(() => import('./components/CommandCenterModal').then((m) => ({ default: m.CommandCenterModal })));
const ExtensionSyncModal = lazy(() => import('./components/ExtensionSyncModal').then((m) => ({ default: m.ExtensionSyncModal })));
const SettingsModal = lazy(() => import('./components/SettingsModal').then((m) => ({ default: m.SettingsModal })));

function RouteLoadingState() {
  return <div className="ultracc-route-loading" role="status" aria-live="polite"><span className="ultracc-route-loading-mark" aria-hidden="true" /><span>Loading UltraCC</span></div>;
}

function RouteUnavailableState({ route, onLogin }: { route: string; onLogin: () => void }) {
  const labels: Record<string, string> = {
    academics: 'attendance and academic records',
    grades: 'marks and grades',
    timetable: 'your timetable',
    syllabus: 'your courses and VTOP’s own syllabus files',
    exams: 'your examination schedule',
    lms: 'LMS assignments and courses',
    faculty: 'faculty information',
    calendar: 'the academic calendar',
    freeClassrooms: 'room and lab availability',
    transport: 'bus routes and day-scholar info',
    'my-info': 'your profile, fees and credentials',
    'ai-advisor': 'your synced academic records',
    placement: 'your CGPA and eligibility picture',
  };
  return <section className="ultracc-route-unavailable" aria-live="polite">
    <div className="ultracc-route-unavailable-icon" aria-hidden="true"><AlertCircle size={20} /></div>
    <div><p className="portal-eyebrow">{route.replace('-', ' ')}</p><h2>Connect VTOP to continue</h2><p>Sign in to load {labels[route] || 'this student service'} from your authoritative campus data.</p></div>
    <button className="portal-primary-button" onClick={onLogin}>Login with VTOP <span aria-hidden="true">→</span></button>
  </section>;
}

/** Valid tabs the app can navigate to (used for ?tab= deep links + persistence). */
const VALID_TABS = new Set([
  'dashboard', 'academics', 'grades', 'timetable', 'syllabus', 'calendar', 'ffcs', 'ai-advisor',
  'exams', 'lms', 'campus', 'campus-utils', 'freeClassrooms', 'transport', 'library',
  'events', 'hostel', 'faculty', 'directory', 'my-info', 'social', 'cabshare', 'tools',
  'placement', 'clubs', 'qbank', 'fresher',
]);

/**
 * Tabs whose views are built from synced VTOP data. Signed out they show the
 * "connect VTOP" wall and nothing else. Tabs outside this set have their own
 * source or accept pasted data, so they keep working without a VTOP session.
 */
const VTOP_DATA_TABS = new Set([
  'academics', 'grades', 'timetable', 'syllabus', 'exams', 'faculty', 'calendar',
  'freeClassrooms', 'transport', 'my-info', 'ai-advisor', 'placement',
]);
/** Of those, the screens that read the cached profile record itself. */
const PROFILE_TABS = new Set(['my-info', 'ai-advisor', 'placement', 'faculty']);

/** Initial tab from the URL (?tab= from PWA shortcuts), else the last visited
 *  tab (session persistence), else the dashboard. */
function initialTab(): string {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('tab');
    if (fromUrl && VALID_TABS.has(fromUrl)) return fromUrl;
    const saved = sessionStorage.getItem('ultracc:activeTab');
    if (saved && VALID_TABS.has(saved)) return saved;
  } catch { /* storage unavailable */ }
  return 'dashboard';
}

export default function App() {
  const [activeTab, setActiveTab] = useState<string>(initialTab);
  const [isCommandCenterOpen, setIsCommandCenterOpen] = useState<boolean>(false);
  const [isLoginOpen, setIsLoginOpen] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [featureMode, setFeatureMode] = useState<FeatureMode>(getFeatureMode);
  const [campusSearchQuery, setCampusSearchQuery] = useState<string>('');

  const [student, setStudent] = useState<StudentProfile | null>(null);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [timetable, setTimetable] = useState<TimetableSlot[]>([]);
  const [marks, setMarks] = useState<CourseMarksRecord[]>([]);
  const [exams, setExams] = useState<ExamRecord[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRecord[]>([]);
  const [grades, setGrades] = useState<GradeSummary | null>(null);
  const [gradeHistory, setGradeHistory] = useState<GradeHistory | null>(null);
  const [semesterGrades, setSemesterGrades] = useState<SemesterGrades | null>(null);
  const [od, setOd] = useState<OdSummary | null>(null);
  const [calendar, setCalendar] = useState<AcademicCalendar | null>(null);
  const [arrears, setArrears] = useState<ArrearRecord[]>([]);
  const [circulars, setCirculars] = useState<CircularRecord[]>([]);
  const [curriculum, setCurriculum] = useState<CurriculumProgress | null>(null);
  const [makeupExams, setMakeupExams] = useState<MakeupExamRecord[]>([]);
  const [refat, setRefat] = useState<RefatInfo | null>(null);
  const [compre, setCompre] = useState<CompreInfo | null>(null);
  const [payments, setPayments] = useState<PaymentsInfo | null>(null);
  const [credentials, setCredentials] = useState<CredentialsInfo | null>(null);
  const [transport, setTransport] = useState<TransportInfo | null>(null);
  const [sapInfo, setSapInfo] = useState<SapInfo | null>(null);
  const [paymentReceipts, setPaymentReceipts] = useState<PaymentReceiptsInfo | null>(null);
  const [bankInfo, setBankInfo] = useState<BankInfo | null>(null);
  const [biometric, setBiometric] = useState<BiometricInfo | null>(null);
  const [proctorMessages, setProctorMessages] = useState<ProctorMessage[]>([]);
  const [loginHistory, setLoginHistory] = useState<LoginHistoryRow[]>([]);
  const [classMessages, setClassMessages] = useState<ClassMessage[]>([]);
  const [hodDean, setHodDean] = useState<HodDeanInfo | null>(null);
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [extraCurricular, setExtraCurricular] = useState<ExtraCurricularInfo | null>(null);
  const [semesters, setSemesters] = useState<SemesterInfo[]>([]);
  const [selectedSemesterId, setSelectedSemesterId] = useState<string>('');
  const [semesterSwitching, setSemesterSwitching] = useState(false);
  const [semesterSyncError, setSemesterSyncError] = useState<string | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<number | null>(null);
  const [hasSyncedData, setHasSyncedData] = useState<boolean>(false);
  /** Set when IndexedDB itself failed to read — distinct from "nothing synced yet". */
  const [cacheReadError, setCacheReadError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [isLoaded, setIsLoaded] = useState(false);

  const [hostelTab, setHostelTab] = useState<'mess' | 'leave' | 'laundry' | 'counselling'>('mess');

  const [lmsCourses, setLmsCourses] = useState<LmsCourse[]>([]);
  const [lmsAssignments, setLmsAssignments] = useState<LmsAssignment[]>([]);
  const [lmsQuizzes, setLmsQuizzes] = useState<LmsQuizWindow[]>([]);
  const [lmsGradebook, setLmsGradebook] = useState<{ courseId: number; items: LmsGradeItem[] }[]>([]);
  const [lmsMaterials, setLmsMaterials] = useState<LmsMaterial[]>([]);
  const [lmsForum, setLmsForum] = useState<{ courseId: number; posts: LmsForumPost[] }[]>([]);
  const [syncState, setSyncState] = useState<SyncCoordinatorState>(getSyncCoordinatorState());
  const [lmsSyncing, setLmsSyncing] = useState(false);
  const [lmsSyncMessage, setLmsSyncMessage] = useState<string | null>(null);
  const [lmsSyncErrors, setLmsSyncErrors] = useState<{ label: string; error: string }[]>([]);
  const [lmsLastSynced, setLmsLastSynced] = useState<number | null>(null);
  const [lmsNeedsAttention, setLmsNeedsAttention] = useState(false);
  const lmsSyncInFlight = useRef(false);
  const refreshInFlight = useRef(false);
  const mainRef = useRef<HTMLElement | null>(null);
  // Course Hub drill-down: { code, title } when open.
  const [hubCourse, setHubCourse] = useState<{ code: string; title: string } | null>(null);

  /**
   * Background notifications (Web Push): the device plans, the server delivers.
   * One owner for the lifecycle — while the app is open the in-app pipeline in
   * NotificationBell handles delivery, and the server covers a closed browser.
   */
  const backgroundPush = useBackgroundPush({ timetable, quizzes: lmsQuizzes });

  useEffect(() => {
    applySavedAccent();
    applySavedTheme();
  }, []);

  /** Every tab change: persist for PWA relaunch, keep the shareable ?tab= deep
   *  link in sync, and scroll to top (mobile). */
  useEffect(() => {
    try { sessionStorage.setItem('ultracc:activeTab', activeTab); } catch { /* ignore */ }
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get('tab') !== activeTab) {
        url.searchParams.set('tab', activeTab);
        // replaceState, not pushState: refresh and share land on the current
        // view, while Back keeps walking the app's real history.
        window.history.replaceState({}, '', url.toString());
      }
    } catch { /* storage-less web views */ }
    mainRef.current?.scrollTo?.({ top: 0 });
    window.scrollTo?.({ top: 0 });
  }, [activeTab]);

  /** Browser Back/Forward between ?tab= URLs (PWA shortcuts, shared links). */
  useEffect(() => {
    const onPopState = () => {
      try {
        const tab = new URLSearchParams(window.location.search).get('tab');
        if (tab && VALID_TABS.has(tab)) setActiveTab(tab);
      } catch { /* ignore */ }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const loadLocalVtopData = useCallback(async () => {
    const cached = await vtopDb.getAllData();
    setCacheReadError(vtopDb.lastCacheReadError);
    // Demo mode is gone — any leftover synthetic cache is stale and must not
    // masquerade as real synced data.
    if (cached?.metadata?.syncSource === 'DEMO_MODE') {
      await vtopDb.clear();
      setHasSyncedData(false);
      setIsLoaded(true);
      return;
    }
    if (cached && (cached.attendance.length > 0 || cached.profile)) {
      // `cached.transport` only supplies the programme/branch VTOP states on
      // its own registration record; the profile page leaves them blank.
      if (cached.profile) setStudent(toUiProfile(cached.profile, cached.grades, cached.transport));
      if (cached.attendance.length) setAttendance(toUiAttendance(cached.attendance, cached.timetable));
      if (cached.timetable.length) setTimetable(toUiTimetable(cached.timetable));
      if (cached.marks.length) setMarks(toUiMarks(cached.marks));
      if (cached.exams.length) setExams(toUiExams(cached.exams));
      if (cached.assignments && cached.assignments.length) setAssignments(toUiAssignments(cached.assignments));
      setGrades(cached.grades || null);
      setGradeHistory(cached.gradeHistory || null);
      setSemesterGrades(cached.semesterGrades || null);
      setOd(cached.od || null);
      setCalendar(cached.calendar || null);
      setArrears(cached.arrears || []);
      setCirculars(cached.circulars || []);
      setCurriculum(cached.curriculum || null);
      setMakeupExams(cached.makeupExams || []);
      setRefat(cached.refat || null);
      setCompre(cached.compre || null);
      setPayments(cached.payments || null);
      setCredentials(cached.credentials || null);
      setTransport(cached.transport || null);
      setSapInfo(cached.sapInfo || null);
      setPaymentReceipts(cached.paymentReceipts || null);
      setBankInfo(cached.bankInfo || null);
      setBiometric(cached.biometric || null);
      setProctorMessages(cached.proctorMessages || []);
      setLoginHistory(cached.loginHistory || []);
      setClassMessages(cached.classMessages || []);
      setHodDean(cached.hodDean || null);
      setWallet(cached.wallet || null);
      setExtraCurricular(cached.extraCurricular || null);
      if (cached.semesters && cached.semesters.length) setSemesters(cached.semesters);
      setSelectedSemesterId(cached.metadata?.selectedSemesterId || '');
      if (cached.metadata?.lastSyncedAt) setLastSyncTime(cached.metadata.lastSyncedAt);
      setHasSyncedData(true);
    } else {
      setHasSyncedData(false);
    }
    setIsLoaded(true);
  }, []);

  /** Load cached LMS data from IndexedDB (offline-first). */
  const loadLocalLmsData = useCallback(async () => {
    const [courses, allQuizzes] = await Promise.all([
      vtopDb.getLmsCourses(),
      vtopDb.getLmsAllQuizzes(),
    ]);
    const assignments: LmsAssignment[] = [];
    const materials: LmsMaterial[] = [];
    const gradebook: { courseId: number; items: LmsGradeItem[] }[] = [];
    const forum: { courseId: number; posts: LmsForumPost[] }[] = [];
    for (const c of courses) {
      const data = await vtopDb.getLmsCourseData(c.courseId);
      if (data) {
        assignments.push(...data.assignments);
        materials.push(...data.materials);
        if (data.gradebook.length) gradebook.push({ courseId: c.courseId, items: data.gradebook });
        if (data.forum.length) forum.push({ courseId: c.courseId, posts: data.forum });
      }
    }
    setLmsCourses(courses);
    setLmsAssignments(assignments);
    setLmsQuizzes(allQuizzes);
    setLmsGradebook(gradebook);
    setLmsMaterials(materials);
    setLmsForum(forum);
    const meta = await vtopDb.getLmsMetadata();
    if (meta?.lastSyncedAt) setLmsLastSynced(meta.lastSyncedAt);
    if (meta) setLmsNeedsAttention(meta.lastSyncStatus === 'failed' || meta.lastSyncStatus === 'partial');
  }, []);

  /** LMS sync — from Settings → LMS Account → Sync Now, or auto after VTOP login. */
  const handleLmsSync = useCallback(async (): Promise<{ ok: boolean; message: string }> => {
    if (lmsSyncInFlight.current) {
      return { ok: false, message: 'LMS sync is already in progress.' };
    }
    const creds = getSavedLmsCredentials();
    if (!creds.username || !creds.password) {
      // The LMS panel keys its badge off this exact constant.
      setLmsSyncMessage(LMS_NEEDS_CREDENTIALS);
      setLmsNeedsAttention(true);
      return { ok: false, message: LMS_NEEDS_CREDENTIALS };
    }
    lmsSyncInFlight.current = true;
    setLmsSyncing(true);
    setLmsSyncErrors([]);
    setLmsNeedsAttention(false);
    toastSync('lms-sync', 'Refreshing LMS data…');
    try {
      const result = await runFullLmsSync(creds.username, creds.password);
      setLmsSyncErrors(result.failed);
      await loadLocalLmsData();
      const quizzes = await vtopDb.getLmsAllQuizzes();
      await evaluateQuizNotifications(quizzes);
      setLmsSyncMessage(result.message);
      setLmsNeedsAttention(!result.ok);
      if (result.ok) {
        toastSync('lms-sync', 'LMS data refreshed ✓', { complete: true });
      } else {
        toastSync('lms-sync', 'LMS refresh needs attention', {
          error: true,
          detail: result.message,
        });
      }
      return { ok: result.ok, message: result.message };
    } catch (e) {
      const msg = `LMS sync failed: ${humanErrorCopy(e, 'Moodle could not be reached. Check your LMS credentials or connection.')}`;
      setLmsSyncMessage(msg);
      setLmsNeedsAttention(true);
      toastSync('lms-sync', 'LMS refresh failed', { error: true, detail: msg });
      return { ok: false, message: msg };
    } finally {
      lmsSyncInFlight.current = false;
      setLmsSyncing(false);
    }
  }, [loadLocalLmsData]);

  /** Refresh all configured sources while keeping the current cached UI mounted. */
  const handleRefresh = useCallback(async (): Promise<boolean> => {
    if (refreshInFlight.current) return false;
    if (!isOnline) {
      toastInfo('Offline — showing your last synced data', { duration: 3000 });
      return false;
    }

    // VTOP session tokens intentionally live only in memory. Saved settings
    // credentials can prefill the login modal, but they are not a session by
    // themselves and must not be silently replayed without the CAPTCHA flow.
    if (!isLiveSessionActive()) {
      const savedVtop = getSavedCredentials();
      setIsLoginOpen(true);
      /*
       * Two different facts, and the old copy claimed the wrong one after every
       * ordinary reload: "your session expired" describes a session VTOP ended,
       * while a reload simply means this tab never signed in (brief §5 — a
       * normal reload must not report an expired session). `hadLiveSessionThisTab`
       * is the only way to tell them apart, and it is memory-only like the token.
       */
      const everSignedInHere = hadLiveSessionThisTab();
      toastInfo(
        savedVtop.regNo && savedVtop.password
          ? everSignedInHere
            ? 'VTOP session expired — your saved credentials are ready. Sign in to refresh.'
            : 'This tab is not signed in to VTOP — your saved credentials are ready. Sign in to refresh.'
          : 'Sign in to VTOP to refresh your academic data.',
        { duration: 5000 },
      );
      return false;
    }

    refreshInFlight.current = true;
    try {
      await refreshVtopData({
        reason: 'manual',
        force: true,
        onData: () => loadLocalVtopData(),
      });

      const creds = getSavedLmsCredentials();
      const lmsConfigured = Boolean(creds.username && creds.password);
      let lmsOk = true;
      if (lmsConfigured) {
        const lmsResult = await handleLmsSync();
        lmsOk = lmsResult.ok;
      }

      const vtopState = getSyncCoordinatorState();
      const vtopNeedsAttention = vtopState.status === 'partial' || vtopState.status === 'error';
      if (vtopNeedsAttention || !lmsOk) {
        toastInfo('Some data could not be updated', {
          detail: 'Your previously saved data is still there.',
          duration: 5000,
        });
        return false;
      }
      toastSuccess('Data refreshed', { duration: 3000 });
      return true;
    } finally {
      refreshInFlight.current = false;
    }
  }, [handleLmsSync, isOnline, loadLocalVtopData]);

  // NO scroll-gesture refresh on mobile, by decision (production bug: a fast
  // downward flick at the top of a page travelled past the pull threshold and
  // ran handleRefresh, which opens the login modal when this tab has no live
  // VTOP session — so ordinary scrolling looked like "the app refreshed itself
  // and signed me out"). Refreshing is an explicit act: the header's
  // "Sync and refresh" button and the per-view refresh buttons call
  // handleRefresh. Native overscroll refresh is pinned off in index.css
  // (`overscroll-behavior-y: none` on html/body). See
  // src/utils/__tests__/mobileScrollRefresh.test.ts for the regression guard.

  // Offline-first: cached data is always displayed; banner shows the state.
  // Also seeds the sync coordinator and triggers a background auto-refresh
  // when a live session exists and the cached data is stale.
  useEffect(() => {
    const onOnline = () => {
      setIsOnline(true);
      // Connection restored — refresh stale data automatically.
      void maybeAutoRefresh({ reason: 'reconnect', onData: () => loadLocalVtopData() });
    };
    const onOffline = () => setIsOnline(false);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        // Returning to the app — refresh only if stale (cooldown-guarded).
        void maybeAutoRefresh({ reason: 'focus', onData: () => loadLocalVtopData() });
      }
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisibility);

    const run = async () => {
      const cached = await vtopDb.getAllData();
      seedSyncCoordinator(cached?.metadata?.lastSyncedAt ?? null);
      setSyncState(getSyncCoordinatorState());
      await loadLocalVtopData();
      await loadLocalLmsData();
      // Startup: background refresh when a live session is in memory and the
      // cached data is stale — cached data stays on screen the whole time.
      void maybeAutoRefresh({ reason: 'startup', onData: () => loadLocalVtopData() });
    };
    void run();

    const unsubscribe = subscribeSyncCoordinator((s) => setSyncState(s));
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisibility);
      unsubscribe();
    };
  }, [loadLocalVtopData, loadLocalLmsData]);

  // Quiz-window notification watcher (30s polling while the app is open).
  useEffect(() => {
    const stop = startQuizNotificationWatcher(() => lmsQuizzes);
    evaluateQuizNotifications(lmsQuizzes).catch(() => { /* best effort */ });
    return stop;
  }, [lmsQuizzes]);

  /**
   * Every VTOP-backed piece of UI state, reset in one place. The old partial
   * reset left the previous student's bank info, wallet, payments and login
   * history on screen after 'Clear all data' or an account switch.
   */
  const resetAllVtopState = useCallback(() => {
    setStudent(null);
    setAttendance([]);
    setTimetable([]);
    setMarks([]);
    setExams([]);
    setAssignments([]);
    setGrades(null);
    setGradeHistory(null);
    setSemesterGrades(null);
    setOd(null);
    setCalendar(null);
    setArrears([]);
    setCirculars([]);
    setCurriculum(null);
    setMakeupExams([]);
    setRefat(null);
    setCompre(null);
    setPayments(null);
    setCredentials(null);
    setTransport(null);
    setSapInfo(null);
    setPaymentReceipts(null);
    setBankInfo(null);
    setBiometric(null);
    setProctorMessages([]);
    setLoginHistory([]);
    setClassMessages([]);
    setHodDean(null);
    setWallet(null);
    setExtraCurricular(null);
    setSemesters([]);
    setSelectedSemesterId('');
    setLastSyncTime(null);
    setHasSyncedData(false);
    setCacheReadError(null);
    setSemesterSyncError(null);
    setHubCourse(null);
    setLmsCourses([]);
    setLmsAssignments([]);
    setLmsQuizzes([]);
    setLmsGradebook([]);
    setLmsMaterials([]);
    setLmsForum([]);
    setLmsSyncMessage(null);
    setLmsSyncErrors([]);
    setLmsLastSynced(null);
    setLmsNeedsAttention(false);
  }, []);

  const handleClearAllData = async () => {
    resetLiveClient();
    resetLmsClient();
    clearSavedLmsCredentials();
    resetSyncCoordinator();
    try {
      await vtopDb.clear();
    } catch (e) {
      toastInfo(`Cached data could not be deleted: ${humanErrorCopy(e, 'the browser refused to clear it')}. Try again, or clear site data from browser settings.`, { duration: 6000 });
    }
    resetAllVtopState();
  };

  // Active semester label from the saved selection (never "Semester 0")
  const activeSemesterLabel = semesters.find((s) => s.id === selectedSemesterId)?.name || '';

  // First run: no data has ever been synced. The whole chrome (rail, header,
  // tab bar, service grid) is withdrawn and replaced by the onboarding landing —
  // a brand-new student should see only login, semester and mode, nothing else.
  const isFirstRun = isLoaded && !hasSyncedData;


  /** Faculty for a course from the synced timetable (VTOP real data). */
  const facultyForCourse = (code: string): string | undefined =>
    timetable.find((t) => t.courseCode === code && t.facultyName && t.facultyName !== '—')?.facultyName || undefined;

  /** LMS bundle for a course, matched by course code inside the course name. */
  const lmsDataForCourse = (code: string) => {
    const course = lmsCourses.find((c) => c.name.toUpperCase().includes(code));
    if (!course) return null;
    const data = lmsGradebook.find((g) => g.courseId === course.courseId);
    return {
      assignments: lmsAssignments.filter((a) => a.courseId === course.courseId),
      quizzes: lmsQuizzes.filter((q) => q.courseId === course.courseId),
      gradebook: data?.items || [],
      materials: lmsMaterials.filter((m) => m.courseId === course.courseId),
      forum: lmsForum.find((f) => f.courseId === course.courseId)?.posts || [],
    };
  };

  const handleNavigateMap = (buildingQuery: string) => {
    setCampusSearchQuery(buildingQuery);
    setActiveTab('campus');
  };

  /**
   * Course hub → Syllabus tab for one course. The ?course= param is the only
   * way to say "this one": SyllabusView opens and consults VTOP for it once on
   * mount, which also makes the link shareable and Back-friendly. It is written
   * here because the tab-change effect only ever replaces ?tab=.
   */
  const handleOpenCourseSyllabus = (courseCode: string) => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('course', courseCode.toUpperCase());
      window.history.replaceState({}, '', url.toString());
    } catch { /* storage-less web views: the tab still opens */ }
    setHubCourse(null);
    setActiveTab('syllabus');
  };

  /** Global shortcuts: Ctrl/⌘+K toggles the command palette; Escape closes it. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandCenterOpen((open) => !open);
      } else if (e.key === 'Escape') {
        setIsCommandCenterOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /**
   * Semester switcher (dashboard + settings): re-syncs every semester-dependent
   * dataset with the live in-memory session. Without a live session it opens
   * the login modal instead.
   *
   * Runs through the sync coordinator so the shared in-flight lock, the global
   * "Refreshing VTOP…" status and the last-sync timestamp stay accurate, and
   * so a failed switch can never leave the UI describing the *previous*
   * semester's cache as if it belonged to the newly selected one.
   */
  const semesterSwitchInFlight = useRef(false);
  const handleSemesterChange = async (semId: string) => {
    if (!semId || semId === selectedSemesterId || semesterSwitchInFlight.current) return;
    setSemesterSyncError(null);
    if (!isLiveSessionActive()) {
      setIsLoginOpen(true);
      return;
    }
    semesterSwitchInFlight.current = true;
    setSemesterSwitching(true);
    try {
      const ok = await refreshVtopData({
        reason: 'semester',
        force: true,
        semesterId: semId,
        onData: () => loadLocalVtopData(),
      });
      if (!ok) {
        setSemesterSyncError('Could not switch semester — VTOP did not respond. Still showing your previous semester.');
        return;
      }
      setSelectedSemesterId(semId);
    } catch (err) {
      setSemesterSyncError(`Semester switch failed: ${humanErrorCopy(err, 'VTOP could not be reached. Please try again.')}`);
    } finally {
      semesterSwitchInFlight.current = false;
      setSemesterSwitching(false);
    }
  };

  return (
    <div className="ultracc-app min-h-screen bg-white text-zinc-900 font-sans selection:bg-blue-600 selection:text-zinc-900 flex flex-col antialiased">
      <a href="#ultracc-main" className="ultracc-skip-link">Skip to content</a>
      {!isFirstRun && (
      <MeridianHeader
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        mode={featureMode}
        onOpenCommandCenter={() => setIsCommandCenterOpen(true)}
        onOpenLogin={() => setIsLoginOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        syncState={syncState}
        isOnline={isOnline}
        isRefreshing={syncState.status === 'refreshing' || lmsSyncing}
        syncNeedsAttention={lmsNeedsAttention}
        semesters={semesters}
        selectedSemesterId={selectedSemesterId}
        onSemesterChange={handleSemesterChange}
        semesterSwitching={semesterSwitching}
        profileName={student?.name}
        profilePhotoUrl={(student as any)?.profilePhotoUrl}
        onManualRefresh={() => void handleRefresh()}
        backgroundPush={backgroundPush}
        notificationData={{
          assignments: assignments as any,
          attendance: attendance as any,
          exams: exams as any,
          marks: marks as any,
          timetable: timetable as any,
          campusEvents: [],
        }}
      />
      )}

      <main id="ultracc-main" tabIndex={-1} ref={mainRef} className="ultracc-main flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-8">
        <ErrorBoundary>
        {isFirstRun ? (
          <FirstRunLanding
            onLogin={() => setIsLoginOpen(true)}
            semesters={semesters}
            selectedSemesterId={selectedSemesterId}
            onSemesterChange={handleSemesterChange}
            mode={featureMode}
            onModeChange={setFeatureMode}
          />
        ) : (
        <>
        {/* PWA: update-available / install affordances (never blocks content) */}
        <PwaStatusBar />
        {/* Offline banner — previous data still shown */}
        {!isOnline && hasSyncedData && (
          <div role="status" className="mb-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-700 text-xs flex items-center gap-2">
            <WifiOff className="h-4 w-4 shrink-0" />
            <span>Offline — showing your last synced data{lastSyncTime ? ` (${new Date(lastSyncTime).toLocaleString()})` : ''}.</span>
          </div>
        )}
        {!isOnline && !hasSyncedData && !cacheReadError && (
          <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-700 text-xs flex items-center gap-2">
            <WifiOff className="h-4 w-4 shrink-0" />
            <span>You're offline and no data has been synced yet — log in once you're back online.</span>
          </div>
        )}
        {semesterSyncError && (
          <div role="alert" className="mb-4 p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-700 text-xs flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{semesterSyncError}</span>
          </div>
        )}
        {cacheReadError && (
          <div role="alert" className="mb-4 p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-700 text-xs flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>Some of your saved data couldn't be read on this device ({humanErrorCopy(cacheReadError, 'one stored section was unreadable')}). Those sections may look empty until the next successful refresh.</span>
          </div>
        )}
        {/* Per-dataset sync status (shows during/after refresh) */}
        <SyncStatusPanel syncState={syncState} />

        {/* Signed out, or a cache with no profile record. */}
        {isLoaded && (!hasSyncedData || !student) && activeTab === 'dashboard' && (
          <section className="ultracc-empty-shell">
            <div className="ultracc-empty-intro">
              <div className="ultracc-empty-icon"><UltraCCLogo size={48} /></div>
              <div><p className="ultracc-eyebrow">VIT Chennai · Student Portal</p><h2>Welcome to UltraCC</h2><p>Connect VTOP to load your timetable, attendance, marks, examinations and academic records.</p></div>
              <button onClick={() => setIsLoginOpen(true)} className="acc-bg text-zinc-900 font-extrabold">Login with VTOP <span>→</span></button>
              <small>Credentials stay on this device unless you log in.</small>
            </div>
            <div className="ultracc-access-grid">
              <button onClick={() => setIsLoginOpen(true)}><b>VTOP sync</b><span>Load authoritative academic data</span><i>Connect →</i></button>
              <button onClick={() => setActiveTab('lms')}><b>LMS / assignments</b><span>Open Moodle coursework when available</span><i>Open →</i></button>
              <button onClick={() => setActiveTab('campus-utils')}><b>Campus facilities</b><span>Verified spaces, printing and study groups</span><i>Explore →</i></button>
              <button onClick={() => setActiveTab('tools')}><b>Student tools</b><span>Calculators, exports and academic utilities</span><i>Explore →</i></button>
            </div>
          </section>
        )}

        <div className={`ultracc-route-frame ${activeTab === 'dashboard' ? 'is-dashboard' : ''}`} data-route={activeTab}>
        <Suspense fallback={<RouteLoadingState />}>
        {isLoaded
          && VTOP_DATA_TABS.has(activeTab)
          && (!hasSyncedData || (PROFILE_TABS.has(activeTab) && !student)) && (
          <RouteUnavailableState route={activeTab} onLogin={() => setIsLoginOpen(true)} />
        )}
        {hasSyncedData && student && activeTab === 'dashboard' && (
          <MeridianDashboard
            student={student as any}
            attendance={attendance as any}
            timetable={timetable as any}
            exams={exams as any}
            assignments={assignments as any}
            marks={marks as any}
            circulars={circulars as any}
            od={od as any}
            semesterLabel={activeSemesterLabel}
            profilePhotoUrl={(student as any)?.profilePhotoUrl}
            semesters={semesters}
            selectedSemesterId={selectedSemesterId}
            onSemesterChange={handleSemesterChange}
            onNavigateTab={setActiveTab}
          />
        )}

        {hubCourse && (
          <CourseHubView
            courseCode={hubCourse.code}
            courseTitle={hubCourse.title}
            marks={(marks as any).find((m: any) => m.courseCode === hubCourse.code) || null}
            faculty={facultyForCourse(hubCourse.code)}
            lmsData={lmsDataForCourse(hubCourse.code)}
            onBack={() => setHubCourse(null)}
            onOpenSyllabus={handleOpenCourseSyllabus}
          />
        )}

        {!hubCourse && activeTab === 'lms' && (
          <LmsView
            exams={exams as any}
            assignments={lmsAssignments as any}
            quizzes={lmsQuizzes as any}
            materials={lmsMaterials as any}
            courses={lmsCourses as any}
            lmsSyncing={lmsSyncing}
            lmsSyncMessage={lmsSyncMessage}
            lmsSyncErrors={lmsSyncErrors}
            lmsLastSynced={lmsLastSynced}
            needsAttention={lmsNeedsAttention}
            onLmsSync={handleLmsSync}
            onOpenCourse={(code) => {
              const c = lmsCourses.find((x) => x.courseId === Number(code));
              setHubCourse({ code: c ? c.name : code, title: c ? c.name : code });
            }}
          />
        )}

        {!hubCourse && hasSyncedData && activeTab === 'grades' && (
          <GradesView
            courseMarks={marks as any}
            timetable={timetable as any}
            grades={grades as any}
            gradeHistory={gradeHistory as any}
            semesterGrades={semesterGrades as any}
            curriculum={curriculum as any}
            arrears={arrears as any}
            lmsGradebook={lmsGradebook.map((g) => ({
              courseId: g.courseId,
              courseName: lmsCourses.find((c) => c.courseId === g.courseId)?.name || `Course ${g.courseId}`,
              items: g.items,
            }))}
          />
        )}

        {hasSyncedData && activeTab === 'academics' && (
          <div className="space-y-6">
            <AcademicsView attendance={attendance as any} timetable={timetable as any} od={od} />
            <CourseIntelView attendance={attendance as any} marks={marks as any} />
          </div>
        )}

        {hasSyncedData && activeTab === 'timetable' && (
          <TimetableView timetable={timetable as any} attendance={attendance as any} onNavigateMap={handleNavigateMap} />
        )}

        {hasSyncedData && activeTab === 'syllabus' && (
          <SyllabusView
            timetable={timetable as any}
            onLogin={() => setIsLoginOpen(true)}
            semesterId={selectedSemesterId}
            semesterLabel={activeSemesterLabel}
            registrationNo={student?.regNo || ''}
          />
        )}

        {hasSyncedData && activeTab === 'exams' && (
          <ExamsView
            exams={exams as any}
            makeupExams={makeupExams as any}
            refat={refat as any}
            compre={compre as any}
            arrears={arrears as any}
            onNavigateMap={handleNavigateMap}
          />
        )}

        {hasSyncedData && activeTab === 'calendar' && (
          <AcademicCalendarView calendar={calendar as any} timetable={timetable as any} exams={exams as any} assignments={assignments as any} />
        )}

        {hasSyncedData && student && activeTab === 'faculty' && (
          <FacultyView student={student as any} timetable={timetable as any} attendance={attendance as any} />
        )}

        {activeTab === 'campus' && (
          <CampusMapView initialSearch={campusSearchQuery} />
        )}

        {activeTab === 'campus-utils' && (
          <CampusUtilitiesView onOpenRooms={() => setActiveTab('freeClassrooms')} onOpenMap={(query) => { setCampusSearchQuery(query || ''); setActiveTab('campus'); }} />
        )}

        {activeTab === 'fresher' && (
          <FresherGuideView terms={fresherGuideTerms} onNavigateTab={setActiveTab} />
        )}

        {hasSyncedData && student && activeTab === 'placement' && (
          <PlacementPortalView student={student as any} />
        )}

        {hasSyncedData && student && activeTab === 'ai-advisor' && (
          <AiAdvisorView
            student={student as any}
            attendance={attendance as any}
            timetable={timetable as any}
            marks={marks as any}
            exams={exams as any}
            grades={grades as any}
            gradeHistory={gradeHistory as any}
            semesterGrades={semesterGrades as any}
            od={od as any}
            semesterLabel={activeSemesterLabel}
          />
        )}

        {hasSyncedData && student && activeTab === 'my-info' && (
          <MyInfoView
            student={student as any}
            payments={payments as any}
            credentials={credentials as any}
            paymentReceipts={paymentReceipts as any}
            sapInfo={sapInfo as any}
            bankInfo={bankInfo as any}
            biometric={biometric as any}
            proctorMessages={proctorMessages as any}
            loginHistory={loginHistory as any}
            classMessages={classMessages as any}
            hodDean={hodDean as any}
            wallet={wallet as any}
            extraCurricular={extraCurricular as any}
          />
        )}

        {hasSyncedData && activeTab === 'transport' && (
          <TransportView transport={transport as any} />
        )}

        {hasSyncedData && activeTab === 'freeClassrooms' && (
          <FreeClassroomsView timetable={timetable as any} />
        )}

        {activeTab === 'events' && <EventHubView />}

        {activeTab === 'cabshare' && <CabShareView />}

        {activeTab === 'qbank' && <QbankView />}

        {activeTab === 'ffcs' && <FfcsPlannerView timetable={timetable as any} />}

        {activeTab === 'directory' && <FacultyDirectoryView />}

        {activeTab === 'hostel' && (
          <div className="space-y-4 pb-12">
            <div className="bg-white border border-zinc-200 rounded-3xl p-5 shadow-xl">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-600">
                  <Bed className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="text-lg font-extrabold text-zinc-900 tracking-tight">Hostel & Campus Life</h2>
                  <p className="text-xs text-zinc-500 font-medium">Mess menu, leave tracker, laundry, and counselling</p>
                </div>
              </div>
            </div>
            <HostelSubTabs
              activeTab={hostelTab}
              onTabChange={(t) => setHostelTab(t)}
            />
          </div>
        )}

        {activeTab === 'library' && <LibraryView />}

        {activeTab === 'social' && (
          <SocialTab myTimetable={timetable as any} />
        )}

        {activeTab === 'tools' && (
          <ToolsHub onNavigate={setActiveTab} />
        )}

        {activeTab === 'clubs' && <ClubHub />}
        </Suspense>
        </div>

        {/* Hostel sub-tab state */}
        </>
        )}
        </ErrorBoundary>
      </main>

      {/* Modals — their own boundary: a dialog whose lazy chunk fails to load
          must not take the whole app down with it (the login modal is the only
          route to data), and its Suspense fallback must not sit unbounded. */}
      <ErrorBoundary>
      <Suspense fallback={null}>
      <CommandCenterModal
        isOpen={isCommandCenterOpen}
        onClose={() => setIsCommandCenterOpen(false)}
        attendance={attendance as any}
        exams={exams as any}
        marks={marks as any}
        timetable={timetable as any}
        onNavigateTab={setActiveTab}
        mode={featureMode}
      />

      <ExtensionSyncModal
        isOpen={isLoginOpen}
        onClose={() => setIsLoginOpen(false)}
        onAccountSwitch={() => {
          resetLmsClient();
          clearSavedLmsCredentials();
          resetSyncCoordinator();
          resetAllVtopState();
        }}
        onDataSynced={async () => {
          await loadLocalVtopData();
          await loadLocalLmsData();
          markSyncedAt(Date.now(), null);
          toastSuccess('Signed in — your VTOP data is up to date', { duration: 3500 });
        }}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        semesters={semesters}
        selectedSemesterId={selectedSemesterId}
        semesterLoading={false}
        onSemesterChange={handleSemesterChange}
        onClearAllData={handleClearAllData}
        onLmsSync={handleLmsSync}
        lmsSyncErrors={lmsSyncErrors}
        backgroundPush={backgroundPush}
        mode={featureMode}
        onModeChange={setFeatureMode}
      />
      </Suspense>
      </ErrorBoundary>

      {/* Toast notifications */}
      <ToastContainer />
    </div>
  );
}
