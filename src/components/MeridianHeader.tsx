import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bed, BookOpen, Briefcase, CalendarCheck, CalendarDays, ClipboardList, Compass, GraduationCap, HelpCircle, LayoutDashboard, LogIn, Map, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Search, Smartphone, SlidersHorizontal, Table2, Users, WalletCards, BusFront, LibraryBig, MapPinned, FlaskConical, ListChecks, UserRound, BookMarked, RefreshCw, X } from 'lucide-react';
import { isDataStale, type SyncCoordinatorState } from '../lib/vtop/syncCoordinator';
import { isNavHidden, isNavHiddenInMode, MINIMAL_LANDING, type FeatureMode } from '../lib/navVisibility';
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
/**
 * The header's own view of a timetable row. The bell needs the start of the next
 * class; the day-line additionally needs the end, because "how far through
 * today am I" is measured between the first bell and the last one, not against a
 * working day the UI decided on.
 */
interface TimetableSlotForBell { day: string; startTime: string; endTime: string; courseCode: string; }

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

/**
 * The key printed on the search button and in the help panel. Apple keyboards
 * send the ⌘ glyph, every other desktop sends Ctrl — a hint that names the
 * wrong key is a shortcut nobody tries. Exported for shortcutLabel.test.ts.
 */
export function searchShortcutLabel(userAgent: string): string {
  return /Mac|iPhone|iPad|iPod/.test(userAgent) ? '⌘K' : 'Ctrl K';
}
const SEARCH_SHORTCUT = searchShortcutLabel(typeof navigator === 'undefined' ? '' : navigator.userAgent);

/**
 * Mobile bottom bar.
 *
 * Five slots, one per thing a student reaches for between classes: Home (what is
 * now and next), Timetable, Academics (attendance and the bunk maths), Marks &
 * Grades (the marks, GPA and the what-if answers), and More for everything else.
 * Each button owns a *group* of destinations rather than a single route, so
 * opening a Library page from More still lights the button it belongs to. The
 * groups are derived from the same lists the rail and services menu use, so a
 * destination can never be in the bar and nameless at the same time.
 *
 * Campus sat in this bar until 2026-10-08; Marks & Grades replaced it, and
 * Campus moved into More with the rest of its group (the map, facilities, rooms,
 * transport, library, events and hostel). Because no bar button points at Campus
 * any more, those destinations are deliberately *not* in BOTTOM_BAR_TABS: they
 * have to fall through to the More menu's own list so the More button lights up
 * when a student is standing on one of them.
 *
 * Exams deliberately sits inside More: it is an occasional destination, and its
 * countdown already lives on Home where a student cannot miss it.
 */
const ACADEMICS_BAR_TABS = ['academics', 'syllabus', 'calendar', 'ffcs', 'ai-advisor'];
const GRADES_BAR_TABS = ['grades'];
const BOTTOM_BAR_TABS = new Set([...ACADEMICS_BAR_TABS, ...GRADES_BAR_TABS, 'dashboard', 'timetable']);
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

/**
 * The compact form of a semester's name.
 *
 * VTOP writes "Fall Semester 2026-27". The header used to print that in full and
 * the pill cut it to "Fall Semester 202", which is worse than useless: the
 * student cannot tell which term is selected. The compact form drops the word
 * "Semester" (every term has one) and shortens each year to its last two digits,
 * so the label is short enough to never truncate — "Fall 26-27", "Winter 25-26".
 * Nothing is lost: the full name stays in the option text, in the select's
 * accessible name and in the label's tooltip.
 *
 * Exported for headerNaming.test.tsx.
 */
export function compactTermLabel(name: string): string {
  return name
    .replace(/\bsemester\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(\d{4})\s*[–—-]\s*(\d{2,4})/g, (_match, start: string, end: string) => `${start.slice(2)}-${end.slice(-2)}`);
}

/**
 * What the compact phone header calls the page it is showing. Derived from the
 * services menu — the authoritative feature naming — so the title can never
 * disagree with the rail or ⌘K about what a destination is called, and a new
 * feature gets a title for free. Desktop hides this slot; every route already
 * prints its own heading there.
 *
 * Exported for headerNaming.test.tsx.
 */
export const PAGE_TITLES: Record<string, string> = { dashboard: 'Dashboard' };
for (const group of serviceGroups) {
  for (const [id, label] of group.items) PAGE_TITLES[id] = label;
}
export function pageTitleFor(tab: string): string {
  return PAGE_TITLES[tab] ?? tab.replace(/[-_]/g, ' ').replace(/\b[a-z]/g, (char) => char.toUpperCase());
}

/** How much of the sheet has to be on the glass before it counts as seen. */
const SHEET_SEEN_PX = 96;

/**
 * How much of the services sheet actually sits inside the band the device shows.
 *
 * The sheet is anchored to the bottom of the frame, and on an installed iPhone the
 * bottom of that frame is the one edge nothing agrees on: index.css records that
 * `vh`, `dvh`, `svh`, `-webkit-fill-available` and `visualViewport.height` each
 * report a different height on this device, and the shell's own safe-area band lies
 * *outside* the layout viewport. Any of those readings can drop a bottom-anchored
 * sheet below the glass — which the student reports as tapping More and nothing
 * happening.
 *
 * So the sheet is measured where it landed rather than assumed to be fine. The
 * transform is divided out of the box, because both the opening animation
 * (`ultraccSheetUp` starts one sheet-height below its resting place) and a drag in
 * progress translate it downward without meaning the student cannot see it.
 *
 * Returns `null` when the box cannot be measured, which is how this reads in a DOM
 * test harness: the caller treats it as "no evidence of a problem" and leaves the
 * sheet alone.
 */
function visibleSheetHeight(node: HTMLElement): number | null {
  const rect = node.getBoundingClientRect();
  if (rect.height <= 0) return null;
  let shiftY = 0;
  try {
    const transform = window.getComputedStyle(node).transform;
    if (transform && transform !== 'none') shiftY = new DOMMatrix(transform).m42;
  } catch {
    // No DOMMatrix on this engine: the box already includes the transform, so the
    // worst this can do is read the animated position.
  }
  const top = rect.top - shiftY;
  const bottom = rect.bottom - shiftY;
  const viewport = typeof window.visualViewport !== 'undefined' ? window.visualViewport : null;
  const glassTop = viewport ? viewport.offsetTop : 0;
  const glassBottom = viewport
    ? glassTop + viewport.height
    : typeof window.innerHeight === 'number' ? window.innerHeight : bottom;
  return Math.min(bottom, glassBottom) - Math.max(top, glassTop);
}

/**
 * The box used when the measured landing place is off the glass.
 *
 * `meridian-feature-menu` cannot be kept here: the mobile rules pin it to the very
 * bottom edge that failed, and they are `!important`, so the only way past them is
 * to not ask for them — a class of its own plus an inline box is the only style
 * that beats them without editing index.css under a second session. This box is
 * anchored to the *top* instead, 56px under the app bar, which is the one edge a
 * student proves is on screen every time they read their own name; it scrolls, so
 * the first rows are reachable on any phone.
 */
const SHEET_RESCUE_BOX: React.CSSProperties = {
  position: 'fixed',
  top: 56,
  left: 8,
  right: 8,
  maxHeight: 'calc(100% - 64px)',
  overflowY: 'auto',
  overscrollBehavior: 'contain',
  touchAction: 'pan-y',
  padding: '14px 16px 16px',
  background: 'var(--uc-surface)',
  color: 'var(--uc-ink)',
  border: '1px solid var(--uc-line)',
  borderRadius: 18,
  boxShadow: '0 18px 48px rgba(15,23,42,.28)',
  zIndex: 2,
};

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
  /**
   * What "home" means under the current mode. Both modes answer with the
   * Dashboard: minimal mode's five destinations lead with it, so the wordmark
   * and the rail's first button go to the same screen whichever mode is on —
   * flipping the mode never moves a student off their home screen.
   */
  const homeTab = MINIMAL_LANDING;
  // Desktop rail: compact by default, expandable on demand. The choice is
  // remembered, and navigating collapses it again.
  const [railExpanded, setRailExpanded] = useState<boolean>(() => {
    try { return localStorage.getItem(RAIL_EXPANDED_KEY) === '1'; } catch { return false; }
  });
  const setRail = (expanded: boolean) => {
    setRailExpanded(expanded);
    try { localStorage.setItem(RAIL_EXPANDED_KEY, expanded ? '1' : '0'); } catch { /* storage unavailable */ }
  };
  /**
   * The rail's tooltip, shown only while the rail is collapsed — the state in
   * which the labels are hidden and a name is the only thing a student can get.
   *
   * It is portalled to <body> rather than drawn next to the button: the rail is
   * `overflow: hidden` and its destination list scrolls behind a fade mask, so a
   * tooltip painted inside either would be clipped exactly where it needs to be
   * read. The trigger's own box supplies the y, the rail's width the x, and
   * `pointer-events: none` keeps it from stealing the hover that opened it.
   */
  const [railTip, setRailTip] = useState<{ label: string; top: number } | null>(null);
  const railTipRef = useRef<{ label: string; top: number } | null>(null);
  const showRailTip = (event: React.SyntheticEvent) => {
    if (railExpanded) return;
    const trigger = (event.target as Element | null)?.closest?.('[data-rail-tip]') as HTMLElement | null;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const next = { label: trigger.getAttribute('data-rail-tip') || '', top: Math.round(rect.top + rect.height / 2) };
    const previous = railTipRef.current;
    if (previous && previous.label === next.label && previous.top === next.top) return;
    railTipRef.current = next;
    setRailTip(next);
  };
  const hideRailTip = (event: React.SyntheticEvent) => {
    // Sliding from a control's icon onto its own label is not leaving the control.
    const to = (event as unknown as { relatedTarget?: Element | null }).relatedTarget;
    if (to?.closest?.('[data-rail-tip]')) return;
    railTipRef.current = null;
    setRailTip(null);
  };
  useEffect(() => { if (railExpanded) { railTipRef.current = null; setRailTip(null); } }, [railExpanded]);
  /**
   * Drag-to-dismiss for the More sheet, driven from its header so the sheet's own
   * body keeps the scroll gesture. Pointer events only — `mobileScrollRefresh.test.ts`
   * bans touch handlers in src, and pointer capture survives the finger leaving
   * the header mid-drag.
   */
  const [sheetDragY, setSheetDragY] = useState(0);
  const sheetDrag = useRef<{ startY: number; dy: number } | null>(null);
  const onSheetDragStart = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest('button')) return; // the close button is a tap, not a drag
    sheetDrag.current = { startY: event.clientY, dy: 0 };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onSheetDragMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = sheetDrag.current;
    if (!drag) return;
    drag.dy = Math.max(0, event.clientY - drag.startY);
    setSheetDragY(drag.dy);
  };
  const endSheetDrag = (dismissed: boolean) => {
    const drag = sheetDrag.current;
    if (!drag) return;
    sheetDrag.current = null;
    setSheetDragY(0);
    if (dismissed || drag.dy > 96) setServicesOpen(false);
  };
  /**
   * A drag the browser never finished must not leave the sheet parked where the
   * finger stopped. `endSheetDrag` is the only normal way out, and it is wired to
   * `pointerup`/`pointercancel` on the sheet — both of which iOS is free to withhold
   * (a system gesture, a scroll hijack, the portal unmounting under the pointer).
   * `sheetDragY` lives in the header, not in the sheet, so a value left over is
   * applied to the *next* opening: the student taps More and the sheet renders
   * translated down behind the tab bar, which reads as nothing happening at all.
   *
   * So the release is caught on the window as well as on the handle, and every
   * close clears the gesture whatever ended it. `endSheetDrag` reads the drag out of
   * a ref and only calls stable setters, so holding the first closure is safe.
   */
  useEffect(() => {
    if (!servicesOpen) {
      sheetDrag.current = null;
      setSheetDragY(0);
      return;
    }
    const release = () => endSheetDrag(false);
    const lost = () => endSheetDrag(true);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', lost);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', lost);
    };
  }, [servicesOpen]);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = 'ultracc-services-menu';
  /**
   * Set when the sheet opened somewhere the student cannot see it. Measured once per
   * opening, from the sheet's own landed box, and never re-measured after the rescue
   * takes over — that would only measure the rescue.
   */
  const [sheetRescued, setSheetRescued] = useState(false);
  useEffect(() => {
    if (!servicesOpen) {
      setSheetRescued(false);
      return;
    }
    const node = menuRef.current;
    if (!node) return;
    const seen = visibleSheetHeight(node);
    // `null` is "this engine gave me no box to read". Anything else is a measurement,
    // including a negative one — the sheet drawn entirely above the screen is the
    // failure this was written for.
    if (seen !== null && seen < SHEET_SEEN_PX) setSheetRescued(true);
  }, [servicesOpen]);
  useEffect(() => {
    const close = (event: MouseEvent) => { const target = event.target as Element; if (target.closest('.meridian-more-button') || target.closest(`[aria-controls="${menuId}"]`)) return; if (menuRef.current && !menuRef.current.contains(target)) setServicesOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setServicesOpen(false);
      setHelpOpen(false);
      // Reading the menu's state from a ref keeps this listener stable while
      // still letting Escape return focus to the avatar it opened from.
      if (accountOpenRef.current) {
        setAccountOpen(false);
        accountTriggerRef.current?.focus();
      }
    };
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
  const mobileMoreActive = servicesOpen || moreMenuTabs.includes(activeTab);
  /**
   * The lamp on the mark, as a colour rather than a sentence.
   *
   * It reads the same state the status chip spells out, so the two can never
   * disagree: green is a cache inside its freshness window, amber is data that
   * has aged or a device that is offline, red is a sync that failed, and grey is
   * a student who has not synced yet. The word for whatever it shows is in the
   * tooltip, because a colour alone tells a screen reader nothing.
   */
  const syncLamp = !isOnline
    ? { state: 'stale', title: 'Offline — showing your last synced data' }
    : syncNeedsAttention || syncState?.status === 'error' || syncState?.status === 'partial'
      ? { state: 'off', title: 'Last sync did not finish — tap to try again' }
      : syncState?.lastSyncedAt
        ? isDataStale(syncState.lastSyncedAt)
          ? { state: 'stale', title: `Data is getting old · ${formatUpdatedAt(syncState.lastSyncedAt)}` }
          : { state: 'live', title: `Up to date · ${formatUpdatedAt(syncState.lastSyncedAt)}` }
        : { state: 'idle', title: 'Nothing synced yet — sign in to load your records' };
  // Signed-in = a synced profile exists. Before that, show an explicit "Sign in"
  // call-to-action rather than a generic avatar chip.
  const isSignedIn = Boolean(profileName);
  // Lock body scroll while the mobile bottom-sheet menu is open.
  useEffect(() => {
    if (!servicesOpen) return;
    document.body.classList.add('ultracc-modal-open');
    return () => document.body.classList.remove('ultracc-modal-open');
  }, [servicesOpen]);
  /**
   * The phone header names the page it is showing. See `PAGE_TITLES`.
   */
  const pageTitle = pageTitleFor(activeTab);
  /**
   * The sync dot. One 8px lamp that says the same thing the old text chip did,
   * as a colour with a spoken label — the words are in the tooltip and the
   * accessible name, not printed in the bar.
   */
  const syncDotLabel = isRefreshing ? 'Refreshing your VTOP data' : syncLamp.title;
  /**
   * The account menu holds what used to crowd the bar: the term switcher, the
   * services sheet, refresh and the profile links. It is not a dialog — it is a
   * small popover anchored to the avatar — so it needs no scroll lock and no
   * portal; it closes on click-away, on Escape, and on choosing anything, and
   * Escape hands focus back to the avatar so a keyboard student is never
   * dropped at the top of the page.
   */
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const accountTriggerRef = useRef<HTMLButtonElement>(null);
  const accountOpenRef = useRef(false);
  const accountId = 'ultracc-account-menu';
  const currentSemesterName = semesters.find((semester) => semester.id === selectedSemesterId)?.name ?? '';
  useEffect(() => { accountOpenRef.current = accountOpen; }, [accountOpen]);
  const closeAccount = (returnFocus: boolean) => {
    setAccountOpen(false);
    if (returnFocus) accountTriggerRef.current?.focus();
  };
  const accountItems = () => [
    ...(accountRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"], select') ?? []),
  ].filter((element) => !element.hasAttribute('disabled'));
  const onAccountKeys = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = accountItems();
    if (items.length === 0) return;
    event.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    items[(at + step + items.length) % items.length]?.focus();
  };
  useEffect(() => {
    if (!accountOpen) return;
    accountItems()[0]?.focus();
  }, [accountOpen]);
  useEffect(() => {
    if (!accountOpen) return;
    const onDocDown = (event: MouseEvent) => {
      const target = event.target as Element;
      if (accountRef.current?.contains(target) || target.closest('.meridian-profile')) return;
      setAccountOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [accountOpen]);
  /**
   * The hairline under the bar inks in only once the page has moved. The pixel
   * is reserved (transparent) the whole time, so nothing reflows when it
   * appears — and the bar is opaque, never blurred: a filtered ancestor becomes
   * the containing block for every `position: fixed` sheet opened from inside
   * it, which is exactly the bug that got the More sheet portalled to <body>.
   */
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  // The sync bar is the shell's only "something is happening" signal: one
  // hairline on the top edge of the window that exists only while a sync is
  // open. When the app is quiet it is invisible, so there is nothing on screen
  // that a student could mistake for work that never finishes.
  return <>
    <div
      className={`uc-sync-bar ${isRefreshing ? 'is-on' : ''}`}
      role="progressbar"
      aria-hidden={!isRefreshing}
      aria-label={isRefreshing ? 'Syncing your VTOP data' : undefined}
    >
      <i aria-hidden="true" />
    </div>
    <aside className={`meridian-rail ${railExpanded ? 'expanded' : ''}`} onMouseOver={showRailTip} onMouseOut={hideRailTip} onFocus={showRailTip} onBlur={hideRailTip}>
      {/*
       * The rail head: the wordmark and the collapse toggle, one block above the
       * destination list. The mark is a plain accent plate — the sync state it
       * used to dot there is spoken in this button's tooltip and painted on the
       * app bar, where a colour can be read rather than guessed at from 9px.
       */}
      <div className="meridian-rail-head">
        <button className="meridian-logo" data-rail-tip={syncLamp.title} onClick={() => go(homeTab)} aria-label={`UltraCC. ${syncLamp.title}`}>
          <span className="meridian-logo-mark" aria-hidden="true">U</span>
          <span className="meridian-logo-word"><strong>UltraCC</strong><small>VIT Chennai</small></span>
        </button>
        <button
          type="button"
          className="meridian-rail-toggle"
          onClick={() => setRail(railStateAfter(railExpanded, 'toggle'))}
          aria-expanded={railExpanded}
          aria-controls="ultracc-rail-nav"
          aria-label={railExpanded ? 'Collapse navigation' : 'Expand navigation'}
          data-rail-tip={railExpanded ? 'Collapse navigation' : 'Expand navigation'}
        >
          {railExpanded ? <PanelLeftClose size={17} aria-hidden="true" /> : <PanelLeftOpen size={17} aria-hidden="true" />}
          <span>{railExpanded ? 'Collapse' : 'Expand'}</span>
        </button>
      </div>
      <nav id="ultracc-rail-nav" className="portal-sidebar-nav" aria-label="University portal navigation" onScroll={hideRailTip}>
        {/* The rail's own Dashboard button, not the wordmark — and the wordmark
            goes here too. Minimal mode keeps the dashboard among its five, so
            the row is drawn in both modes rather than left as a hole where the
            mode's home screen used to be. */}
        <button className={isPrimaryActive('dashboard') ? 'active' : ''} aria-current={isPrimaryActive('dashboard') ? 'page' : undefined} data-rail-tip="Dashboard" aria-label="Dashboard" onClick={() => go('dashboard')}><LayoutDashboard size={18} strokeWidth={1.8} /><span>Dashboard</span></button>
        {visibleNavGroups.map((group) => <section className="portal-nav-group" key={group.title}><h2>{group.title}</h2>{group.items.map(([id, Icon, label]) => <button key={id} className={isPrimaryActive(id) ? 'active' : ''} aria-current={isPrimaryActive(id) ? 'page' : undefined} data-rail-tip={label} aria-label={label} onClick={() => go(id)}><Icon size={18} strokeWidth={1.8} /><span>{label}</span></button>)}</section>)}
      </nav>
      <div className="meridian-rail-bottom"><button type="button" className={`meridian-help-button ${helpOpen ? 'open' : ''}`} data-rail-tip="Help" aria-label="Help and keyboard shortcuts" aria-expanded={helpOpen} onClick={() => { setServicesOpen(false); setHelpOpen((value) => !value); }}><HelpCircle size={18} strokeWidth={1.8} /><span>Help</span></button><button data-rail-tip="Settings" aria-label="Settings" onClick={onOpenSettings}><SlidersHorizontal size={18} strokeWidth={1.8} /><span>Settings</span></button>{isSignedIn ? <button className="meridian-avatar meridian-profile-row" data-rail-tip="Open your profile" onClick={() => go('my-info')} aria-label="Open your profile"><ProfilePhoto name={profileName} src={profilePhotoUrl} size="sm" className="profile-dot" /><span className="meridian-avatar-name"><b>{profileName}</b><small>Student</small></span></button> : <button data-rail-tip="Sign in to VTOP" aria-label="Sign in to VTOP" onClick={onOpenLogin}><LogIn size={18} strokeWidth={1.8} /><span>Sign in</span></button>}</div>
    </aside>
    <header className={`meridian-header ${scrolled ? 'is-scrolled' : ''}`}>
      {/* Phone only: the page you are on. Desktop hides this slot — the rail
          already carries the wordmark and every route prints its own heading. */}
      <div className="meridian-brand"><strong>{pageTitle}</strong></div>
      <button className="meridian-search" onClick={onOpenCommandCenter} aria-label="Search"><Search size={16} aria-hidden="true" /><span>Search courses, faculty, rooms, services…</span><kbd>{SEARCH_SHORTCUT}</kbd></button>
      <div className="meridian-actions">
        <button type="button" className={`icon-button meridian-status ${isRefreshing ? 'is-syncing' : ''}`} data-state={syncLamp.state} title={syncDotLabel} aria-label={isRefreshing ? syncDotLabel : `Refresh now — ${syncLamp.title}`} onClick={() => void onManualRefresh?.()} disabled={isRefreshing}><i className="meridian-status-dot" aria-hidden="true" /><RefreshCw className="meridian-status-refresh" size={19} strokeWidth={1.9} aria-hidden="true" /></button>
        <NotificationBell assignments={notificationData?.assignments ?? []} attendance={notificationData?.attendance ?? []} exams={notificationData?.exams ?? []} marks={notificationData?.marks ?? []} timetable={notificationData?.timetable ?? []} backgroundPush={backgroundPush} />
        {isSignedIn
          ? <button ref={accountTriggerRef} type="button" className={`meridian-profile ${accountOpen ? 'open' : ''}`} onClick={() => setAccountOpen((value) => !value)} onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); setAccountOpen(true); } }} aria-haspopup="menu" aria-expanded={accountOpen} aria-controls={accountId} aria-label="Account and settings"><ProfilePhoto name={profileName} src={profilePhotoUrl} size="sm" className="profile-dot" /><span className="meridian-profile-name">{profileName}<small>Student</small></span><span aria-hidden="true">⌄</span></button>
          : <button className="meridian-signin" onClick={onOpenLogin} aria-label="Sign in to VTOP"><LogIn size={15} strokeWidth={1.8} aria-hidden="true" /><span>Sign in</span></button>}
      </div>
      {accountOpen && isSignedIn && <div className={`meridian-account-menu ${accountOpen ? 'is-open' : ''}`} id={accountId} ref={accountRef} aria-label="Account and settings" onKeyDown={onAccountKeys}>
        <div className="meridian-account-id"><strong>{profileName}</strong><small>Student</small></div>
        {semesters.length > 0 && onSemesterChange && <label className={`meridian-account-term ${semesterSwitching ? 'is-switching' : ''}`} title={currentSemesterName ? `Change academic semester — currently ${currentSemesterName}` : 'Change academic semester'}><span>Term</span><select value={selectedSemesterId} onChange={(event) => void onSemesterChange(event.target.value)} disabled={semesterSwitching} aria-label={currentSemesterName ? `Academic semester — currently ${currentSemesterName}` : 'Academic semester'}>{semesters.map((semester) => <option key={semester.id} value={semester.id}>{compactTermLabel(semester.name)}{semester.isCurrent ? ' · Active' : ''}</option>)}</select>{semesterSwitching ? <RefreshCw size={13} className="animate-spin" aria-hidden="true" /> : <span aria-hidden="true">⌄</span>}</label>}
        <div className="meridian-account-links" role="menu" aria-label="Account actions">
          <button type="button" role="menuitem" onClick={() => { closeAccount(false); setServicesOpen(true); }}>Student services</button>
          <button type="button" role="menuitem" disabled={isRefreshing} onClick={() => { closeAccount(false); void onManualRefresh?.(); }}>{isRefreshing ? 'Refreshing…' : 'Sync & refresh'}</button>
          <button type="button" role="menuitem" onClick={() => { closeAccount(false); go('my-info'); }}>Your profile</button>
          <button type="button" role="menuitem" onClick={() => { closeAccount(false); onOpenSettings(); }}>Settings</button>
        </div>
      </div>}
    </header>
    {/*
     * The services sheet cannot live inside <header>.
     *
     * The app bar paints with `backdrop-filter: blur(14px) saturate(150%)`, and a
     * filtered ancestor becomes the containing block for every `position: fixed`
     * descendant. index.css then measures the sheet’s `bottom: calc(var(--uc-bar-h)
     * + 2px)` against a 60px-tall box, so a 754px menu lands at y = -767: the phone
     * student taps More, the sheet opens, and nothing on screen changes. Same story
     * for the scrim, which dimmed the app bar instead of the page.
     *
     * Portalling to <body> lets those coordinates mean what they say. The wrapper
     * owns the stacking (z-index 70 — the ceiling the pinned overlay classes already
     * use, above the app bar at 60 and the tab bar at 59); the sheet and scrim keep
     * their own 2 and 1, which only have to order correctly inside it.
     *
     * The wrapper is `inset: 0` and deliberately carries no viewport unit. index.css
     * pins `<html>`, `<body>` and `#root` to the same fixed frame and forbids the
     * document from scrolling, so a pinned box here is the same box the shell was
     * measured in — while `100dvh` in an installed app reports the space left after
     * the safe-area inset (WebKit 254868) and would stop this layer short of the
     * bottom edge the sheet is measured from.
     *
     * Landing is still not trusted: the sheet is measured once per opening, and if
     * what is left of it on the glass is a strip rather than a menu it swaps to
     * `SHEET_RESCUE_BOX`, which hangs from the top of the frame instead of leaning
     * on the bottom edge no phone and no browser agree on.
     */}
    {servicesOpen && createPortal(<div className="meridian-feature-layer" style={{ position: 'fixed', inset: 0, zIndex: 70 }}>
      <div className="meridian-feature-scrim" onClick={() => setServicesOpen(false)} aria-hidden="true" />
      <div id={menuId} ref={menuRef} className={sheetRescued ? 'meridian-feature-rescue' : 'meridian-feature-menu'} role="group" aria-label="University services" style={sheetRescued ? (sheetDragY ? { ...SHEET_RESCUE_BOX, transform: `translateY(${sheetDragY}px)`, transition: 'none' } : SHEET_RESCUE_BOX) : (sheetDragY ? { transform: `translateY(${sheetDragY}px)`, transition: 'none' } : undefined)}><div className="feature-menu-title" onPointerDown={onSheetDragStart} onPointerMove={onSheetDragMove} onPointerUp={() => endSheetDrag(false)} onPointerCancel={() => endSheetDrag(true)}><span>University services</span><small>Academic and campus access</small><button type="button" className="feature-menu-close" onClick={() => setServicesOpen(false)} aria-label="Close services menu"><X size={18} /></button></div><div className="feature-menu-groups">{visibleServiceGroups.map(group => <section key={group.title}><h3>{group.title}</h3>{group.items.map(([id, label]) => <button type="button" className={activeTab === id ? 'selected' : ''} key={id} onClick={() => go(id)}>{label}<span aria-hidden="true">→</span></button>)}</section>)}</div></div>
    </div>, document.body)}
    {/* Help panel: keyboard shortcuts and setup pointers. */}
    {helpOpen && <div className="meridian-help-panel" role="dialog" aria-label="Help and keyboard shortcuts" style={{ left: railExpanded ? 244 : 84 }}>
      <div className="help-panel-head"><strong>Help</strong><button type="button" onClick={() => setHelpOpen(false)} aria-label="Close help"><X size={16} /></button></div>
      <div className="help-panel-body">
        <div className="help-row"><kbd>{SEARCH_SHORTCUT}</kbd><span><b>Search everything</b>Courses, faculty, rooms, exams and every screen.</span></div>
        <div className="help-row"><kbd>Esc</kbd><span><b>Close overlays</b>Menus, dialogs and search all dismiss with it.</span></div>
        <div className="help-row"><LogIn size={14} aria-hidden="true" /><span><b>Sign in to sync</b>Attendance, marks and timetable come from your VTOP account.</span></div>
        <div className="help-row"><Smartphone size={14} aria-hidden="true" /><span><b>Install for reminders</b>Add UltraCC to your home screen so class and quiz alerts arrive.</span></div>
      </div>
      <div className="help-panel-foot">
        <a href="https://github.com/TGFUKAUSIK/UltraCC" target="_blank" rel="noreferrer noopener">Project &amp; setup docs</a>
        <button type="button" onClick={onOpenSettings}>Open settings</button>
      </div>
    </div>}
    {/* The collapsed rail's tooltip. Portalled to <body> so no rail overflow clips it. */}
    {railTip && !railExpanded && createPortal(
      <div className="meridian-rail-tip" role="tooltip" style={{ top: railTip.top }}>{railTip.label}</div>,
      document.body,
    )}
    <nav className="mobile-tab-bar" aria-label="Mobile navigation">
      {mode === 'minimal' ? (
        /*
         * Minimal mode's five destinations, in the order a student reaches for
         * them: the board they open the app on, what is my attendance, what are
         * my marks, who is my proctor, and settings. Five, because that is what
         * a bottom bar is — a full-width row of destinations — and because the
         * Dashboard is the screen every mode starts on. There is no More button
         * because there is nothing left for it to hold: every destination the
         * mode offers is already here, which is also why the services sheet
         * (still reachable from the account menu and the desktop rail) narrows
         * to the same set.
         */
        <>
          <button type="button" className={activeTab === 'dashboard' ? 'active' : ''} aria-current={activeTab === 'dashboard' ? 'page' : undefined} onClick={() => go('dashboard')} aria-label="Home"><LayoutDashboard size={19} strokeWidth={1.9} /><span>Home</span></button>
          <button type="button" className={activeTab === 'academics' ? 'active' : ''} aria-current={activeTab === 'academics' ? 'page' : undefined} onClick={() => go('academics')} aria-label="Attendance"><GraduationCap size={19} strokeWidth={1.9} /><span>Attendance</span></button>
          <button type="button" className={activeTab === 'grades' ? 'active' : ''} aria-current={activeTab === 'grades' ? 'page' : undefined} onClick={() => go('grades')} aria-label="Marks & Grades"><Table2 size={19} strokeWidth={1.9} /><span>Marks</span></button>
          <button type="button" className={activeTab === 'faculty' ? 'active' : ''} aria-current={activeTab === 'faculty' ? 'page' : undefined} onClick={() => go('faculty')} aria-label="Faculty & Proctor"><Users size={19} strokeWidth={1.9} /><span>Proctor</span></button>
          <button type="button" onClick={onOpenSettings} aria-label="Settings"><SlidersHorizontal size={19} strokeWidth={1.9} /><span>Settings</span></button>
        </>
      ) : (
        <>
          <button type="button" className={activeTab === 'dashboard' ? 'active' : ''} aria-current={activeTab === 'dashboard' ? 'page' : undefined} onClick={() => go('dashboard')} aria-label="Home"><LayoutDashboard size={19} strokeWidth={1.9} /><span>Home</span></button>
          <button type="button" className={activeTab === 'timetable' ? 'active' : ''} aria-current={activeTab === 'timetable' ? 'page' : undefined} onClick={() => go('timetable')} aria-label="Timetable"><CalendarDays size={19} strokeWidth={1.9} /><span>Timetable</span></button>
          <button type="button" className={ACADEMICS_BAR_TABS.includes(activeTab) ? 'active' : ''} aria-current={ACADEMICS_BAR_TABS.includes(activeTab) ? 'page' : undefined} onClick={() => go('academics')} aria-label="Academics"><GraduationCap size={19} strokeWidth={1.9} /><span>Academics</span></button>
          <button type="button" className={GRADES_BAR_TABS.includes(activeTab) ? 'active' : ''} aria-current={GRADES_BAR_TABS.includes(activeTab) ? 'page' : undefined} onClick={() => go('grades')} aria-label="Marks & Grades"><Table2 size={19} strokeWidth={1.9} /><span>Marks</span></button>
          <button type="button" className={mobileMoreActive ? 'active' : ''} onClick={() => { setHelpOpen(false); setServicesOpen(value => !value); }} aria-label={servicesOpen ? 'Close more menu' : 'More'} aria-expanded={servicesOpen} aria-controls={menuId}><MoreHorizontal size={19} strokeWidth={1.9} /><span>More</span></button>
        </>
      )}
    </nav>
  </>;
};

// Alias retained for existing imports.
export const MeridianHeader = UltraCCHeader;
