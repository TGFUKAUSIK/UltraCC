import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, BookOpen, MapPin, Calculator, Sparkles, Navigation, Layers, HelpCircle, Briefcase } from 'lucide-react';
import { AttendanceRecord, ExamSchedule, CourseMarks, TimetableSlot } from '../types';
import { buildPaletteIndex, searchPalette } from '../lib/commandPalette';
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
  // attendance and marks — rebuilt only when the underlying data changes.
  const paletteIndex = useMemo(
    () => buildPaletteIndex({ timetable, attendance, exams, marks }, mode),
    [timetable, attendance, exams, marks, mode],
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
      className="mobile-search-shell fixed inset-0 z-50 flex items-start justify-center pt-16 sm:pt-24 px-4 bg-zinc-50 backdrop-blur-md animate-fadeIn"
      onKeyDown={handleKeyDown}
      // The backdrop is the largest target in this dialog and used to do
      // nothing. The self-target check means only a click that lands on the
      // overlay dismisses it — never one started inside the panel.
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        ref={panelRef}
        className="mobile-search-panel w-full max-w-2xl bg-white border border-zinc-200 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80dvh]"
        role="dialog"
        aria-modal="true"
        aria-label="Search UltraCC"
      >
        {/* Search Input Bar */}
        <div className="relative border-b border-zinc-200 p-4 flex items-center">
          <Search className="h-5 w-5 text-indigo-600 mr-3 shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search courses, faculty, rooms, exams, services…"
            className="w-full bg-transparent text-zinc-900 text-sm sm:text-base placeholder-zinc-500 focus:outline-none"
            autoFocus
            role="combobox"
            aria-expanded={hasQuery}
            aria-controls="ultracc-palette-results"
            aria-activedescendant={hasQuery && results[activeIndex] ? `ultracc-palette-option-${activeIndex}` : undefined}
            aria-label="Search courses, faculty, rooms, exams, services"
          />
          {query && (
            <button onClick={() => setQuery('')} className="p-1 text-zinc-500 hover:text-zinc-900 mr-2" aria-label="Clear search">
              <X className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={onClose}
            className="mobile-search-close p-2 text-zinc-500 hover:text-zinc-900 rounded-lg border border-zinc-200 cursor-pointer"
            aria-label="Close search"
            title="Close search"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Content Area */}
        <div className="p-4 overflow-y-auto space-y-4">
          {hasQuery ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600 mb-2" aria-live="polite">
                {results.length > 0 ? `Search results (${results.length})` : 'No matches'}
              </p>
              <div className="space-y-2" role="listbox" id="ultracc-palette-results" ref={listRef}>
                {results.map((res, index) => {
                  const Icon = CATEGORY_ICONS[res.category] ?? Sparkles;
                  return (
                    <button
                      key={res.id}
                      id={`ultracc-palette-option-${index}`}
                      data-palette-index={index}
                      role="option"
                      aria-selected={index === activeIndex}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => select(res.tab)}
                      className={`w-full text-left p-3 border rounded-xl cursor-pointer transition flex items-center justify-between group ${
                        index === activeIndex
                          ? 'bg-indigo-50 border-indigo-500/50'
                          : 'bg-zinc-100 border-zinc-200 hover:border-indigo-500/50'
                      }`}
                    >
                      <div className="flex items-start space-x-3 min-w-0">
                        <div className="p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-600 shrink-0">
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <h4 className="text-sm font-semibold text-zinc-900 truncate">{res.title}</h4>
                          <p className="text-xs text-zinc-500 mt-0.5 truncate">{res.subtitle}</p>
                        </div>
                      </div>
                      <span className="text-xs text-indigo-600 shrink-0 ml-3 flex items-center gap-1 font-medium">
                        {index === activeIndex ? <><span className="hidden sm:inline">Open</span> <Navigation className="h-3 w-3" /></> : <span className="text-[10px] px-2 py-0.5 rounded bg-white border border-zinc-200 text-zinc-500">{res.category}</span>}
                      </span>
                    </button>
                  );
                })}
                {results.length === 0 && (
                  <div className="p-4 bg-zinc-100 border border-zinc-200 rounded-xl text-xs text-zinc-500 space-y-2">
                    <p>Nothing matched <strong className="text-zinc-900">“{query}”</strong> in your synced data.</p>
                    <div className="flex flex-wrap gap-1.5">
                      {SUGGESTED_SEARCHES.map((s) => (
                        <button key={s} onClick={() => setQuery(s)} className="px-2.5 py-1 rounded-full bg-white border border-zinc-200 text-zinc-900 hover:border-indigo-500/50 text-[11px] cursor-pointer">
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Default Quick Launch & Suggested Commands */
            <div className="space-y-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                Quick access
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <button
                    onClick={() => select('dashboard')}
                    className="p-2.5 bg-zinc-100 hover:bg-zinc-100 border border-zinc-200 rounded-lg text-left text-xs font-medium text-zinc-900 flex items-center space-x-2 cursor-pointer"
                  >
                    <BookOpen className="h-4 w-4 text-indigo-600" />
                    <span>Dashboard</span>
                  </button>
                  <button
                    onClick={() => select('academics')}
                    className="p-2.5 bg-zinc-100 hover:bg-zinc-100 border border-zinc-200 rounded-lg text-left text-xs font-medium text-zinc-900 flex items-center space-x-2 cursor-pointer"
                  >
                    <Calculator className="h-4 w-4 text-emerald-600" />
                    <span>Safe Bunk Calculator</span>
                  </button>
                  <button
                    onClick={() => select('exams')}
                    className="p-2.5 bg-zinc-100 hover:bg-zinc-100 border border-zinc-200 rounded-lg text-left text-xs font-medium text-zinc-900 flex items-center space-x-2 cursor-pointer"
                  >
                    <Layers className="h-4 w-4 text-rose-600" />
                    <span>CAT Seating & Exams</span>
                  </button>
                  <button
                    onClick={() => select('campus')}
                    className="p-2.5 bg-zinc-100 hover:bg-zinc-100 border border-zinc-200 rounded-lg text-left text-xs font-medium text-zinc-900 flex items-center space-x-2 cursor-pointer"
                  >
                    <MapPin className="h-4 w-4 text-amber-600" />
                    <span>Campus Location Finder</span>
                  </button>
                  <button
                    onClick={() => select('fresher')}
                    className="p-2.5 bg-zinc-100 hover:bg-zinc-100 border border-zinc-200 rounded-lg text-left text-xs font-medium text-zinc-900 flex items-center space-x-2 cursor-pointer"
                  >
                    <HelpCircle className="h-4 w-4 text-teal-600" />
                    <span>Fresher FFCS Guide</span>
                  </button>
                  <button
                    onClick={() => select('placement')}
                    className="p-2.5 bg-zinc-100 hover:bg-zinc-100 border border-zinc-200 rounded-lg text-left text-xs font-medium text-zinc-900 flex items-center space-x-2 cursor-pointer"
                  >
                    <Briefcase className="h-4 w-4 text-purple-600" />
                    <span>Placement Eligibility</span>
                  </button>
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                Suggested searches
                </p>
                <div className="space-y-1.5">
                  {SUGGESTED_SEARCHES.map((cmd) => (
                    <button
                      key={cmd}
                      onClick={() => setQuery(cmd)}
                      className="w-full text-left p-2.5 rounded-lg bg-zinc-100 hover:bg-zinc-100 text-xs text-zinc-900 flex items-center justify-between border border-zinc-200 hover:border-zinc-200 transition cursor-pointer"
                    >
                      <span className="font-medium text-zinc-900">“{cmd}”</span>
                      <span className="text-[10px] px-2 py-0.5 rounded bg-white border border-zinc-200 text-zinc-500">
                        Try it
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="p-3 bg-white border-t border-zinc-200 text-zinc-500 text-[11px] flex items-center justify-between">
          <span>UltraCC Student Portal Search</span>
          <span className="flex items-center gap-2">
            <span><kbd className="px-1 py-0.5 bg-zinc-100 rounded border border-zinc-200">↑↓</kbd> navigate</span>
            <span><kbd className="px-1 py-0.5 bg-zinc-100 rounded border border-zinc-200">Enter</kbd> open</span>
            <span><kbd className="px-1 py-0.5 bg-zinc-100 rounded border border-zinc-200">ESC</kbd> exit</span>
          </span>
        </div>
      </div>
    </div>
  );
};
