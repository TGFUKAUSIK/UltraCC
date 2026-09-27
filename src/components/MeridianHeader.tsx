import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bed, BookOpen, Briefcase, CalendarCheck, CalendarDays, ClipboardList, Compass, GraduationCap, HelpCircle, LayoutDashboard, LogIn, Map, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Search, SlidersHorizontal, Table2, Users, WalletCards, BusFront, LibraryBig, MapPinned, FlaskConical, ListChecks, UserRound, BookMarked, RefreshCw, X } from 'lucide-react';
import { isDataStale, type SyncCoordinatorState } from '../lib/vtop/syncCoordinator';
import { isNavHidden, isNavHiddenInMode, type FeatureMode } from '../lib/navVisibility';
import { ProfilePhoto } from './ProfilePhoto';
import { NotificationBell } from './NotificationBell';
import type { BackgroundPushController } from '../hooks/useBackgroundPush';

interface Props {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onOpenCommandCenter: () => void;
  onOpenLogin: () => void;
  onOpenSettings: () => void;
  syncState?: SyncCoordinatorState;
  isOnline?: boolean;
  onManualRefresh?: () => void | Promise<void>;
  isRefreshing?: boolean;
  syncNeedsAttention?: boolean;
  semesters?: Array<{ id: string; name: string; isCurrent?: boolean }>;
  selectedSemesterId?: string;
  onSemesterChange?: (semesterId: string) => void | Promise<void>;
  semesterSwitching?: boolean;
  profileName?: string;
  profilePhotoUrl?: string;
  /** Synced datasets for smart notifications (all optional — empty = quiet). */
  notificationData?: {
    assignments: AssignmentRecordForBell[];
    attendance: AttendanceRecordForBell[];
    exams: ExamRecordForBell[];
    marks: MarksRecordForBell[];
    timetable: TimetableSlotForBell[];
    campusEvents: Array<{ eid: string; title: string; date: string }>;
  };
  /** Background push controller (reminders that survive a closed browser). */
  backgroundPush?: BackgroundPushController;
  /** Feature mode (minimal vs complete) gates what the nav points at. */
  mode?: FeatureMode;
}

// Structural types — the header should not import VTOP internals directly.
interface AssignmentRecordForBell { id: string; courseCode: string; courseTitle: string; title: string; dueDate: string; status: string; }
interface AttendanceRecordForBell { courseCode: string; courseTitle: string; percentage: number; }
interface ExamRecordForBell { id: string; courseCode: string; courseTitle: string; examType: string; date: string; time: string; venue: string; seatNo: string; }
interface MarksRecordForBell { courseCode: string; totalInternalWeightScored: number; currentEstimatedGrade: string; }
interface TimetableSlotForBell { day: string; startTime: string; courseCode: string; }

type PortalLink = [string, React.ComponentType<{ size?: number; strokeWidth?: number }>, string];
/**
 * Desktop rail. Labels and tab ids match `serviceGroups` below (the
 * authoritative feature naming); `naming.test.ts` enforces the parity.
 * Both lists pass through `NAV_HIDDEN_TABS` so withdrawing a feature is one
 * entry applied to every surface at once.
 */
const HIDE = (item: readonly unknown[]) => !isNavHidden(String(item[0]));
const navGroupsSource: { title: string; items: PortalLink[] }[] = [
  { title: 'Academics', items: [['academics', GraduationCap, 'Attendance'], ['grades', Table2, 'Marks & Grades'], ['timetable', CalendarDays, 'Timetable'], ['syllabus', BookOpen, 'Syllabus'], ['calendar', CalendarCheck, 'Academic Calendar'], ['ffcs', ListChecks, 'FFCS'], ['ai-advisor', FlaskConical, 'AI Advisor']] },
  { title: 'Examinations', items: [['exams', ClipboardList, 'Exam Schedule'], ['lms', BookOpen, 'Assignments & Courses']] },
  { title: 'Campus', items: [['campus', MapPinned, 'Campus Map'], ['campus-utils', Map, 'Campus Facilities'], ['freeClassrooms', FlaskConical, 'Rooms & Labs'], ['transport', BusFront, 'Transport'], ['library', LibraryBig, 'Library'], ['events', CalendarDays, 'Events'], ['hostel', Bed, 'Hostel']] },
  { title: 'Student services', items: [['faculty', Users, 'Faculty & Proctor'], ['directory', Users, 'Faculty Directory'], ['fresher', Compass, 'Fresher Guide'], ['my-info', UserRound, 'Profile'], ['social', Users, 'Timetable Compare'], ['cabshare', BusFront, 'Cab Share'], ['tools', WalletCards, 'Student Tools'], ['placement', Briefcase, 'Placements'], ['clubs', Users, 'Student Communities'], ['qbank', BookMarked, 'Question Bank']] },
];
// Exported for naming.test.ts, which asserts rail ↔ services ↔ ⌘K parity.
export const navGroups = navGroupsSource.map((group) => ({ ...group, items: group.items.filter(HIDE) }));
const serviceGroupsSource: { title: string; items: [string, string][] }[] = [
  { title: 'Academics', items: [['academics', 'Attendance'], ['grades', 'Marks & Grades'], ['timetable', 'Timetable'], ['syllabus', 'Syllabus'], ['calendar', 'Academic Calendar'], ['ffcs', 'FFCS'], ['ai-advisor', 'AI Advisor']] },
  { title: 'Examinations & LMS', items: [['exams', 'Exam Schedule'], ['lms', 'Assignments & Courses']] },
  { title: 'Campus', items: [['campus', 'Campus Map'], ['campus-utils', 'Campus Facilities'], ['freeClassrooms', 'Rooms & Labs'], ['transport', 'Transport'], ['library', 'Library'], ['events', 'Events'], ['hostel', 'Hostel']] },
  { title: 'Student services', items: [['faculty', 'Faculty & Proctor'], ['directory', 'Faculty Directory'], ['fresher', 'Fresher Guide'], ['my-info', 'Profile'], ['sync-refresh', 'Sync & Refresh'], ['social', 'Timetable Compare'], ['cabshare', 'Cab Share'], ['tools', 'Student Tools'], ['placement', 'Placements'], ['clubs', 'Student Communities'], ['qbank', 'Question Bank'], ['settings', 'Settings']] },
];
// Exported for tests: the services menu is the authoritative feature naming.
export const serviceGroups = serviceGroupsSource.map((group) => ({ ...group, items: group.items.filter(HIDE) }));

const RAIL_EXPANDED_KEY = 'ultracc:rail-expanded';

/** Mobile bottom bar: the Academics button lights for its whole group. */
const ACADEMICS_BAR_TABS = ['academics', 'syllabus', 'grades', 'calendar', 'ffcs', 'ai-advisor'];
const BOTTOM_BAR_TABS = new Set([...ACADEMICS_BAR_TABS, 'dashboard', 'timetable', 'exams']);
// 'More' covers every destination the bottom bar cannot show, derived from the
// services menu so a new feature always has an active state on a phone.
const MORE_MENU_TABS = serviceGroups
  .flatMap((group) => group.items.map(([id]) => id))
  .filter((id) => !BOTTOM_BAR_TABS.has(id));

// Rail state machine, exported for tests. Navigating collapses the rail; the
// toggle flips it.
export function railStateAfter(current: boolean, action: 'toggle' | 'navigate'): boolean {
  return action === 'toggle' ? !current : false;
}

function formatUpdatedAt(timestamp: number | null | undefined): string {
  if (!timestamp) return 'No successful sync yet';
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return 'Updated just now';
  if (minutes < 60) return `Updated ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `Updated ${days} day${days === 1 ? '' : 's'} ago`;
}

export const UltraCCHeader: React.FC<Props> = ({ activeTab, setActiveTab, onOpenCommandCenter, onOpenLogin, onOpenSettings, syncState, isOnline = true, onManualRefresh, isRefreshing = false, syncNeedsAttention = false, semesters = [], selectedSemesterId = '', onSemesterChange, semesterSwitching = false, profileName, profilePhotoUrl, notificationData, backgroundPush, mode = 'complete' as FeatureMode }) => {
  const [servicesOpen, setServicesOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // Mode-gated destinations: minimal mode collapses the rail, services menu and
  // "More" sheet to the daily essentials. The module exports stay complete so
  // naming.test.ts keeps asserting full naming parity.
  const visibleNavGroups = useMemo(
    () => navGroups
      .map((group) => ({ ...group, items: group.items.filter(([id]) => !isNavHiddenInMode(String(id), mode)) }))
      .filter((group) => group.items.length > 0),
    [mode],
  );
  const visibleServiceGroups = useMemo(
    () => serviceGroups
      .map((group) => ({ ...group, items: group.items.filter(([id]) => !isNavHiddenInMode(id, mode)) }))
      .filter((group) => group.items.length > 0),
    [mode],
  );
  const moreMenuTabs = useMemo(
    () => visibleServiceGroups.flatMap((group) => group.items.map(([id]) => id)).filter((id) => !BOTTOM_BAR_TABS.has(id)),
    [visibleServiceGroups],
  );
  // Desktop rail: compact by default, expandable on demand. The choice is
  // remembered, and navigating collapses it again.
  const [railExpanded, setRailExpanded] = useState<boolean>(() => {
    try { return localStorage.getItem(RAIL_EXPANDED_KEY) === '1'; } catch { return false; }
  });
  const setRail = (expanded: boolean) => {
    setRailExpanded(expanded);
    try { localStorage.setItem(RAIL_EXPANDED_KEY, expanded ? '1' : '0'); } catch { /* storage unavailable */ }
  };
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = 'ultracc-services-menu';
  useEffect(() => {
    const close = (event: MouseEvent) => { const target = event.target as Element; if (target.closest('.meridian-more-button') || target.closest(`[aria-controls="${menuId}"]`)) return; if (menuRef.current && !menuRef.current.contains(target)) setServicesOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setServicesOpen(false); setHelpOpen(false); } };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, []);
  useEffect(() => {
    if (!helpOpen) return;
    const close = (event: MouseEvent) => { const target = event.target as Element; if (target.closest('.meridian-help-button') || target.closest('.meridian-help-panel')) return; setHelpOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [helpOpen]);
  const go = (id: string) => {
    setServicesOpen(false);
    setHelpOpen(false);
    // Choosing a destination returns the rail to its compact form.
    if (railExpanded) setRail(railStateAfter(railExpanded, 'navigate'));
    if (id === 'settings') {
      onOpenSettings();
      return;
    }
    if (id === 'sync-refresh') {
      void onManualRefresh?.();
      return;
    }
    setActiveTab(id);
  };
  const isPrimaryActive = (id: string) => activeTab === id;
  const syncLabel = !isOnline
    ? 'Offline'
    : syncState?.status === 'refreshing'
      ? 'Refreshing…'
      : syncNeedsAttention || syncState?.status === 'error' || syncState?.status === 'partial'
        ? 'Needs attention'
        : syncState?.lastSyncedAt
          ? (isDataStale(syncState.lastSyncedAt) ? 'Stale' : 'Synced')
          : 'Not synced';
  const mobileMoreActive = servicesOpen || moreMenuTabs.includes(activeTab);
  // Signed-in = a synced profile exists. Before that, show an explicit "Sign in"
  // call-to-action rather than a generic avatar chip.
  const isSignedIn = Boolean(profileName);
  // Lock body scroll while the mobile bottom-sheet menu is open.
  useEffect(() => {
    if (!servicesOpen) return;
    document.body.classList.add('ultracc-modal-open');
    return () => document.body.classList.remove('ultracc-modal-open');
  }, [servicesOpen]);
  return <>
    <aside className={`meridian-rail ${railExpanded ? 'expanded' : ''}`}>
      <button className="meridian-logo" onClick={() => go('dashboard')} aria-label="Dashboard"><span>U</span><i /></button>
      <button
        type="button"
        className="meridian-rail-toggle"
        onClick={() => setRail(railStateAfter(railExpanded, 'toggle'))}
        aria-expanded={railExpanded}
        aria-controls="ultracc-rail-nav"
        title={railExpanded ? 'Collapse navigation' : 'Expand navigation'}
      >
        {railExpanded ? <PanelLeftClose size={17} aria-hidden="true" /> : <PanelLeftOpen size={17} aria-hidden="true" />}
        <span>{railExpanded ? 'Collapse' : 'Expand'}</span>
      </button>
      <nav id="ultracc-rail-nav" className="portal-sidebar-nav" aria-label="University portal navigation">
        <button className={isPrimaryActive('dashboard') ? 'active' : ''} aria-current={isPrimaryActive('dashboard') ? 'page' : undefined} title="Dashboard" aria-label="Dashboard" onClick={() => go('dashboard')}><LayoutDashboard size={18} strokeWidth={1.8} /><span>Dashboard</span></button>
        {visibleNavGroups.map((group) => <section className="portal-nav-group" key={group.title}><h2>{group.title}</h2>{group.items.map(([id, Icon, label]) => <button key={id} className={isPrimaryActive(id) ? 'active' : ''} aria-current={isPrimaryActive(id) ? 'page' : undefined} title={label} aria-label={label} onClick={() => go(id)}><Icon size={18} strokeWidth={1.8} /><span>{label}</span></button>)}</section>)}
      </nav>
      <div className="meridian-rail-bottom"><button type="button" className={`meridian-help-button ${helpOpen ? 'open' : ''}`} title="Help" aria-label="Help and keyboard shortcuts" aria-expanded={helpOpen} onClick={() => { setServicesOpen(false); setHelpOpen((value) => !value); }}><HelpCircle size={18} strokeWidth={1.8} /><span>Help</span></button><button title="Settings" aria-label="Settings" onClick={onOpenSettings}><SlidersHorizontal size={18} strokeWidth={1.8} /><span>Settings</span></button>{isSignedIn ? <button className="meridian-avatar" onClick={() => go('my-info')} aria-label="Open your profile"><ProfilePhoto name={profileName} src={profilePhotoUrl} size="sm" className="profile-dot" /></button> : <button title="Sign in to VTOP" aria-label="Sign in to VTOP" onClick={onOpenLogin}><LogIn size={18} strokeWidth={1.8} /><span>Sign in</span></button>}</div>
    </aside>
    <header className="meridian-header">
      <div className="meridian-brand"><strong>UltraCC</strong><span>VIT Chennai<span className="brand-tag"> · Student Portal</span></span></div>
      <button className="meridian-campus" onClick={() => go('dashboard')} aria-label="Campus: VIT Chennai"><span className="campus-mark">VIT</span><span>VIT Chennai</span></button>
      {semesters.length > 0 && onSemesterChange && <label className={`meridian-semester ${semesterSwitching ? 'is-switching' : ''}`} title="Change academic semester"><span>Term</span><select value={selectedSemesterId} onChange={(event) => void onSemesterChange(event.target.value)} disabled={semesterSwitching} aria-label="Academic semester">{semesters.map((semester) => <option key={semester.id} value={semester.id}>{semester.name}{semester.isCurrent ? ' · Active' : ''}</option>)}</select>{semesterSwitching && <RefreshCw size={13} className="animate-spin" aria-hidden="true" />}</label>}
      <button className="meridian-search" onClick={onOpenCommandCenter} aria-label="Search"><Search size={16} /><span>Search courses, faculty, rooms, services…</span><kbd>⌘K</kbd></button>
      <button className="meridian-term" onClick={() => void onManualRefresh?.()} title="Data synchronization status"><b className={!isOnline || syncNeedsAttention || syncState?.status === 'error' || syncState?.status === 'partial' ? 'sync-problem' : ''}>●</b><span>{syncLabel}<small>{formatUpdatedAt(syncState?.lastSyncedAt)}</small></span></button>
      <div className="meridian-actions"><button className={`meridian-more-button ${servicesOpen ? 'open' : ''}`} onClick={() => setServicesOpen(value => !value)} aria-expanded={servicesOpen} aria-controls={menuId} aria-label={servicesOpen ? 'Close services' : 'Open services'}><span>Services</span><span aria-hidden="true">⌄</span></button><i className="meridian-divider" /><button className={`icon-button meridian-sync-button ${isRefreshing ? 'is-refreshing' : ''}`} title="Sync and refresh" aria-label="Sync and refresh" onClick={() => void onManualRefresh?.()} disabled={isRefreshing}><RefreshCw size={17} strokeWidth={1.8} className={isRefreshing ? 'animate-spin' : ''} /></button><NotificationBell assignments={notificationData?.assignments ?? []} attendance={notificationData?.attendance ?? []} exams={notificationData?.exams ?? []} marks={notificationData?.marks ?? []} timetable={notificationData?.timetable ?? []} campusEvents={notificationData?.campusEvents ?? []} backgroundPush={backgroundPush} />{isSignedIn ? <button className="meridian-profile" onClick={() => go('my-info')} aria-label="Open your profile"><ProfilePhoto name={profileName} src={profilePhotoUrl} size="sm" className="profile-dot" /><span className="meridian-profile-name">{profileName}<small>Student</small></span><span aria-hidden="true">⌄</span></button> : <button className="meridian-signin" onClick={onOpenLogin} aria-label="Sign in to VTOP"><LogIn size={15} strokeWidth={1.8} aria-hidden="true" /><span>Sign in</span></button>}</div>
      {servicesOpen && <>
        {/* Scrim — tap to close (mobile bottom sheet + desktop popover). */}
        <div className="meridian-feature-scrim" onClick={() => setServicesOpen(false)} aria-hidden="true" />
        <div id={menuId} ref={menuRef} className="meridian-feature-menu" role="group" aria-label="University services"><div className="feature-menu-title"><span>University services</span><small>Academic and campus access</small><button type="button" className="feature-menu-close" onClick={() => setServicesOpen(false)} aria-label="Close services menu"><X size={18} /></button></div><div className="feature-menu-groups">{visibleServiceGroups.map(group => <section key={group.title}><h3>{group.title}</h3>{group.items.map(([id, label]) => <button type="button" className={activeTab === id ? 'selected' : ''} key={id} onClick={() => go(id)}>{label}<span aria-hidden="true">→</span></button>)}</section>)}</div></div>
      </>}
    </header>
    {/* Help panel: keyboard shortcuts and setup pointers. */}
    {helpOpen && <div className="meridian-help-panel" role="dialog" aria-label="Help and keyboard shortcuts" style={{ left: railExpanded ? 232 : 94 }}>
      <div className="help-panel-head"><strong>Help</strong><button type="button" onClick={() => setHelpOpen(false)} aria-label="Close help"><X size={16} /></button></div>
      <div className="help-panel-body">
        <div className="help-row"><kbd>⌘K</kbd><span><b>Search everything</b>Courses, faculty, rooms, exams and every screen.</span></div>
        <div className="help-row"><kbd>Esc</kbd><span><b>Close overlays</b>Menus, dialogs and search all dismiss with it.</span></div>
        <div className="help-row"><kbd>→</kbd><span><b>Sign in to sync</b>Attendance, marks and timetable come from your VTOP account.</span></div>
        <div className="help-row"><kbd>!</kbd><span><b>Install for reminders</b>Add UltraCC to your home screen so class and quiz alerts arrive.</span></div>
      </div>
      <div className="help-panel-foot">
        <a href="https://github.com/TGFUKAUSIK/UltraCC-portal" target="_blank" rel="noreferrer noopener">Project &amp; setup docs</a>
        <button type="button" onClick={onOpenSettings}>Open settings</button>
      </div>
    </div>}
    <nav className="mobile-tab-bar" aria-label="Mobile navigation">
      <button type="button" className={activeTab === 'dashboard' ? 'active' : ''} aria-current={activeTab === 'dashboard' ? 'page' : undefined} onClick={() => go('dashboard')} aria-label="Home"><LayoutDashboard size={19} strokeWidth={1.9} /><span>Home</span></button>
      <button type="button" className={ACADEMICS_BAR_TABS.includes(activeTab) ? 'active' : ''} aria-current={ACADEMICS_BAR_TABS.includes(activeTab) ? 'page' : undefined} onClick={() => go('academics')} aria-label="Academics"><GraduationCap size={19} strokeWidth={1.9} /><span>Academics</span></button>
      <button type="button" className={activeTab === 'timetable' ? 'active' : ''} aria-current={activeTab === 'timetable' ? 'page' : undefined} onClick={() => go('timetable')} aria-label="Timetable"><CalendarDays size={19} strokeWidth={1.9} /><span>Timetable</span></button>
      <button type="button" className={activeTab === 'exams' ? 'active' : ''} aria-current={activeTab === 'exams' ? 'page' : undefined} onClick={() => go('exams')} aria-label="Exams"><ClipboardList size={19} strokeWidth={1.9} /><span>Exams</span></button>
      <button type="button" className={mobileMoreActive ? 'active' : ''} onClick={() => { setHelpOpen(false); setServicesOpen(value => !value); }} aria-label={servicesOpen ? 'Close more menu' : 'More'} aria-expanded={servicesOpen} aria-controls={menuId}><MoreHorizontal size={19} strokeWidth={1.9} /><span>More</span></button>
    </nav>
  </>;
};

// Alias retained for existing imports.
export const MeridianHeader = UltraCCHeader;
