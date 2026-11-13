/**
 * Student tools — the index.
 *
 * This page is a directory, not a dashboard, so it is composed like the index of
 * a reference book: one masthead, then labelled groups of destinations as
 * compact hairline rows. The old page was a two-column wall of identically
 * weighted cards over a cloud of nineteen corner chips — every destination the
 * same size, no reading order, and no way to tell an academic record from an
 * export button. Rows in a named group can be scanned with one thumb, and a
 * group can grow a row without the layout changing shape.
 *
 * It reuses the board vocabulary the rest of the redesign is built on (.uc-marker,
 * .uc-cap, .uc-plate) so a destination here looks like a destination everywhere
 * else, and it talks about each one the way the rest of the app names it: the
 * labels come from the same authoritative list the rail, the services menu and
 * ⌘K read (see naming.test.ts).
 */
import React from 'react';
import {
  ArrowLeftRight, Bed, BookMarked, BookOpen, BusFront,
  CalendarCheck, CalendarDays, CalendarRange, Car, ChevronRight, ClipboardList,
  Clock, DoorOpen, FlaskConical, GraduationCap, LayoutGrid, LibraryBig,
  ListChecks, MapPinned, Printer, Ticket, UserRound, Users,
} from 'lucide-react';
import { isNavHidden } from '../lib/navVisibility';

/* ── Destinations ──────────────────────────────────────────────────────────── */

interface Destination {
  tab: string;
  title: string;
  detail: string;
  icon: React.ReactNode;
}

/**
 * The record and the planning tools: everything a student opens to look at their
 * own semester. Ordered the way the questions are asked — what am I attending,
 * what did I score, what is coming — so a student who is only here for one of
 * them finds it without reading the rest.
 */
const ACADEMIC_DESTINATIONS: Destination[] = [
  { tab: 'academics', title: 'Attendance', detail: 'Weekly view, predictor and OD hours', icon: <CalendarCheck size={16} /> },
  { tab: 'grades', title: 'Marks & Grades', detail: 'CGPA calculator, what-if and grade predictor', icon: <GraduationCap size={16} /> },
  { tab: 'exams', title: 'Exam Schedule', detail: 'Dates, seat numbers and .ics export', icon: <ClipboardList size={16} /> },
  { tab: 'timetable', title: 'Timetable', detail: 'Your week — image and PDF export', icon: <CalendarDays size={16} /> },
  { tab: 'calendar', title: 'Academic Calendar', detail: 'Holidays, exam windows and .ics export', icon: <CalendarRange size={16} /> },
  { tab: 'lms', title: 'Assignments & Courses', detail: 'Deadlines and course pages from LMS', icon: <Clock size={16} /> },
  { tab: 'ffcs', title: 'FFCS', detail: 'Plan a semester and build the grid', icon: <ListChecks size={16} /> },
];

/**
 * The campus itself and the life around it. Same row shape as Academics, so the
 * page reads as one list with headings rather than two different widgets.
 */
const CAMPUS_DESTINATIONS: Destination[] = [
  { tab: 'freeClassrooms', title: 'Rooms & Labs', detail: 'Free rooms and labs, period by period', icon: <DoorOpen size={16} /> },
  { tab: 'campus-utils', title: 'Campus Facilities', detail: 'Printing and opt-in study groups', icon: <Printer size={16} /> },
  { tab: 'library', title: 'Library', detail: 'Hours, seats and borrowing', icon: <LibraryBig size={16} /> },
  { tab: 'hostel', title: 'Hostel', detail: 'Mess, laundry and hostel notices', icon: <Bed size={16} /> },
  { tab: 'events', title: 'Events', detail: 'What’s on, on campus', icon: <Ticket size={16} /> },
  { tab: 'transport', title: 'Transport', detail: 'Buses and shuttle timings', icon: <BusFront size={16} /> },
  { tab: 'clubs', title: 'Student Communities', detail: 'Clubs, chapters and special teams', icon: <Users size={16} /> },
  { tab: 'cabshare', title: 'Cab Share', detail: 'Find or offer a ride', icon: <Car size={16} /> },
  { tab: 'campus', title: 'Campus Map', detail: 'Find any building on campus', icon: <MapPinned size={16} /> },
];

/**
 * The rest of the app: study material, the advisor, and the student's own
 * account. Named "More" because that is exactly what it is — the same word the
 * phone's bottom bar uses for destinations it cannot hold.
 */
const MORE_DESTINATIONS: Destination[] = [
  { tab: 'qbank', title: 'Question Bank', detail: 'Past exam papers by course', icon: <BookMarked size={16} /> },
  { tab: 'ai-advisor', title: 'AI Advisor', detail: 'Ask about your own numbers', icon: <FlaskConical size={16} /> },
  { tab: 'social', title: 'Timetable Compare', detail: 'Line your grid up with a friend’s', icon: <ArrowLeftRight size={16} /> },
  { tab: 'my-info', title: 'Profile', detail: 'Your VTOP registration details', icon: <UserRound size={16} /> },
  { tab: 'dashboard', title: 'Dashboard', detail: 'What’s on now and next', icon: <LayoutGrid size={16} /> },
];

/* ── Index ─────────────────────────────────────────────────────────────────── */

/** One destination. The whole row is the target, icon to chevron. */
function IndexRow({ icon, title, detail, onClick }: {
  key?: React.Key; icon: React.ReactNode; title: string; detail: string; onClick: () => void;
}) {
  return (
    <button type="button" className="uc-idx-row" onClick={onClick}>
      <span className="uc-marker uc-marker--quiet uc-marker--sm" aria-hidden="true">{icon}</span>
      <span className="uc-idx-main">
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
      <ChevronRight className="uc-idx-cue" size={15} aria-hidden="true" />
    </button>
  );
}

/** A labelled group. The count is the number of rows actually rendered. */
function IndexGroup({ label, count, children }: {
  label: string; count: number; children: React.ReactNode;
}) {
  return (
    <section className="uc-plate uc-idx-group">
      <div className="uc-plate-head">
        <h2 className="uc-cap">{label}</h2>
        <span className="uc-idx-count uc-num">{count}</span>
      </div>
      <div className="uc-idx">{children}</div>
    </section>
  );
}

interface ToolsHubProps {
  onNavigate: (tab: string) => void;
}

export const ToolsHub: React.FC<ToolsHubProps> = ({ onNavigate }) => {
  // Every group is filtered through the one visibility flag, so withdrawing a
  // feature is a single entry in navVisibility.ts and never an edit here.
  const academics = ACADEMIC_DESTINATIONS.filter((item) => !isNavHidden(item.tab));
  const campus = CAMPUS_DESTINATIONS.filter((item) => !isNavHidden(item.tab));
  const more = MORE_DESTINATIONS.filter((item) => !isNavHidden(item.tab));
  const showSyllabus = !isNavHidden('syllabus');

  const row = (item: Destination) => (
    <IndexRow key={item.tab} icon={item.icon} title={item.title} detail={item.detail} onClick={() => onNavigate(item.tab)} />
  );

  return (
    <div className="uc-index">
      <header className="uc-index-mast">
        <span className="uc-cap">Student tools</span>
        <h1 className="uc-hero">All tools</h1>
        <p className="uc-note">Attendance and marks first. Every other screen in UltraCC, grouped below.</p>
      </header>

      <IndexGroup label="Academics" count={academics.length + (showSyllabus ? 1 : 0)}>
        {academics.map(row)}
        {/* Syllabus is withdrawn from navigation for now (see navVisibility.ts);
            the route is unchanged, so this row is the only thing taken out. */}
        {!isNavHidden('syllabus') && (
          <IndexRow icon={<BookOpen size={16} />} title="Syllabus" detail="VTOP’s own file for each course" onClick={() => onNavigate('syllabus')} />
        )}
      </IndexGroup>

      <IndexGroup label="Campus & life" count={campus.length}>
        {campus.map(row)}
      </IndexGroup>

      <IndexGroup label="More" count={more.length}>
        {more.map(row)}
      </IndexGroup>
    </div>
  );
};
