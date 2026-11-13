import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, X, BookOpen, MapPin, Calculator, Navigation, Layers, HelpCircle, Briefcase, LayoutDashboard,
} from 'lucide-react';
import { AttendanceRecord, ExamSchedule, CourseMarks, TimetableSlot } from '../types';
import { buildPaletteIndex, searchPalette } from '../lib/commandPalette';
import { useTargetAttendance } from '../lib/attendanceTarget';
import type { FeatureMode } from '../lib/navVisibility';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useDialog } from '../hooks/useDialog';

interface CommandCenterModalProps {
  isOpen: boolean;
  onClose: () => void;
  attendance: AttendanceRecord[];
  exams: ExamSchedule[];
  marks: CourseMarks[];
  timetable: TimetableSlot[];
  onNavigateTab: (tab: string) => void;
  /** Feature mode gates which destinations ⌘K offers. */
  mode?: FeatureMode;
}

const CATEGORY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Course: BookOpen,
  Attendance: Calculator,
  Exam: Layers,
  Marks: Calculator,
  'Go to': MapPin,
};

/** Short, searchable starter queries — every one returns real hits. */
const SUGGESTED_SEARCHES = [
  'bunk', 'CAT seating', 'free lab', 'mess menu', 'placement eligibility', 'ask ai',
];

/** The destinations a student reaches often enough to want one keystroke away. */
const QUICK_ACCESS: { tab: string; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { tab: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { tab: 'academics', label: 'Safe Bunk Calculator', icon: Calculator },
  { tab: 'exams', label: 'CAT Seating & Exams', icon: Layers },
  { tab: 'campus', label: 'Campus Location Finder', icon: MapPin },
  { tab: 'fresher', label: 'Fresher FFCS Guide', icon: HelpCircle },
  { tab: 'placement', label: 'Placement Eligibility', icon: Briefcase },
];

export const CommandCenterModal: React.FC<CommandCenterModalProps> = ({
  isOpen,
  onClose,
  attendance,
  exams,
  marks,
  timetable,
  onNavigateTab,
  mode = 'complete' as FeatureMode,
}) => {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  useBodyScrollLock(isOpen);
  const panelRef = useDialog({ isOpen, onClose });

  // Search reaches REAL synced records: courses, faculty, venues, exams,
  // attendance and marks — rebuilt when the data changes OR when the student
  // moves the attendance bar. This modal mounts once for the whole session, so
  // an index built at mount would otherwise keep quoting the bar from before
  // the slider was touched.
  const [targetAttendance] = useTargetAttendance();
  const paletteIndex = useMemo(
    () => buildPaletteIndex({ timetable, attendance, exams, marks, targetAttendance }, mode),
    [timetable, attendance, exams, marks, mode, targetAttendance],
  );
  const results = useMemo(() => searchPalette(paletteIndex, query), [paletteIndex, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!isOpen) setQuery('');
  }, [isOpen]);

  // Keep the highlighted row visible while arrowing through results.
  useEffect(() => {
    const active = listRef.current?.querySelector<HTMLElement>(`[data-palette-index="${activeIndex}"]`);
    active?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const select = (tab: string) => {
    onNavigateTab(tab);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (results.length ? (i + 1) % results.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[activeIndex]) select(results[activeIndex].tab);
    }
    // Escape closes via the App-level listener.
  };

  if (!isOpen) return null;

  const hasQuery = query.trim().length > 0;

  return (
    <div
      className="uc-scrim mobile-search-shell fixed inset-0 flex items-start justify-center pt-16 sm:pt-24 px-4"
      onKeyDown={handleKeyDown}
      // The backdrop is the largest target in this dialog and used to do
      // nothing. The self-target check means only a click that lands on the
      // overlay dismisses it — never one started inside the panel.
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        ref={panelRef}
        className="mobile-search-panel uc-plate uc-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Search UltraCC"
      >
        {/* Search input bar */}
        <div className="uc-pal-bar">
          <Search aria-hidden="true" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search courses, faculty, rooms, exams, services…"
            autoFocus
            role="combobox"
            aria-expanded={hasQuery}
            aria-controls="ultracc-palette-results"
            aria-activedescendant={hasQuery && results[activeIndex] ? `ultracc-palette-option-${activeIndex}` : undefined}
            aria-label="Search courses, faculty, rooms, exams, services"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} className="uc-dir-ico" aria-label="Clear search" title="Clear search">
              <X aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="mobile-search-close uc-dir-ico"
            aria-label="Close search"
            title="Close search"
          >
            <X aria-hidden="true" />
          </button>
        </div>

        {/* Content */}
        <div className="uc-pal-body">
          {hasQuery ? (
            <div>
              <p className="uc-pal-note" aria-live="polite">
                {results.length > 0 ? `Search results (${results.length})` : 'No matches'}
              </p>
              <div className="uc-pal-list" role="listbox" id="ultracc-palette-results" ref={listRef}>
                {results.map((res, index) => {
                  const Icon = CATEGORY_ICONS[res.category] ?? Navigation;
                  return (
                    <button
                      key={res.id}
                      type="button"
                      id={`ultracc-palette-option-${index}`}
                      data-palette-index={index}
                      role="option"
                      aria-selected={index === activeIndex}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => select(res.tab)}
                      className={`uc-pal-row${index === activeIndex ? ' is-on' : ''}`}
                    >
                      <span className="uc-pal-row-main">
                        <Icon aria-hidden="true" />
                        <span className="uc-pal-row-text">
                          <b>{res.title}</b>
                          <small>{res.subtitle}</small>
                        </span>
                      </span>
                      <span className="uc-pal-row-go">
                        {index === activeIndex
                          ? (<><span className="uc-pal-hide-sm">Open</span> <Navigation aria-hidden="true" /></>)
                          : <span className="uc-dir-tag">{res.category}</span>}
                      </span>
                    </button>
                  );
                })}
                {results.length === 0 && (
                  <div className="uc-pal-blank">
                    <p>Nothing matched <b>“{query}”</b> in your synced data.</p>
                    <div className="uc-chips">
                      {SUGGESTED_SEARCHES.map((s) => (
                        <button key={s} type="button" onClick={() => setQuery(s)}>{s}</button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="uc-pal-home">
              <div>
                <p className="uc-pal-note">Quick access</p>
                <div className="uc-pal-quick">
                  {QUICK_ACCESS.map(({ tab, label, icon: Icon }) => (
                    <button key={tab} type="button" onClick={() => select(tab)}>
                      <Icon aria-hidden="true" />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="uc-pal-note">Suggested searches</p>
                <div className="uc-pal-sug">
                  {SUGGESTED_SEARCHES.map((cmd) => (
                    <button key={cmd} type="button" onClick={() => setQuery(cmd)}>
                      <span>“{cmd}”</span>
                      <span>Try it</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="uc-pal-foot">
          <span>UltraCC Student Portal Search</span>
          <span className="uc-pal-keys">
            <span><kbd>↑↓</kbd> navigate</span>
            <span><kbd>Enter</kbd> open</span>
            <span><kbd>ESC</kbd> exit</span>
          </span>
        </div>
      </div>
    </div>
  );
};
