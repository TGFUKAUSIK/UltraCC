import React, { useEffect, useMemo, useState } from 'react';
import {
  FileText, Search, Plus, Loader2, WifiOff, ExternalLink, Trash2, ShieldAlert, Upload,
  Bookmark, CheckCircle2, Circle, Flame, ChevronLeft, GraduationCap, X,
} from 'lucide-react';
import { fetchQnPapers, fetchQnCourses, postQnPaper, deleteQnPaper, makePaperCode, QnPaper } from '../lib/supabaseCommunity';
import { humanErrorCopy } from '../lib/errorCopy';
import {
  canRemovePaper, codesForPaper, consumePaperCode, loadPaperCodeMap, paperKey,
  PaperCodeMap, recordPaperCode, savePaperCodeMap,
} from '../lib/qbankOwnership';
import {
  applyPaperFilters, buildPracticeSet, getBookmarks, getSolved, knownExamTypes,
  paperMetaLine, practiceProgress, recentPapers, toggleBookmark, toggleSolved,
  PracticeSet,
} from '../utils/qbankStudy';
import { QbankArchive } from './QbankArchive';

/**
 * QbankView — the Q-Bank page, and the one place that decides which shelf a
 * student is looking at:
 *
 *   Full archive   the synced CodeChef-VIT previous-year-paper archive
 *                  (pyq_papers via PostgREST — see QbankArchive.tsx).
 *   Student-shared the community board this page has always been: links
 *                  students posted themselves, removable only from the device
 *                  that posted one.
 *
 * One route, one page, one study workflow. The toggle replaces nothing: both
 * shelves keep their own data, their own bookmarks and their own rules, and the
 * choice of which to open with is remembered per device.
 */
export const QbankView: React.FC = () => {
  const [source, setSource] = useState<QbankSource>(readSourceChoice);

  useEffect(() => {
    try {
      localStorage.setItem(SOURCE_KEY, source);
    } catch {
      // storage unavailable — the default is simply remembered until next time
    }
  }, [source]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-1.5 p-1.5 bg-white border border-zinc-200 rounded-2xl" role="tablist" aria-label="Question paper source">
        {([
          ['archive', 'Full archive'],
          ['shared', 'Student-shared'],
        ] as [QbankSource, string][]).map(([value, label]) => (
          <button
            key={value}
            role="tab"
            aria-selected={source === value}
            onClick={() => setSource(value)}
            className={`min-h-[44px] flex-1 basis-auto px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${source === value ? 'acc-bg text-zinc-900' : 'bg-transparent text-zinc-500 hover:bg-zinc-50'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {source === 'archive' ? <QbankArchive /> : <CommunityShelf />}
    </div>
  );
};

type QbankSource = 'archive' | 'shared';
const SOURCE_KEY = 'ultracc.qbank.source';

function readSourceChoice(): QbankSource {
  try {
    return localStorage.getItem(SOURCE_KEY) === 'shared' ? 'shared' : 'archive';
  } catch {
    return 'archive';
  }
}

function CommunityShelf() {
  const [papers, setPapers] = useState<QnPaper[]>([]);
  const [courses, setCourses] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [courseFilter, setCourseFilter] = useState('');
  const [examTypeFilter, setExamTypeFilter] = useState('');
  const [bookmarkFilter, setBookmarkFilter] = useState<boolean | null>(null);
  const [solvedFilter, setSolvedFilter] = useState<boolean | null>(null);
  const [bookmarks, setBookmarks] = useState<Set<number>>(() => getBookmarks());
  const [solved, setSolved] = useState<Set<number>>(() => getSolved());
  const [openCourse, setOpenCourse] = useState<string | null>(null);
  const [showShare, setShowShare] = useState(false);

  const [courseCode, setCourseCode] = useState('');
  const [courseTitle, setCourseTitle] = useState('');
  const [examType, setExamType] = useState('CAT-1');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [uploadedBy, setUploadedBy] = useState('');
  const [sharedNotice, setSharedNotice] = useState('');
  const [sharing, setSharing] = useState(false);
  /** Guards the delete flow so a double-tap cannot spend one code twice. */
  const [removing, setRemoving] = useState(false);
  // Removal codes this device holds (see qbankOwnership.ts). The delete
  // affordance is only offered for papers this device can prove it shared.
  const [ownedCodes, setOwnedCodes] = useState<PaperCodeMap>(() => loadPaperCodeMap());

  const load = async (course?: string) => {
    setLoading(true);
    setError(null);
    try {
      const [p, c] = await Promise.all([fetchQnPapers(course || undefined), fetchQnCourses()]);
      setPapers(p);
      setCourses(c);
    } catch (err) {
      setError(humanErrorCopy(err, 'Could not load the question-paper bank.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(
    () => applyPaperFilters(papers, { query, courseFilter, examType: examTypeFilter, bookmarked: bookmarkFilter, solved: solvedFilter, bookmarks, solvedSet: solved }),
    [papers, query, courseFilter, examTypeFilter, bookmarkFilter, solvedFilter, bookmarks, solved],
  );
  const examTypes = useMemo(() => knownExamTypes(papers), [papers]);
  const recents = useMemo(() => recentPapers(papers).slice(0, 4), [papers]);
  const practiceSet = useMemo(
    () => (openCourse ? buildPracticeSet(openCourse, papers, solved) : null),
    [openCourse, papers, solved],
  );

  const submit = async () => {
    if (!courseCode.trim() || !title.trim() || !url.trim()) return;
    setSharing(true);
    setError(null);
    setSharedNotice('');
    try {
      const paper = {
        course_code: courseCode.trim().toUpperCase(),
        course_title: courseTitle.trim(),
        exam_type: examType,
        title: title.trim(),
        url: url.trim(),
        uploaded_by: uploadedBy.trim() || 'anonymous',
      };
      const code = makePaperCode();
      await postQnPaper({ ...paper, poster_code: code });
      // Bind the removal code to this paper on THIS device only — that is what
      // authorizes removal later (the server still verifies the code).
      const key = paperKey(paper);
      const next = recordPaperCode(ownedCodes, key, code);
      setOwnedCodes(next);
      savePaperCodeMap(next);
      setSharedNotice('Paper shared — only this device can remove it.');
      setCourseCode('');
      setCourseTitle('');
      setTitle('');
      setUrl('');
      setShowShare(false);
      await load(courseFilter || undefined);
    } catch (err) {
      setError(humanErrorCopy(err, 'Could not share the paper.'));
    } finally {
      setSharing(false);
    }
  };

  const remove = async (paper: QnPaper) => {
    // Deleting twice in a row raced: the second call read a code this device
    // had already spent and reported a confusing "could not be removed".
    if (removing) return;
    setError(null);
    const key = paperKey(paper);
    const codes = codesForPaper(ownedCodes, key);
    // No prompt, ever: without a code held on this device there is nothing
    // the user could type that would authorize the delete.
    if (codes.length === 0) {
      setError('Only the device that shared this paper can remove it.');
      return;
    }
    setRemoving(true);
    try {
      for (const code of codes) {
        try {
          const ok = await deleteQnPaper(paper.id, code);
          if (ok) {
            const next = consumePaperCode(ownedCodes, key, code);
            setOwnedCodes(next);
            savePaperCodeMap(next);
            await load(courseFilter || undefined);
            return;
          }
        } catch {
          // try the next code this device holds, if any
        }
      }
      setError('That paper could not be removed — it may already have been taken down.');
    } finally {
      setRemoving(false);
    }
  };

  // ---- Course drill-down: Course → Papers → Practice ----
  if (openCourse) {
    return (
      <div className="space-y-6">
        <button
          onClick={() => setOpenCourse(null)}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-zinc-500 hover:text-zinc-900 transition cursor-pointer"
        >
          <ChevronLeft className="h-4 w-4" /> All papers
        </button>

        {loading && <LoadingBlock />}
        {!loading && practiceSet && (
          <>
            <div className="bg-white border border-zinc-200 rounded-3xl p-6 sm:p-8 shadow-xl">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-2xl acc-soft acc-text border acc-border"><GraduationCap className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-extrabold text-zinc-900 tracking-tight font-mono">{practiceSet.courseCode}</h2>
                  {practiceSet.courseTitle && <p className="text-xs text-zinc-500 font-medium mt-0.5">{practiceSet.courseTitle}</p>}
                </div>
              </div>
              {practiceProgress(practiceSet) && (
                <div className="mt-4">
                  <div className="flex items-center justify-between text-[11px] text-zinc-500 font-bold">
                    <span>Practice progress</span>
                    <span>{practiceProgress(practiceSet)!.done}/{practiceProgress(practiceSet)!.total} solved</span>
                  </div>
                  <div className="mt-1.5 h-2 rounded-full bg-zinc-100 overflow-hidden">
                    <div className="h-full acc-bg rounded-full transition-all" style={{ width: `${practiceProgress(practiceSet)!.percent}%` }} />
                  </div>
                </div>
              )}
              <div className="mt-5 flex flex-wrap gap-2">
                <span className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-white text-zinc-900 border border-zinc-200">
                  {practiceSet.items.length} paper{practiceSet.items.length === 1 ? '' : 's'}
                </span>
                {practiceSet.items.filter((i) => i.solved).length > 0 && (
                  <span className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-700 border border-emerald-500/25">
                    {practiceSet.items.filter((i) => i.solved).length} solved
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-3">
              {practiceSet.items.map(({ paper, solved: isSolved }) => (
                <PaperRow
                  key={paper.id}
                  paper={paper}
                  bookmarked={bookmarks.has(paper.id)}
                  solved={isSolved}
                  onToggleBookmark={() => setBookmarks(new Set(toggleBookmark(paper.id)))}
                  onToggleSolved={() => setSolved(new Set(toggleSolved(paper.id)))}
                  onRemove={canRemovePaper(ownedCodes, paperKey(paper)) ? () => void remove(paper) : undefined}
                />
              ))}
            </div>
          </>
        )}
        {!loading && !practiceSet && (
          <EmptyState
            icon={<FileText className="h-8 w-8 text-zinc-600 mx-auto mb-2" />}
            title="No papers for this course"
            body="Share the first paper to start a practice set for your batchmates."
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-extrabold text-zinc-900 tracking-tight">Question Paper Bank</h2>
          <p className="text-sm text-zinc-500 font-medium mt-1">
            Past papers shared by VIT Chennai students — search by course code, build practice sets
          </p>
        </div>
        <button
          onClick={() => setShowShare((s) => !s)}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl acc-bg text-zinc-900 text-xs font-bold acc-glow hover:opacity-90 transition cursor-pointer"
        >
          <Plus className="h-4 w-4" /> Share a Paper
        </button>
      </div>

      {error && (
        <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-700 text-xs flex items-center gap-2">
          <WifiOff className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Share form (unchanged community flow) */}
      {showShare && (
        <div className="bg-white border border-zinc-200 rounded-3xl p-6 sm:p-8 shadow-xl">
          <h3 className="text-base font-bold text-zinc-900 mb-4">Share a paper</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Course code *">
              <input value={courseCode} onChange={(e) => setCourseCode(e.target.value)} placeholder="e.g. BAEEE102" className={inputCls} />
            </Field>
            <Field label="Course title">
              <input value={courseTitle} onChange={(e) => setCourseTitle(e.target.value)} placeholder="e.g. Electrical Circuit Analysis" className={inputCls} />
            </Field>
            <Field label="Exam type">
              <select value={examType} onChange={(e) => setExamType(e.target.value)} className={inputCls}>
                <option>CAT-1</option>
                <option>CAT-2</option>
                <option>FAT</option>
                <option>Assignment</option>
                <option>Quiz</option>
                <option>Lab FAT</option>
                <option>Other</option>
              </select>
            </Field>
            <Field label="Uploaded by (optional)">
              <input value={uploadedBy} onChange={(e) => setUploadedBy(e.target.value)} placeholder="anonymous" className={inputCls} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Title *">
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. CAT 1 — May 2024" className={inputCls} />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Link to the paper * (Google Drive / OneDrive / direct URL)">
                <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://drive.google.com/…" className={inputCls} />
              </Field>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-[10px] text-zinc-500 flex items-center gap-1.5">
              <ShieldAlert className="h-3.5 w-3.5" /> No personal data stored. A paper you share can only be removed from this device.
            </p>
            <button
              onClick={() => void submit()}
              disabled={sharing || !courseCode.trim() || !title.trim() || !url.trim()}
              className="px-5 py-2 rounded-xl acc-bg text-zinc-900 text-xs font-bold acc-glow hover:opacity-90 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {sharing ? 'Sharing…' : 'Share Paper'}
            </button>
          </div>
          {sharedNotice && (
            <div className="mt-4 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-700 text-xs">
              {sharedNotice}
            </div>
          )}
        </div>
      )}

      {/* Recent papers — honest recency from real upload timestamps */}
      {!loading && recents.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2">
            <Flame className="h-3.5 w-3.5 text-amber-600" /> Recently shared
          </div>
          <div className="flex flex-wrap gap-2">
            {recents.map((p) => (
              <button
                key={p.id}
                onClick={() => { setCourseFilter(p.course_code); setQuery(''); setExamTypeFilter(''); setBookmarkFilter(null); setSolvedFilter(null); }}
                className="px-3 py-1.5 rounded-xl bg-white border border-zinc-200 text-[11px] font-bold text-zinc-900 hover:border-zinc-300 transition cursor-pointer"
                title={`${p.course_code} — open its papers`}
              >
                <span className="font-mono">{p.course_code}</span>
                {(p.exam_type || '').trim() && <span className="text-zinc-500 font-medium"> · {p.exam_type}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Search + filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
          <input
            aria-label="Search question papers"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search course code, title, exam type…"
            className="w-full pl-9 pr-3 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-900 placeholder-zinc-500 outline-none focus:border-blue-500/60 transition"
          />
        </div>
        <select
          aria-label="Filter by course"
          value={courseFilter}
          onChange={(e) => setCourseFilter(e.target.value)}
          className="px-3 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-900 outline-none focus:border-blue-500/60 cursor-pointer"
        >
          <option value="">All courses</option>
          {courses.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select
          aria-label="Filter by solved status"
          value={solvedFilter === null ? '' : solvedFilter ? 'solved' : 'unsolved'}
          onChange={(e) => setSolvedFilter(e.target.value === '' ? null : e.target.value === 'solved')}
          className="px-3 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-900 outline-none focus:border-blue-500/60 cursor-pointer"
        >
          <option value="">Solved: all</option>
          <option value="solved">Solved</option>
          <option value="unsolved">Unsolved</option>
        </select>
        <button
          onClick={() => setBookmarkFilter((v) => (v === null ? true : null))}
          className={`inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl border text-xs font-bold transition cursor-pointer ${bookmarkFilter ? 'acc-soft acc-text border acc-border' : 'bg-white border-zinc-200 text-zinc-500 hover:border-zinc-300'}`}
          title="Show bookmarked papers only"
        >
          <Bookmark className={`h-4 w-4 ${bookmarkFilter ? 'fill-current' : ''}`} /> Saved
        </button>
      </div>

      {/* Exam-type chips — only types that actually exist in the data */}
      {!loading && examTypes.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Chip active={examTypeFilter === ''} onClick={() => setExamTypeFilter('')}>All types</Chip>
          {examTypes.map((t) => (
            <Chip key={t} active={examTypeFilter === t} onClick={() => setExamTypeFilter(examTypeFilter === t ? '' : t)}>{t}</Chip>
          ))}
        </div>
      )}

      {loading && <LoadingBlock />}

      {!loading && filtered.length === 0 && (
        <EmptyState
          icon={<FileText className="h-8 w-8 text-zinc-600 mx-auto mb-2" />}
          title={papers.length === 0 ? 'No papers shared yet' : 'No papers match these filters'}
          body={
            papers.length === 0
              ? 'Share the first one to help your batchmates.'
              : bookmarkFilter
                ? 'No bookmarked papers yet — tap the bookmark icon on any paper to save it here.'
                : 'Try a different search or clear the filters.'
          }
          onClear={
            papers.length > 0 && (query || courseFilter || examTypeFilter || bookmarkFilter !== null || solvedFilter !== null)
              ? () => { setQuery(''); setCourseFilter(''); setExamTypeFilter(''); setBookmarkFilter(null); setSolvedFilter(null); }
              : undefined
          }
        />
      )}

      {!loading && filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((p) => (
            <PaperRow
              key={p.id}
              paper={p}
              bookmarked={bookmarks.has(p.id)}
              solved={solved.has(p.id)}
              onToggleBookmark={() => setBookmarks(new Set(toggleBookmark(p.id)))}
              onToggleSolved={() => setSolved(new Set(toggleSolved(p.id)))}
              onRemove={canRemovePaper(ownedCodes, paperKey(p)) ? () => void remove(p) : undefined}
              onOpenCourse={(code) => { setOpenCourse(code); setCourseFilter(''); setExamTypeFilter(''); setBookmarkFilter(null); setSolvedFilter(null); }}
            />
          ))}
        </div>
      )}

      {!loading && papers.length > 0 && filtered.length < papers.length && (
        <p className="text-[11px] text-zinc-500">
          Showing {filtered.length} of {papers.length} papers — refine your search to narrow down.
        </p>
      )}

      <div className="flex items-center gap-2 text-[10px] text-zinc-600 p-3 bg-white border border-zinc-200 rounded-2xl">
        <Upload className="h-3.5 w-3.5 shrink-0" />
        <span>
          Community-contributed archive — papers are not official unless marked so. Always cross-check with your faculty.
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

export function PaperRow({ paper, bookmarked, solved, onToggleBookmark, onToggleSolved, onRemove, onOpenCourse }: {
  key?: React.Key;
  paper: QnPaper;
  bookmarked: boolean;
  solved: boolean;
  onToggleBookmark: () => void;
  onToggleSolved: () => void;
  /** Present only when THIS device holds the paper's removal code. */
  onRemove?: () => void;
  onOpenCourse?: (code: string) => void;
}) {
  const meta = paperMetaLine(paper);
  return (
    <div className={`bg-white border rounded-3xl p-5 hover:border-zinc-200 transition ${solved ? 'border-emerald-500/25' : 'border-zinc-200'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {onOpenCourse ? (
            <button onClick={() => onOpenCourse(paper.course_code)} className="font-mono font-bold text-zinc-900 text-sm hover:underline cursor-pointer" title="Open this course's papers">
              {paper.course_code}
            </button>
          ) : (
            <p className="font-mono font-bold text-zinc-900 text-sm">{paper.course_code}</p>
          )}
          {paper.course_title && <p className="text-[11px] text-zinc-500 truncate mt-0.5">{paper.course_title}</p>}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onToggleBookmark}
            aria-label={bookmarked ? 'Remove bookmark' : 'Bookmark this paper'}
            aria-pressed={bookmarked}
            className={`p-1.5 rounded-lg transition cursor-pointer ${bookmarked ? 'text-amber-600 bg-amber-500/10' : 'text-zinc-600 hover:text-amber-600 hover:bg-amber-500/10'}`}
          >
            <Bookmark className={`h-4 w-4 ${bookmarked ? 'fill-current' : ''}`} />
          </button>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase ${paper.exam_type?.trim() ? 'acc-soft acc-text acc-border' : 'bg-white text-zinc-500 border-zinc-200'}`}>
            {paper.exam_type?.trim() || 'Paper'}
          </span>
        </div>
      </div>
      <p className="mt-2.5 text-sm text-zinc-900 font-medium">{paper.title}</p>
      {/* Only known metadata is rendered — never invented. */}
      {meta.length > 0 && (
        <p className="mt-1 text-[10px] text-zinc-500">{meta.join(' · ')}</p>
      )}
      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          onClick={onToggleSolved}
          aria-pressed={solved}
          className={`inline-flex items-center gap-1.5 text-[11px] font-bold rounded-xl px-3 py-1.5 border transition cursor-pointer ${solved ? 'bg-emerald-500/10 text-emerald-700 border-emerald-500/25' : 'bg-white text-zinc-500 border-zinc-200 hover:text-emerald-700'}`}
        >
          {solved ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
          {solved ? 'Solved' : 'Mark solved'}
        </button>
        <div className="flex items-center gap-1.5">
          {onRemove && (
            <button
              onClick={onRemove}
              className="p-1.5 rounded-lg text-zinc-600 hover:text-rose-600 hover:bg-rose-500/10 transition cursor-pointer"
              title="Remove this paper (only this device can)"
              aria-label={`Remove paper ${paper.title}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          <a
            href={paper.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl acc-soft acc-text border acc-border text-[11px] font-bold hover:opacity-90 transition cursor-pointer"
          >
            <ExternalLink className="h-3 w-3" /> Open
          </a>
        </div>
      </div>
    </div>
  );
}

function Chip({ active, onClick, children }: { key?: React.Key; active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`px-3 py-1.5 rounded-xl border text-[11px] font-bold transition cursor-pointer ${active ? 'acc-soft acc-text acc-border' : 'bg-white border-zinc-200 text-zinc-500 hover:border-zinc-300'}`}
    >
      {children}
    </button>
  );
}

export function EmptyState({ icon, title, body, onClear }: { icon: React.ReactNode; title: string; body: string; onClear?: () => void }) {
  return (
    <div className="p-10 bg-white border border-zinc-200 rounded-3xl text-center">
      {icon}
      <p className="text-sm font-bold text-zinc-900">{title}</p>
      <p className="text-[11px] text-zinc-500 mt-1 max-w-xs mx-auto">{body}</p>
      {onClear && (
        <button onClick={onClear} className="mt-3 inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-white border border-zinc-200 text-[11px] font-bold text-zinc-900 hover:border-zinc-300 transition cursor-pointer">
          <X className="h-3.5 w-3.5" /> Clear filters
        </button>
      )}
    </div>
  );
}

function LoadingBlock() {
  return (
    <div className="flex items-center justify-center py-16 text-zinc-500">
      <Loader2 className="h-6 w-6 animate-spin mr-3" />
      <span className="text-sm font-medium">Loading papers…</span>
    </div>
  );
}

const inputCls =
  'w-full px-3 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-900 placeholder-zinc-500 outline-none focus:border-blue-500/60 transition';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wide text-zinc-500 font-bold block mb-1.5">{label}</span>
      {children}
    </label>
  );
}
