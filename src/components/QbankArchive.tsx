import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Bookmark, CheckCircle2, ChevronLeft, Circle, ExternalLink,
  FileText, Loader2, RefreshCw, Search, X, ZoomIn,
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
 * Every paper here is one Postgres row, so the shelf is a catalogue: one ruled
 * row per paper, the file tile at the left, the course code leading the line,
 * and the study actions on a compact rail at the right edge. Search and the two
 * axes a student actually thinks in (exam, year) sit in one band above the
 * ledger; the rest of the facets are menus in the same band. Nothing here is a
 * card with a hero.
 *
 * The list is paged at ARCHIVE_PAGE_SIZE rows and filtered server-side, so the
 * biggest payload this page can produce is one page of metadata plus one facets
 * call — the archive's 3.1k rows are never pulled to be filtered in a tab.
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
  const moreCount = Math.min(
    ARCHIVE_PAGE_SIZE,
    total === null ? ARCHIVE_PAGE_SIZE : Math.max(0, total - papers.length),
  );
  const syncTrouble = Boolean(
    sync && (sync.lastStatus === 'failed' || sync.lastStatus === 'partial' || (sync.papersFailed ?? 0) > 0),
  );

  return (
    <div className="uc-qb-view">
      {/* The band: what the shelf holds, then how it is narrowed. */}
      <section className="uc-plate uc-qb-mast">
        <div className="uc-plate-head">
          <div className="uc-qb-id">
            <span className="uc-cap">Synced archive</span>
            <p className="uc-note">{describeArchiveStatus(sync)}</p>
          </div>
          <div className="uc-qb-rail">
            <button
              onClick={() => setSavedOnly((v) => !v)}
              aria-pressed={savedOnly}
              className={`uc-qb-keep${savedOnly ? ' is-on' : ''}`}
            >
              <Bookmark className={`h-4 w-4${savedOnly ? ' fill-current' : ''}`} />
              Saved{bookmarks.size > 0 ? ` (${bookmarks.size})` : ''}
            </button>
            <button
              onClick={() => { void load('reset'); }}
              className="uc-qb-act"
              title="Reload this list from the archive"
            >
              <RefreshCw className={`h-4 w-4${loading ? ' animate-spin' : ''}`} /> Refresh
            </button>
          </div>
        </div>

        <div className="uc-qb-tools">
          <div className="uc-qb-search">
            <Search className="h-4 w-4" />
            <input
              role="searchbox"
              aria-label="Search papers by course code or subject name"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search course code or subject, e.g. CSE2009 or Calculus"
            />
            {searchInput && (
              <button
                onClick={() => setSearchInput('')}
                aria-label="Clear search"
                className="uc-qb-x min-h-[44px] min-w-[44px]"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <label className="sr-only" htmlFor="pyq-sort">Sort papers</label>
          <select
            id="pyq-sort"
            className="uc-qb-select"
            value={sort}
            onChange={(e) => setSort(e.target.value === 'code' ? 'code' : 'recent')}
          >
            <option value="recent">Newest in archive</option>
            <option value="code">Course code A–Z</option>
          </select>
        </div>

        {facets && (
          <div className="uc-qb-facets">
            <FacetChips label="Exam" kind="examType" values={sortFacet(facets.examType, 'examType')} active={filters.examType} onPick={setFacet} />
            <FacetChips label="Year" kind="year" values={sortFacet(facets.year, 'year')} active={filters.year} onPick={setFacet} />
            <div className="uc-qb-frow">
              <span className="uc-qb-flabel">More</span>
              <FacetSelect kind="semester" label="Semester" values={sortFacet(facets.semester, 'other')} active={filters.semester} onPick={setFacet} />
              <FacetSelect kind="slot" label="Slot" values={sortFacet(facets.slot, 'other')} active={filters.slot} onPick={setFacet} />
              <FacetSelect kind="campus" label="Campus" values={sortFacet(facets.campus, 'other')} active={filters.campus} onPick={setFacet} />
              {(activeCount > 0 || !filtersAreEmpty(filters)) && (
                <button onClick={clearAll} className="uc-qb-clear">
                  <X className="h-3.5 w-3.5" /> Clear filters
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      {searchInput.trim() && !searchIsUsable(searchInput) && (
        <div className="uc-qb-hint" role="status">
          <span>
            Type at least two characters — a one-letter search over {sync?.papers?.toLocaleString() ?? 'thousands of'} papers matches almost all of them.
          </span>
        </div>
      )}

      {/* A bad import is news, not a broken page: the rows already in Postgres
          are untouched by it, and saying so is the difference between a warning
          and a student thinking the archive is gone. */}
      {syncTrouble && sync && (
        <div className="uc-qb-alert" role="status">
          <AlertTriangle className="h-4 w-4" />
          <span>
            The last archive update finished as “{sync.lastStatus}”
            {sync.papersFailed ? `, with ${sync.papersFailed} paper${sync.papersFailed === 1 ? '' : 's'} not written` : ''}
            . {sync.papers?.toLocaleString() ?? 'The'} papers already here are unchanged.
          </span>
        </div>
      )}

      {error && (
        <div className="uc-qb-alert" role="alert">
          <AlertTriangle className="h-4 w-4" />
          <span>{error}</span>
          <button onClick={() => void load('reset')} className="uc-qb-clear">Try again</button>
        </div>
      )}

      {savedOnly && !loading && (
        <div className="uc-qb-hint" role="status">
          <span>
            {bookmarks.size === 0
              ? 'No saved papers yet — tap the bookmark on any paper to keep it here.'
              : 'Saved papers are kept on this device only, so signing out on another device will not show them.'}
          </span>
        </div>
      )}

      {loading ? (
        <section className="uc-plate uc-qb-ledger">
          <div className="uc-qb-loading"><Loader2 className="h-4 w-4 animate-spin" /> Loading papers…</div>
        </section>
      ) : papers.length === 0 && !error ? (
        <section className="uc-plate uc-qb-blank">
          <div className="uc-empty">
            <span>
              <b>{savedOnly ? 'Nothing saved yet' : 'No papers match these filters'}</b>{' '}
              {savedOnly
                ? 'Bookmark a paper and it will wait for you here, on this device.'
                : 'The archive has thousands of papers, so this combination is probably too narrow. Try removing one filter.'}
            </span>
            <button onClick={clearAll} className="uc-qb-clear"><X className="h-3.5 w-3.5" /> Clear filters</button>
          </div>
        </section>
      ) : (
        <section className="uc-plate uc-qb-ledger">
          {papers.map((paper) => (
            <ArchiveRow
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
          <div className="uc-plate-foot">
            <span aria-live="polite">{showingText}</span>
            {hasMore && (
              <button onClick={() => void load('more')} disabled={loadingMore} className="uc-qb-clear">
                {loadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronLeft className="h-3.5 w-3.5 -rotate-90" />}
                Load {moreCount} more
              </button>
            )}
          </div>
        </section>
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
    <div className="uc-qb-frow" role="group" aria-label={`${label} filters`}>
      <span className="uc-qb-flabel">{label}</span>
      {values.map((v) => (
        <button
          key={v.value}
          onClick={() => onPick(kind, v.value)}
          aria-pressed={active === v.value}
          className={`uc-qb-chip${active === v.value ? ' is-on' : ''}`}
        >
          {v.value}
          <i className="uc-num">{v.papers.toLocaleString()}</i>
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
      className="uc-qb-select"
    >
      <option value="">{label}: all</option>
      {values.map((v) => (
        <option key={v.value} value={v.value}>{v.value} ({v.papers.toLocaleString()})</option>
      ))}
    </select>
  );
}

/** One paper: a file tile, the code and its tags, the title, and an action rail. */
function ArchiveRow({ paper, bookmarked, solved, onOpen, onOpenCourse, onToggleBookmark, onToggleSolved }: {
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
  const kind = (paper.file_type || '').toUpperCase();
  const title = archivePaperTitle(paper);
  return (
    <div className={`uc-qb-doc${solved ? ' is-solved' : ''}`}>
      <span className="uc-qb-file" aria-hidden="true">
        <FileText className="h-4 w-4" />
        {kind && <small>{kind}</small>}
      </span>
      <div className="uc-qb-main">
        <div className="uc-qb-top">
          {paper.course_code ? (
            <button
              onClick={() => onOpenCourse(paper.course_code as string)}
              className="uc-qb-code is-link"
              title={`All ${paper.course_code} papers in the archive`}
            >
              {paper.course_code}
            </button>
          ) : (
            <span className="uc-qb-code">No course code</span>
          )}
          {paper.answer_key_included === true && (
            <span className="uc-qb-tag" title="The source marks an answer key as included with this paper">Key incl.</span>
          )}
        </div>
        <button onClick={onOpen} className="uc-qb-doc-name">{title}</button>
        {meta.length > 0 && <p className="uc-qb-doc-meta">{meta.join(' · ')}</p>}
        {added && <p className="uc-qb-doc-meta">{added}</p>}
      </div>
      <div className="uc-qb-acts">
        <button
          onClick={onToggleBookmark}
          aria-pressed={bookmarked}
          aria-label={bookmarked ? `Remove bookmark from ${title}` : `Bookmark ${title}`}
          className="uc-qb-ico"
        >
          <Bookmark className={`h-4 w-4${bookmarked ? ' fill-current' : ''}`} />
        </button>
        <button
          onClick={onToggleSolved}
          aria-pressed={solved}
          aria-label={solved ? `Mark ${title} unsolved` : `Mark ${title} solved`}
          className={`uc-qb-ico${solved ? ' is-done' : ''}`}
        >
          {solved ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
        </button>
        <button onClick={onOpen} className="uc-qb-open">
          <FileText className="h-3.5 w-3.5" /><span>Open</span>
        </button>
      </div>
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
  const solvedCount = set.items.filter((i) => i.solved).length;

  return (
    <div className="uc-qb-view">
      <div className="uc-qb-bar">
        <button className="uc-qb-back" onClick={onBack}>
          <ChevronLeft className="h-4 w-4" /> All papers
        </button>
      </div>

      {state.status === 'loading' && (
        <section className="uc-plate uc-qb-ledger">
          <div className="uc-qb-loading"><Loader2 className="h-4 w-4 animate-spin" /> Collecting this course&rsquo;s papers…</div>
        </section>
      )}

      {state.status === 'error' && (
        <div className="uc-qb-alert" role="alert">
          <AlertTriangle className="h-4 w-4" />
          <span>{state.message}</span>
          <button onClick={onBack} className="uc-qb-clear">Back to search</button>
        </div>
      )}

      {state.status === 'ready' && (
        <>
          <section className="uc-plate uc-qb-paper">
            <div className="uc-qb-paper-top">
              <div className="uc-qb-paper-id">
                <span className="uc-cap">Practice set</span>
                <h2 className="uc-qb-paper-name uc-num">{courseCode}</h2>
                {title && <p className="uc-note">{title}</p>}
              </div>
              <span className="uc-qb-file" aria-hidden="true"><FileText className="h-4 w-4" /></span>
            </div>

            {progress && (
              <>
                <div className="uc-qb-progress">
                  <span>Practice progress</span>
                  <span className="uc-num">{progress.done}/{progress.total} solved</span>
                </div>
                <div className="uc-meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}>
                  <i style={{ width: `${progress.percent}%` }} />
                </div>
              </>
            )}

            <div className="uc-qb-frow">
              <span className="uc-qb-chip uc-qb-chip--static">
                {set.items.length} paper{set.items.length === 1 ? '' : 's'}
              </span>
              {solvedCount > 0 && (
                <span className="uc-qb-chip uc-qb-chip--static is-good">{solvedCount} solved</span>
              )}
              {state.capped && (
                <span className="uc-qb-chip uc-qb-chip--static is-warn">
                  Showing the first {state.papers.length} — this course has more than we list here
                </span>
              )}
            </div>

            {set.items.length > 1 && (
              <label className="uc-qb-check">
                <input
                  type="checkbox"
                  checked={showSolved}
                  onChange={(e) => setShowSolved(e.target.checked)}
                />
                Include papers you have marked solved
              </label>
            )}
          </section>

          <section className="uc-plate uc-qb-ledger">
            {visible.length === 0 && (
              <div className="uc-qb-loading">Every paper here is marked solved. Re-enable “Include papers you have marked solved” to review them.</div>
            )}
            {unsolvedFirst(visible).map(({ paper, solved: isSolved }) => (
              <div key={paper.id} className={`uc-qb-doc${isSolved ? ' is-solved' : ''}`}>
                <span className="uc-qb-file" aria-hidden="true"><FileText className="h-4 w-4" /></span>
                <div className="uc-qb-main">
                  <div className="uc-qb-top">
                    <span className="uc-qb-code">{courseCode}</span>
                    {isSolved && <span className="uc-qb-tag">Solved</span>}
                  </div>
                  <button className="uc-qb-doc-name" onClick={() => onOpenPaper(paper)}>{archivePaperTitle(paper)}</button>
                  <p className="uc-qb-doc-meta">{archiveMetaLine(paper).join(' · ')}</p>
                </div>
                <div className="uc-qb-acts">
                  <button
                    onClick={() => onToggleBookmark(paper.external_paper_id)}
                    aria-pressed={bookmarks.has(paper.external_paper_id)}
                    aria-label={bookmarks.has(paper.external_paper_id) ? `Remove bookmark from ${archivePaperTitle(paper)}` : `Bookmark ${archivePaperTitle(paper)}`}
                    className="uc-qb-ico"
                  >
                    <Bookmark className={`h-4 w-4${bookmarks.has(paper.external_paper_id) ? ' fill-current' : ''}`} />
                  </button>
                  <button
                    onClick={() => onToggleSolved(paper.external_paper_id)}
                    aria-pressed={isSolved}
                    aria-label={isSolved ? `Mark ${archivePaperTitle(paper)} unsolved` : `Mark ${archivePaperTitle(paper)} solved`}
                    className={`uc-qb-ico${isSolved ? ' is-done' : ''}`}
                  >
                    {isSolved ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
                  </button>
                  <button className="uc-qb-open" onClick={() => onOpenPaper(paper)}>
                    <FileText className="h-3.5 w-3.5" /><span>Open</span>
                  </button>
                </div>
              </div>
            ))}
            <div className="uc-plate-foot">
              <span>Practice set for <span className="uc-num">{courseCode}</span></span>
            </div>
          </section>
        </>
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
  const code = paper.course_code;

  return (
    <div className="uc-qb-view">
      <div className="uc-qb-bar">
        <button onClick={onBack} className="uc-qb-back">
          <ChevronLeft className="h-4 w-4" /> Back to papers
        </button>
        <div className="uc-qb-rail">
          <button
            onClick={onToggleBookmark}
            aria-pressed={bookmarked}
            className={`uc-qb-keep${bookmarked ? ' is-on' : ''}`}
          >
            <Bookmark className={`h-4 w-4${bookmarked ? ' fill-current' : ''}`} /> {bookmarked ? 'Saved' : 'Save'}
          </button>
          <button
            onClick={onToggleSolved}
            aria-pressed={solved}
            className={`uc-qb-keep${solved ? ' is-done' : ''}`}
          >
            {solved ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-4 w-4" />} {solved ? 'Solved' : 'Mark solved'}
          </button>
        </div>
      </div>

      <section className="uc-plate uc-qb-paper">
        <div className="uc-qb-paper-top">
          <div className="uc-qb-paper-id">
            <div className="uc-qb-chips">
              {code ? (
                <button
                  onClick={() => onOpenCourse(code)}
                  className="uc-qb-code is-link"
                  title={`All ${code} papers`}
                >
                  {code}
                </button>
              ) : (
                <span className="uc-qb-code">No course code</span>
              )}
              {meta.map((m) => (
                <span key={m} className="uc-qb-chip uc-qb-chip--static">{m}</span>
              ))}
            </div>
            <h2 className="uc-qb-paper-name">{archivePaperTitle(paper)}</h2>
            {added && <p className="uc-note">{added}</p>}
          </div>
          <span className="uc-qb-file" aria-hidden="true">
            {embeddable ? <ZoomIn className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
          </span>
        </div>
      </section>

      {/* The file itself. */}
      <section className="uc-plate uc-qb-viewer">
        <div className="uc-qb-viewer-bar">
          <div className="uc-qb-viewer-id">
            {embeddable ? <ZoomIn className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
            <span>{embeddable ? 'Paper preview' : 'This file is not a PDF UltraCC can preview'}</span>
          </div>
          <div className="uc-qb-viewer-acts">
            {embeddable && !narrow && (
              <div className="uc-qb-heights" role="group" aria-label="Preview height">
                {(['compact', 'tall', 'full'] as ViewerHeight[]).map((h) => (
                  <button
                    key={h}
                    onClick={() => setHeight(h)}
                    aria-pressed={height === h}
                    className={height === h ? 'is-on' : undefined}
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
              className="uc-qb-open"
            >
              <ExternalLink className="h-3.5 w-3.5" /><span>Open paper</span>
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
          <div className="uc-qb-nopdf">
            <FileText className="h-7 w-7" />
            <b>Open this paper at the source</b>
            <p>
              UltraCC only previews PDF files. {paper.file_type ? `This one is recorded as ${paper.file_type.toUpperCase()}.` : 'Its type is not recorded.'}
            </p>
          </div>
        )}
      </section>

      {/* Honest answer-key line: the source publishes a boolean, never a link. */}
      <section className="uc-plate uc-plate--quiet">
        <span className="uc-cap">Answer key</span>
        <p className="uc-note">
          {paper.answer_key_included === true
            ? 'The source marks an answer key as included with this paper. It is part of the file itself — no separate key link is published, and UltraCC does not guess one.'
            : paper.answer_key_included === false
              ? 'No answer key is published for this paper.'
              : 'The source does not say whether an answer key exists for this paper.'}
        </p>
      </section>

      {code && (
        <button
          className="uc-qb-act acc-bg"
          onClick={() => onOpenCourse(code)}
          title="Open this course's full paper list as a practice set"
        >
          <CheckCircle2 className="h-4 w-4" /> Practice all {code} papers
        </button>
      )}

      {related.length > 0 && (
        <section className="uc-plate uc-plate--quiet">
          <span className="uc-cap">More {code} papers</span>
          <div className="uc-qb-chips">
            {related.map((r) => (
              <button key={r.id} className="uc-qb-chip" onClick={() => onOpenPaper(r)}>
                {archiveMetaLine(r).join(' · ') || archivePaperTitle(r)}
              </button>
            ))}
          </div>
        </section>
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
 * The escape button carries the same 44px target as every other phone control.
 */
function PaperFrame({ url, height, title, onOpen, narrow }: {
  url: string; height: string; title: string; onOpen: () => void; narrow: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => setLoaded(false), [url]);

  return (
    <div className="uc-qb-frame" style={{ height }}>
      {!loaded && (
        <div className="uc-qb-frame-msg">
          <div>
            <Loader2 className="h-6 w-6 animate-spin mx-auto" />
            <p>
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
        className="uc-qb-iframe"
      />
      {/* Always available, because a viewer that silently refuses to render is
          the failure mode students would otherwise blame themselves for. */}
      {!loaded && (
        <button
          onClick={onOpen}
          className="uc-qb-act acc-bg uc-qb-frame-fallback"
        >
          <ExternalLink className="h-3.5 w-3.5" /> Open paper instead
        </button>
      )}
    </div>
  );
}
