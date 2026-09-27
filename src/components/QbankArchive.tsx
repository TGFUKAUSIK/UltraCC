import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Bookmark, CheckCircle2, ChevronLeft, Circle, ExternalLink,
  FileText, Filter, Loader2, RefreshCw, Search, X, ZoomIn,
} from 'lucide-react';
import {
  ARCHIVE_PAGE_SIZE, ArchiveUnavailableError, EMPTY_FILTERS,
  archiveAddedLine, archiveMetaLine, archivePaperTitle,
  describeArchiveStatus, fetchArchiveCoursePapers, fetchArchiveFacets,
  fetchArchivePapersByKeys, fetchArchivePage, fetchArchiveStatus, fetchRelatedPapers,
  filterKeyForFacet, filtersAreEmpty, searchIsUsable, sortFacet,
  type ArchiveFacets, type ArchiveFilters, type ArchivePaper, type ArchiveSort,
  type ArchiveStatus, type FacetKind, type FacetValue,
} from '../lib/qbankArchive';
import {
  buildArchivePracticeSet, getArchiveBookmarks, getArchiveSolved,
  practiceProgress, toggleArchiveBookmark, toggleArchiveSolved, unsolvedFirst,
} from '../utils/qbankStudy';

/**
 * QbankArchive — the synced previous-year-paper archive inside Q-Bank.
 *
 * This is the browse/detail/practice half of the same Q-Bank page the community
 * shelf lives on (see QbankView): one route, one set of study state, one
 * workflow (Course → Papers → Paper → Practice → Bookmarks). It is NOT a second
 * question bank, and it never renders until the student chooses the archive.
 *
 * Every paper here is one Postgres row. The list is paged at
 * ARCHIVE_PAGE_SIZE rows and filtered server-side, so the biggest payload this
 * page can produce is one page of metadata plus one facets call — the archive's
 * 3.1k rows are never pulled to be filtered in a browser tab.
 *
 * Papers are opened, not downloaded: PaperFrame embeds the source's own link and
 * "Open paper" hands the file over to the browser, because the storage hosts
 * that serve these PDFs allow-list CodeChef's own origin for CORS — a fetch from
 * this tab would fail even though the link works.
 */
export const QbankArchive: React.FC = () => {
  const [facets, setFacets] = useState<ArchiveFacets | null>(null);
  const [sync, setSync] = useState<ArchiveStatus | null>(null);
  const [filters, setFilters] = useState<ArchiveFilters>(EMPTY_FILTERS);
  const [searchInput, setSearchInput] = useState('');
  const [sort, setSort] = useState<ArchiveSort>('recent');
  const [savedOnly, setSavedOnly] = useState(false);

  const [papers, setPapers] = useState<ArchivePaper[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [bookmarks, setBookmarks] = useState<Set<string>>(() => getArchiveBookmarks());
  const [solved, setSolved] = useState<Set<string>>(() => getArchiveSolved());
  const [openCourse, setOpenCourse] = useState<string | null>(null);
  const [openPaper, setOpenPaper] = useState<ArchivePaper | null>(null);

  // Stale-response guard: filters change while a request is in flight, and the
  // slower answer must never overwrite the newer one.
  const seq = useRef(0);
  const controller = useRef<AbortController | null>(null);

  // Typing must not become one request per keystroke against the shared
  // database. 350 ms of quiet is what a pause between words looks like.
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => (f.search === searchInput ? f : { ...f, search: searchInput }));
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(async (mode: 'reset' | 'more') => {
    const my = ++seq.current;
    controller.current?.abort();
    const ac = new AbortController();
    controller.current = ac;
    if (mode === 'reset') {
      setLoading(true);
      setError(null);
    } else setLoadingMore(true);

    try {
      if (savedOnly) {
        const rows = await fetchArchivePapersByKeys(Array.from(bookmarks), undefined, ac.signal);
        if (my !== seq.current) return;
        setPapers(mode === 'reset' ? rows : [...papers, ...rows]);
        setTotal(rows.length);
        setOffset(0);
        setHasMore(false);
        setError(null);
      } else {
        const base = mode === 'reset' ? 0 : offset;
        const page = await fetchArchivePage(
          { filters, sort, limit: ARCHIVE_PAGE_SIZE, offset: base },
          ac.signal,
        );
        if (my !== seq.current) return;
        setPapers(mode === 'reset' ? page.papers : [...papers, ...page.papers]);
        setTotal(page.total);
        setOffset(base + page.papers.length);
        setHasMore(page.hasMore);
        setError(null);
      }
    } catch (err) {
      if (ac.signal.aborted || my !== seq.current) return;
      setPapers(mode === 'reset' ? [] : papers);
      setError(
        err instanceof ArchiveUnavailableError
          ? err.message
          : 'The paper archive could not be read just now.',
      );
    } finally {
      if (my === seq.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
    // `papers`/`offset` are read for the append case only; listing them as
    // dependencies would restart the effect on its own state update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, sort, savedOnly, bookmarks, offset]);

  useEffect(() => {
    void load('reset');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, sort, savedOnly]);

  useEffect(() => {
    let alive = true;
    const ac = new AbortController();
    void (async () => {
      // Facets and sync status answer "what is in here, and how current is it"
      // — two small aggregates, fetched once per visit, not once per page.
      const [f, s] = await Promise.all([fetchArchiveFacets(ac.signal), fetchArchiveStatus(ac.signal)]);
      if (!alive) return;
      setFacets(f);
      setSync(s);
    })();
    return () => {
      alive = false;
      ac.abort();
    };
  }, []);

  useEffect(() => () => controller.current?.abort(), []);

  const activeCount = useMemo(() => {
    const chips = [filters.examType, filters.year, filters.semester, filters.slot, filters.campus];
    return chips.filter(Boolean).length + (filters.courseCode ? 1 : 0);
  }, [filters]);

  const clearAll = () => {
    setSearchInput('');
    setFilters(EMPTY_FILTERS);
    setSavedOnly(false);
  };

  const setFacet = (kind: FacetKind, value: string) => {
    const key = filterKeyForFacet(kind);
    setFilters((f) => ({ ...f, [key]: f[key] === value ? '' : value }));
  };

  // ---- Paper detail (Course → Papers → Paper) -----------------------------
  if (openPaper) {
    return (
      <PaperDetail
        paper={openPaper}
        bookmarked={bookmarks.has(openPaper.external_paper_id)}
        solved={solved.has(openPaper.external_paper_id)}
        onBack={() => setOpenPaper(null)}
        onOpenCourse={(code) => {
          setOpenPaper(null);
          setFilters((f) => ({ ...f, courseCode: code }));
        }}
        onOpenPaper={setOpenPaper}
        onToggleBookmark={() => setBookmarks(new Set(toggleArchiveBookmark(openPaper.external_paper_id)))}
        onToggleSolved={() => setSolved(new Set(toggleArchiveSolved(openPaper.external_paper_id)))}
      />
    );
  }

  // ---- One course's papers as a practice set ------------------------------
  if (filters.courseCode) {
    return (
      <CoursePapers
        courseCode={filters.courseCode}
        solved={solved}
        bookmarks={bookmarks}
        onBack={() => setFilters((f) => ({ ...f, courseCode: '' }))}
        onOpenPaper={setOpenPaper}
        onToggleBookmark={(key) => setBookmarks(new Set(toggleArchiveBookmark(key)))}
        onToggleSolved={(key) => setSolved(new Set(toggleArchiveSolved(key)))}
      />
    );
  }

  const showingText = total === null
    ? `Showing ${papers.length} paper${papers.length === 1 ? '' : 's'}`
    : `Showing ${papers.length} of ${total.toLocaleString()} matching papers`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-2xl font-extrabold text-zinc-900 tracking-tight">Previous year papers</h2>
          <p className="text-sm text-zinc-500 font-medium mt-1">
            {describeArchiveStatus(sync)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSavedOnly((v) => !v)}
            aria-pressed={savedOnly}
            className={`min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-xl border text-xs font-bold transition cursor-pointer ${savedOnly ? 'acc-soft acc-text acc-border' : 'bg-white border-zinc-200 text-zinc-600 hover:border-zinc-300'}`}
          >
            <Bookmark className={`h-4 w-4 ${savedOnly ? 'fill-current' : ''}`} />
            Saved{bookmarks.size > 0 ? ` (${bookmarks.size})` : ''}
          </button>
          <button
            onClick={() => { void load('reset'); }}
            className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-xl border border-zinc-200 bg-white text-xs font-bold text-zinc-600 hover:border-zinc-300 transition cursor-pointer"
            title="Reload this list from the archive"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      {/* Search + sort */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
          <input
            role="searchbox"
            aria-label="Search papers by course code or subject name"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search course code or subject, e.g. CSE2009 or Calculus"
            className="w-full pl-9 pr-9 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-900 placeholder-zinc-500 outline-none focus:border-blue-500/60 transition"
          />
          {searchInput && (
            <button
              onClick={() => setSearchInput('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-zinc-500 hover:bg-zinc-100 cursor-pointer min-h-[32px] min-w-[32px]"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <label className="sr-only" htmlFor="pyq-sort">Sort papers</label>
        <select
          id="pyq-sort"
          value={sort}
          onChange={(e) => setSort(e.target.value === 'code' ? 'code' : 'recent')}
          className="px-3 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-900 outline-none focus:border-blue-500/60 cursor-pointer"
        >
          <option value="recent">Newest in archive</option>
          <option value="code">Course code A–Z</option>
        </select>
      </div>

      {searchInput.trim() && !searchIsUsable(searchInput) && (
        <p className="text-[11px] text-zinc-500" role="status">
          Type at least two characters — a one-letter search over {sync?.papers?.toLocaleString() ?? 'thousands of'} papers matches almost all of them.
        </p>
      )}

      {/* Facets: exam and year as chips (the two students actually think in),
          the rest as compact selects so five filter rows never stack up. */}
      {facets && (
        <div className="space-y-2">
          <FacetChips label="Exam" kind="examType" values={sortFacet(facets.examType, 'examType')} active={filters.examType} onPick={setFacet} />
          <FacetChips label="Year" kind="year" values={sortFacet(facets.year, 'year')} active={filters.year} onPick={setFacet} />
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
              <Filter className="h-3.5 w-3.5" /> More
            </span>
            <FacetSelect kind="semester" label="Semester" values={sortFacet(facets.semester, 'other')} active={filters.semester} onPick={setFacet} />
            <FacetSelect kind="slot" label="Slot" values={sortFacet(facets.slot, 'other')} active={filters.slot} onPick={setFacet} />
            <FacetSelect kind="campus" label="Campus" values={sortFacet(facets.campus, 'other')} active={filters.campus} onPick={setFacet} />
            {(activeCount > 0 || !filtersAreEmpty(filters)) && (
              <button
                onClick={clearAll}
                className="min-h-[36px] inline-flex items-center gap-1 px-2.5 rounded-lg border border-zinc-200 bg-white text-[11px] font-bold text-zinc-600 hover:border-zinc-300 transition cursor-pointer"
              >
                <X className="h-3.5 w-3.5" /> Clear filters
              </button>
            )}
          </div>
        </div>
      )}

      {/* A bad import is news, not a broken page: the rows already in Postgres
          are untouched by it, and saying so is the difference between a warning
          and a student thinking the archive is gone. */}
      {sync && (sync.lastStatus === 'failed' || sync.lastStatus === 'partial' || (sync.papersFailed ?? 0) > 0) && (
        <div className="flex flex-wrap items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/25 rounded-xl text-[11px] text-amber-800" role="status">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="flex-1 min-w-[14rem]">
            The last archive update finished as “{sync.lastStatus}”
            {sync.papersFailed ? `, with ${sync.papersFailed} paper${sync.papersFailed === 1 ? '' : 's'} not written` : ''}
            . {sync.papers?.toLocaleString() ?? 'The'} papers already here are unchanged.
          </span>
        </div>
      )}

      {error && (
        <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-800 text-xs flex flex-wrap items-center gap-2" role="alert">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="flex-1 min-w-[12rem]">{error}</span>
          <button
            onClick={() => void load('reset')}
            className="min-h-[36px] px-3 rounded-lg bg-white border border-amber-500/30 text-[11px] font-bold text-amber-800 hover:bg-amber-50 cursor-pointer"
          >
            Try again
          </button>
        </div>
      )}

      {savedOnly && !loading && (
        <p className="text-[11px] text-zinc-500" role="status">
          {bookmarks.size === 0
            ? 'No saved papers yet — tap the bookmark on any paper to keep it here.'
            : `Saved papers are kept on this device only, so signing out on another device will not show them.`}
        </p>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-zinc-500">
          <Loader2 className="h-6 w-6 animate-spin mr-3" />
          <span className="text-sm font-medium">Loading papers…</span>
        </div>
      ) : papers.length === 0 && !error ? (
        <EmptyArchive
          title={savedOnly ? 'Nothing saved yet' : 'No papers match these filters'}
          body={savedOnly
            ? 'Bookmark a paper and it will wait for you here, on this device.'
            : 'The archive has thousands of papers, so this combination is probably too narrow. Try removing one filter.'}
          onClear={clearAll}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {papers.map((paper) => (
              <ArchiveCard
                key={paper.id}
                paper={paper}
                bookmarked={bookmarks.has(paper.external_paper_id)}
                solved={solved.has(paper.external_paper_id)}
                onOpen={() => setOpenPaper(paper)}
                onOpenCourse={(code) => setFilters((f) => ({ ...f, courseCode: code }))}
                onToggleBookmark={() => setBookmarks(new Set(toggleArchiveBookmark(paper.external_paper_id)))}
                onToggleSolved={() => setSolved(new Set(toggleArchiveSolved(paper.external_paper_id)))}
              />
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[11px] text-zinc-500" aria-live="polite">{showingText}</p>
            {hasMore && (
              <button
                onClick={() => void load('more')}
                disabled={loadingMore}
                className="min-h-[44px] inline-flex items-center gap-2 px-4 rounded-xl border border-zinc-200 bg-white text-xs font-bold text-zinc-900 hover:border-zinc-300 transition cursor-pointer disabled:opacity-50"
              >
                {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronLeft className="h-4 w-4 -rotate-90" />}
                Load {Math.min(ARCHIVE_PAGE_SIZE, total === null ? ARCHIVE_PAGE_SIZE : Math.max(0, total - papers.length))} more
              </button>
            )}
          </div>
        </>
      )}

    </div>
  );
};

// ---------------------------------------------------------------------------
// Browse pieces
// ---------------------------------------------------------------------------

function FacetChips({ label, kind, values, active, onPick }: {
  label: string;
  kind: FacetKind;
  values: FacetValue[];
  active: string;
  onPick: (kind: FacetKind, value: string) => void;
}) {
  if (values.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`${label} filters`}>
      <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 w-11 shrink-0">{label}</span>
      {values.map((v) => (
        <button
          key={v.value}
          onClick={() => onPick(kind, v.value)}
          aria-pressed={active === v.value}
          className={`min-h-[36px] px-3 rounded-xl border text-[11px] font-bold transition cursor-pointer ${active === v.value ? 'acc-soft acc-text acc-border' : 'bg-white border-zinc-200 text-zinc-600 hover:border-zinc-300'}`}
        >
          {v.value}
          <span className="text-zinc-400 font-semibold ml-1 tabular-nums">{v.papers.toLocaleString()}</span>
        </button>
      ))}
    </div>
  );
}

function FacetSelect({ kind, label, values, active, onPick }: {
  kind: FacetKind;
  label: string;
  values: FacetValue[];
  active: string;
  onPick: (kind: FacetKind, value: string) => void;
}) {
  if (values.length === 0) return null;
  return (
    <select
      aria-label={`Filter by ${label.toLowerCase()}`}
      value={active}
      onChange={(e) => onPick(kind, e.target.value)}
      className="min-h-[36px] px-2.5 py-1.5 bg-white border border-zinc-200 rounded-xl text-[11px] font-bold text-zinc-700 outline-none focus:border-blue-500/60 cursor-pointer"
    >
      <option value="">{label}: all</option>
      {values.map((v) => (
        <option key={v.value} value={v.value}>{v.value} ({v.papers.toLocaleString()})</option>
      ))}
    </select>
  );
}

function ArchiveCard({ paper, bookmarked, solved, onOpen, onOpenCourse, onToggleBookmark, onToggleSolved }: {
  key?: React.Key;
  paper: ArchivePaper;
  bookmarked: boolean;
  solved: boolean;
  onOpen: () => void;
  onOpenCourse: (code: string) => void;
  onToggleBookmark: () => void;
  onToggleSolved: () => void;
}) {
  const meta = archiveMetaLine(paper);
  const added = archiveAddedLine(paper);
  return (
    <div className={`bg-white border rounded-3xl p-5 flex flex-col gap-2 transition hover:border-zinc-300 ${solved ? 'border-emerald-500/30' : 'border-zinc-200'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {paper.course_code ? (
            <button
              onClick={() => onOpenCourse(paper.course_code as string)}
              className="font-mono font-bold text-zinc-900 text-sm hover:underline cursor-pointer"
              title={`All ${paper.course_code} papers in the archive`}
            >
              {paper.course_code}
            </button>
          ) : (
            <p className="font-mono font-bold text-zinc-500 text-sm">No course code</p>
          )}
          {paper.course_title && <p className="text-[11px] text-zinc-500 truncate mt-0.5">{paper.course_title}</p>}
        </div>
        <button
          onClick={onToggleBookmark}
          aria-label={bookmarked ? `Remove bookmark from ${archivePaperTitle(paper)}` : `Bookmark ${archivePaperTitle(paper)}`}
          aria-pressed={bookmarked}
          className={`shrink-0 min-h-[44px] min-w-[44px] grid place-items-center rounded-xl transition cursor-pointer ${bookmarked ? 'text-amber-600 bg-amber-500/10' : 'text-zinc-500 hover:text-amber-600 hover:bg-amber-500/10'}`}
        >
          <Bookmark className={`h-4 w-4 ${bookmarked ? 'fill-current' : ''}`} />
        </button>
      </div>

      <button onClick={onOpen} className="text-left cursor-pointer group min-w-0">
        <p className="text-sm text-zinc-900 font-semibold leading-snug group-hover:underline">
          {archivePaperTitle(paper)}
        </p>
      </button>

      {meta.length > 0 && <p className="text-[10px] text-zinc-500">{meta.join(' · ')}</p>}
      {added && <p className="text-[10px] text-zinc-400">{added}</p>}

      <div className="mt-auto pt-2 flex items-center justify-between gap-2">
        <button
          onClick={onToggleSolved}
          aria-pressed={solved}
          className={`inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-xl text-[11px] font-bold border transition cursor-pointer ${solved ? 'bg-emerald-500/10 text-emerald-700 border-emerald-500/25' : 'bg-white text-zinc-600 border-zinc-200 hover:text-emerald-700'}`}
        >
          {solved ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
          {solved ? 'Solved' : 'Mark solved'}
        </button>
        <div className="flex items-center gap-1.5">
          {paper.answer_key_included === true && (
            <span className="text-[10px] font-bold px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-700 border border-emerald-500/25" title="The source marks an answer key as included with this paper">
              Key incl.
            </span>
          )}
          <button
            onClick={onOpen}
            className="inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-xl acc-soft acc-text border acc-border text-[11px] font-bold hover:opacity-90 transition cursor-pointer"
          >
            <FileText className="h-3.5 w-3.5" /> Open
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyArchive({ title, body, onClear }: { title: string; body: string; onClear: () => void }) {
  return (
    <div className="p-10 bg-white border border-zinc-200 rounded-3xl text-center">
      <FileText className="h-8 w-8 text-zinc-500 mx-auto mb-2" />
      <p className="text-sm font-bold text-zinc-900">{title}</p>
      <p className="text-[11px] text-zinc-500 mt-1 max-w-sm mx-auto">{body}</p>
      <button
        onClick={onClear}
        className="mt-3 inline-flex items-center gap-1 min-h-[44px] px-3 rounded-xl bg-white border border-zinc-200 text-[11px] font-bold text-zinc-900 hover:border-zinc-300 transition cursor-pointer"
      >
        <X className="h-3.5 w-3.5" /> Clear filters
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Course → Papers → Practice
// ---------------------------------------------------------------------------

function CoursePapers({ courseCode, solved, bookmarks, onBack, onOpenPaper, onToggleBookmark, onToggleSolved }: {
  courseCode: string;
  solved: ReadonlySet<string>;
  bookmarks: ReadonlySet<string>;
  onBack: () => void;
  onOpenPaper: (paper: ArchivePaper) => void;
  onToggleBookmark: (key: string) => void;
  onToggleSolved: (key: string) => void;
}) {
  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'error'; papers: ArchivePaper[]; capped: boolean; message: string | null }>({
    status: 'loading', papers: [], capped: false, message: null,
  });
  const [showSolved, setShowSolved] = useState(true);

  useEffect(() => {
    let alive = true;
    const ac = new AbortController();
    setState({ status: 'loading', papers: [], capped: false, message: null });
    void fetchArchiveCoursePapers(courseCode, ac.signal).then(
      (rows) => { if (alive) setState({ status: 'ready', papers: rows.papers, capped: rows.capped, message: null }); },
      (err) => {
        if (!alive) return;
        setState({
          status: 'error', papers: [], capped: false,
          message: err instanceof ArchiveUnavailableError ? err.message : 'These papers could not be loaded.',
        });
      },
    );
    return () => { alive = false; ac.abort(); };
  }, [courseCode]);

  const set = useMemo(
    () => buildArchivePracticeSet(courseCode, state.papers, solved),
    [courseCode, state.papers, solved],
  );
  const progress = practiceProgress(set);
  const visible = useMemo(
    () => (showSolved ? set.items : set.items.filter((i) => !i.solved)),
    [set.items, showSolved],
  );
  const title = state.papers[0]?.course_title || state.papers[0]?.title || null;

  return (
    <div className="space-y-5">
      <button
        onClick={onBack}
        className="min-h-[44px] inline-flex items-center gap-1.5 text-xs font-bold text-zinc-500 hover:text-zinc-900 transition cursor-pointer"
      >
        <ChevronLeft className="h-4 w-4" /> All papers
      </button>

      <div className="bg-white border border-zinc-200 rounded-3xl p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-2xl acc-soft acc-text border acc-border shrink-0"><FileText className="h-6 w-6" /></div>
          <div className="min-w-0">
            <h2 className="text-xl font-extrabold text-zinc-900 tracking-tight font-mono">{courseCode}</h2>
            {title && <p className="text-xs text-zinc-500 font-medium mt-0.5">{title}</p>}
          </div>
        </div>

        {state.status === 'loading' && (
          <div className="mt-5 flex items-center gap-2 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Collecting this course&rsquo;s papers…
          </div>
        )}
        {state.status === 'error' && (
          <div className="mt-5 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-800 text-xs flex flex-wrap items-center gap-2" role="alert">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="flex-1 min-w-[12rem]">{state.message}</span>
            <button onClick={onBack} className="min-h-[36px] px-3 rounded-lg bg-white border border-amber-500/30 text-[11px] font-bold text-amber-800 cursor-pointer">
              Back to search
            </button>
          </div>
        )}
        {state.status === 'ready' && (
          <>
            {progress && (
              <div className="mt-4">
                <div className="flex items-center justify-between text-[11px] text-zinc-500 font-bold">
                  <span>Practice progress</span>
                  <span className="tabular-nums">{progress.done}/{progress.total} solved</span>
                </div>
                <div className="mt-1.5 h-2 rounded-full bg-zinc-100 overflow-hidden">
                  <div className="h-full acc-bg rounded-full transition-all" style={{ width: `${progress.percent}%` }} />
                </div>
              </div>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-white text-zinc-700 border border-zinc-200 tabular-nums">
                {set.items.length} paper{set.items.length === 1 ? '' : 's'}
              </span>
              {state.capped && (
                <span className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-800 border border-amber-500/25">
                  Showing the first {state.papers.length} — this course has more than we list here
                </span>
              )}
            </div>
            {set.items.length > 1 && (
              <label className="mt-4 inline-flex items-center gap-2 text-[11px] font-bold text-zinc-600 cursor-pointer min-h-[44px]">
                <input
                  type="checkbox"
                  checked={showSolved}
                  onChange={(e) => setShowSolved(e.target.checked)}
                  className="h-4 w-4 rounded border-zinc-300 acc-accent"
                />
                Include papers you have marked solved
              </label>
            )}
          </>
        )}
      </div>

      {state.status === 'ready' && (
        <div className="space-y-3">
          {visible.length === 0 && (
            <p className="text-xs text-zinc-500">
              Every paper here is marked solved. Re-enable “Include papers you have marked solved” to review them.
            </p>
          )}
          {unsolvedFirst(visible).map(({ paper, solved: isSolved }) => (
            <div key={paper.id} className={`bg-white border rounded-2xl p-4 flex flex-wrap items-center gap-3 ${isSolved ? 'border-emerald-500/25' : 'border-zinc-200'}`}>
              <div className="min-w-0 flex-1">
                <button onClick={() => onOpenPaper(paper)} className="text-left cursor-pointer">
                  <p className="text-sm font-semibold text-zinc-900 hover:underline">{archivePaperTitle(paper)}</p>
                </button>
                <p className="text-[10px] text-zinc-500 mt-0.5">{archiveMetaLine(paper).join(' · ')}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => onToggleBookmark(paper.external_paper_id)}
                  aria-pressed={bookmarks.has(paper.external_paper_id)}
                  aria-label={bookmarks.has(paper.external_paper_id) ? 'Remove bookmark' : 'Bookmark this paper'}
                  className={`min-h-[44px] min-w-[44px] grid place-items-center rounded-xl cursor-pointer ${bookmarks.has(paper.external_paper_id) ? 'text-amber-600 bg-amber-500/10' : 'text-zinc-500 hover:text-amber-600 hover:bg-amber-500/10'}`}
                >
                  <Bookmark className={`h-4 w-4 ${bookmarks.has(paper.external_paper_id) ? 'fill-current' : ''}`} />
                </button>
                <button
                  onClick={() => onToggleSolved(paper.external_paper_id)}
                  aria-pressed={isSolved}
                  className={`inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-xl text-[11px] font-bold border cursor-pointer ${isSolved ? 'bg-emerald-500/10 text-emerald-700 border-emerald-500/25' : 'bg-white text-zinc-600 border-zinc-200'}`}
                >
                  {isSolved ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
                  {isSolved ? 'Solved' : 'Solve'}
                </button>
                <button onClick={() => onOpenPaper(paper)} className="inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-xl acc-soft acc-text border acc-border text-[11px] font-bold cursor-pointer">
                  <FileText className="h-3.5 w-3.5" /> Open
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Paper detail + viewer
// ---------------------------------------------------------------------------

type ViewerHeight = 'compact' | 'tall' | 'full';

const FRAME_HEIGHTS: Record<ViewerHeight, string> = {
  compact: '55vh',
  tall: '75vh',
  full: 'calc(100dvh - 9rem)',
};

/** True on phones and small windows, where an embedded PDF is the worst way to
 *  read a paper and a full-screen open is the right default. */
function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(max-width: 767px)').matches
      : false,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(max-width: 767px)');
    const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches);
    mq.addEventListener('change', onChange);
    setNarrow(mq.matches);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return narrow;
}

function PaperDetail({ paper, bookmarked, solved, onBack, onOpenCourse, onOpenPaper, onToggleBookmark, onToggleSolved }: {
  paper: ArchivePaper;
  bookmarked: boolean;
  solved: boolean;
  onBack: () => void;
  onOpenCourse: (code: string) => void;
  onOpenPaper: (paper: ArchivePaper) => void;
  onToggleBookmark: () => void;
  onToggleSolved: () => void;
}) {
  const [related, setRelated] = useState<ArchivePaper[]>([]);
  const [height, setHeight] = useState<ViewerHeight>('tall');
  const narrow = useIsNarrow();

  useEffect(() => {
    let alive = true;
    const ac = new AbortController();
    setRelated([]);
    const code = (paper.course_code || '').trim();
    if (!code) return () => ac.abort();
    void fetchRelatedPapers(code, paper.id, 6, ac.signal).then((rows) => {
      if (alive) setRelated(rows);
    }, () => { /* related papers are a bonus — never an error state */ });
    return () => { alive = false; ac.abort(); };
  }, [paper.id, paper.course_code]);

  const meta = archiveMetaLine(paper);
  const added = archiveAddedLine(paper);
  const embeddable = (paper.file_type || '').toLowerCase() === 'pdf';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          onClick={onBack}
          className="min-h-[44px] inline-flex items-center gap-1.5 text-xs font-bold text-zinc-500 hover:text-zinc-900 transition cursor-pointer"
        >
          <ChevronLeft className="h-4 w-4" /> Back to papers
        </button>
        <div className="flex items-center gap-1.5">
          <button
            onClick={onToggleBookmark}
            aria-pressed={bookmarked}
            className={`inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-xl border text-[11px] font-bold transition cursor-pointer ${bookmarked ? 'acc-soft acc-text acc-border' : 'bg-white border-zinc-200 text-zinc-600 hover:border-zinc-300'}`}
          >
            <Bookmark className={`h-4 w-4 ${bookmarked ? 'fill-current' : ''}`} /> {bookmarked ? 'Saved' : 'Save'}
          </button>
          <button
            onClick={onToggleSolved}
            aria-pressed={solved}
            className={`inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-xl border text-[11px] font-bold transition cursor-pointer ${solved ? 'bg-emerald-500/10 text-emerald-700 border-emerald-500/25' : 'bg-white text-zinc-600 border-zinc-200 hover:text-emerald-700'}`}
          >
            {solved ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
            {solved ? 'Solved' : 'Mark solved'}
          </button>
        </div>
      </div>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {paper.course_code ? (
            <button
              onClick={() => onOpenCourse(paper.course_code as string)}
              className="font-mono font-bold text-zinc-900 text-lg hover:underline cursor-pointer"
              title={`All ${paper.course_code} papers`}
            >
              {paper.course_code}
            </button>
          ) : (
            <p className="font-mono font-bold text-zinc-500 text-lg">No course code</p>
          )}
          {meta.map((m) => (
            <span key={m} className="text-[10px] font-bold px-2 py-1 rounded-lg bg-white border border-zinc-200 text-zinc-600">{m}</span>
          ))}
        </div>
        <h2 className="text-lg sm:text-xl font-extrabold text-zinc-900 tracking-tight mt-2">{archivePaperTitle(paper)}</h2>
        <p className="text-[11px] text-zinc-500 mt-1">
          {added ?? ''}
        </p>
      </div>

      {/* The file itself. */}
      <div className="bg-white border border-zinc-200 rounded-3xl overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-zinc-200">
          <div className="flex items-center gap-2 min-w-0">
            <ZoomIn className="h-4 w-4 text-zinc-500 shrink-0" />
            <p className="text-[11px] font-bold text-zinc-700 truncate">
              {embeddable ? 'Paper preview' : 'This file is not a PDF UltraCC can preview'}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {embeddable && !narrow && (
              <div className="flex items-center rounded-xl border border-zinc-200 overflow-hidden" role="group" aria-label="Preview height">
                {(['compact', 'tall', 'full'] as ViewerHeight[]).map((h) => (
                  <button
                    key={h}
                    onClick={() => setHeight(h)}
                    aria-pressed={height === h}
                    className={`min-h-[36px] px-2.5 text-[10px] font-bold capitalize transition cursor-pointer ${height === h ? 'acc-soft acc-text' : 'bg-white text-zinc-600 hover:bg-zinc-50'}`}
                  >
                    {h}
                  </button>
                ))}
              </div>
            )}
            <a
              href={paper.paper_url}
              target="_blank"
              rel="noreferrer noopener"
              referrerPolicy="no-referrer"
              className="inline-flex items-center gap-1.5 min-h-[44px] px-3.5 rounded-xl acc-bg text-zinc-900 text-[11px] font-bold hover:opacity-90 transition"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Open paper
            </a>
            {/*
              Deliberately one exit, not two. An extra `download` anchor was
              tried here and removed: the papers live on CodeChef-VIT's storage,
              and browsers ignore the download attribute cross-origin, so it
              would have opened the same tab as “Open paper” while being
              labelled “Save” — the same word the bookmark button two rows up
              already uses for a completely different action. Whatever viewer
              the browser opens the PDF in has its own save control.
            */}
          </div>
        </div>

        {embeddable ? (
          <PaperFrame url={paper.paper_url} height={narrow ? '45vh' : FRAME_HEIGHTS[height]} title={archivePaperTitle(paper)} onOpen={() => window.open(paper.paper_url, '_blank', 'noopener,noreferrer')} narrow={narrow} />
        ) : (
          <div className="p-6 text-center">
            <FileText className="h-8 w-8 text-zinc-400 mx-auto mb-2" />
            <p className="text-sm font-bold text-zinc-900">Open this paper at the source</p>
            <p className="text-[11px] text-zinc-500 mt-1 max-w-sm mx-auto">
              UltraCC only previews PDF files. {paper.file_type ? `This one is recorded as ${paper.file_type.toUpperCase()}.` : 'Its type is not recorded.'}
            </p>
          </div>
        )}
      </div>

      {/* Honest answer-key line: the source publishes a boolean, never a link. */}
      <div className="bg-white border border-zinc-200 rounded-3xl p-4 space-y-1.5">
        <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Answer key</p>
        {paper.answer_key_included === true ? (
          <p className="text-xs text-zinc-700">
            The source marks an answer key as included with this paper. It is part of the file itself — no separate key link is published, and UltraCC does not guess one.
          </p>
        ) : paper.answer_key_included === false ? (
          <p className="text-xs text-zinc-600">No answer key is published for this paper.</p>
        ) : (
          <p className="text-xs text-zinc-600">The source does not say whether an answer key exists for this paper.</p>
        )}
      </div>

      {paper.course_code && (
        <button
          onClick={() => onOpenCourse(paper.course_code as string)}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-2xl acc-soft acc-text border acc-border text-xs font-bold hover:opacity-90 transition cursor-pointer"
          title="Open this course's full paper list as a practice set"
        >
          <CheckCircle2 className="h-4 w-4" /> Practice all {paper.course_code} papers
        </button>
      )}

      {related.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2">More papers for {paper.course_code}</p>
          <div className="flex flex-wrap gap-2">
            {related.map((r) => (
              <button
                key={r.id}
                onClick={() => onOpenPaper(r)}
                className="min-h-[44px] px-3 rounded-xl bg-white border border-zinc-200 text-[11px] font-bold text-zinc-800 hover:border-zinc-300 transition cursor-pointer text-left"
              >
                {archiveMetaLine(r).join(' · ') || archivePaperTitle(r)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Embeds the source's own file with the browser's native viewer.
 *
 * WHY AN IFRAME AND NOT A FETCH: CodeChef-VIT serves papers from storage whose
 * CORS policy names only their own origin, so a browser fetch of the same URL
 * fails even though the URL is public. An iframe needs no CORS at all, and
 * every engine already ships a PDF viewer with page navigation, zoom, search
 * and text selection — which is why no viewer dependency was added.
 *
 * WHAT THIS DOES NOT DO: it cannot control that viewer's toolbar, so page and
 * zoom controls are the browser's own. What UltraCC adds is the frame height,
 * an unambiguous "Open paper" escape, and a plain-language fallback when
 * embedding is refused. A refused embed is shown as such — never a blank panel.
 */
function PaperFrame({ url, height, title, onOpen, narrow }: {
  url: string; height: string; title: string; onOpen: () => void; narrow: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => setLoaded(false), [url]);

  return (
    <div className="relative bg-zinc-50" style={{ height }}>
      {!loaded && (
        <div className="absolute inset-0 grid place-items-center pointer-events-none">
          <div className="text-center">
            <Loader2 className="h-6 w-6 animate-spin mx-auto text-zinc-400" />
            <p className="text-[11px] text-zinc-500 mt-2 max-w-[16rem]">
              {narrow
                ? 'Phone viewers often do better full-screen — “Open paper” above is usually the faster read.'
                : 'Loading the file from the source…'}
            </p>
          </div>
        </div>
      )}
      <iframe
        src={url}
        title={`${title} — paper preview`}
        referrerPolicy="no-referrer"
        onLoad={() => setLoaded(true)}
        className="w-full h-full border-0"
      />
      {/* Always available, because a viewer that silently refuses to render is
          the failure mode students would otherwise blame themselves for. */}
      {!loaded && (
        <button
          onClick={onOpen}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-xl acc-bg text-zinc-900 text-[11px] font-bold shadow-lg cursor-pointer"
        >
          <ExternalLink className="h-3.5 w-3.5" /> Open paper instead
        </button>
      )}
    </div>
  );
}
