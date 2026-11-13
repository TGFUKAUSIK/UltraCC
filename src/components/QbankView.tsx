import React, { useEffect, useMemo, useState } from 'react';
import {
  Bookmark, CheckCircle2, ChevronLeft, Circle, ExternalLink, FileText, Loader2, Plus,
  Search, ShieldAlert, Trash2, Upload, WifiOff, X,
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
 * One route, one page, one study workflow. The mast, the shelf switch and the
 * document ledger are shared vocabulary (see the Q-Bank layer in index.css): a
 * paper renders as the same .uc-qb-doc row whichever half of the bank it came
 * from, so the two shelves read as one library rather than two products. The
 * toggle replaces nothing — both shelves keep their own data, their own
 * bookmarks and their own rules, and the choice of which to open with is
 * remembered per device.
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
    <div className="uc-qb-view">
      <section className="uc-plate uc-qb-mast">
        <div className="uc-plate-head">
          <div className="uc-qb-id">
            <span className="uc-cap">Past papers</span>
            <h2 className="uc-qb-name">Question Bank</h2>
            <p className="uc-note">
              Previous-year papers in one searchable shelf — the synced archive, plus what students shared here.
            </p>
          </div>
        </div>
        <div className="uc-seg uc-qb-src" role="tablist" aria-label="Question paper source">
          {([
            ['archive', 'Full archive'],
            ['shared', 'Student-shared'],
          ] as [QbankSource, string][]).map(([value, label]) => (
            <button
              key={value}
              role="tab"
              aria-selected={source === value}
              onClick={() => setSource(value)}
              className={source === value ? 'is-on' : undefined}
            >
              {label}
            </button>
          ))}
        </div>
      </section>
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

/**
 * The only file kind a shared link can prove is the one its own URL names — a
 * Drive or OneDrive URL names nothing, and a guess there would be a lie about
 * what is behind the link. So an extension decides the caption, and its absence
 * leaves the tile plain.
 */
function linkKind(url: string): string | null {
  const path = (url.split(/[?#]/)[0] || '').toLowerCase();
  if (path.endsWith('.pdf')) return 'PDF';
  if (/\.(png|jpe?g|webp|gif|avif)$/.test(path)) return 'IMG';
  if (/\.(docx?|pptx?|xlsx?)$/.test(path)) return 'DOC';
  return null;
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

  const clearFilters = () => {
    setQuery('');
    setCourseFilter('');
    setExamTypeFilter('');
    setBookmarkFilter(null);
    setSolvedFilter(null);
  };

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
    const progress = practiceSet ? practiceProgress(practiceSet) : null;
    return (
      <div className="uc-qb-view">
        <button className="uc-qb-back" onClick={() => setOpenCourse(null)}>
          <ChevronLeft className="h-4 w-4" /> All papers
        </button>

        {loading && (
          <div className="uc-qb-loading"><Loader2 className="h-4 w-4 animate-spin" /> Collecting this course&rsquo;s papers…</div>
        )}

        {!loading && practiceSet && (
          <>
            <section className="uc-plate uc-qb-paper">
              <div className="uc-qb-paper-top">
                <div className="uc-qb-paper-id">
                  <span className="uc-cap">Practice set</span>
                  <h2 className="uc-qb-paper-name uc-num">{practiceSet.courseCode}</h2>
                  {practiceSet.courseTitle && <p className="uc-note">{practiceSet.courseTitle}</p>}
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
                <span className="uc-qb-chip uc-qb-chip--static">{practiceSet.items.length} paper{practiceSet.items.length === 1 ? '' : 's'}</span>
                {practiceSet.items.filter((i) => i.solved).length > 0 && (
                  <span className="uc-qb-chip uc-qb-chip--static is-good">{practiceSet.items.filter((i) => i.solved).length} solved</span>
                )}
              </div>
            </section>

            <section className="uc-plate uc-qb-ledger">
              {practiceSet.items.map(({ paper, solved: isSolved }) => (
                <div className={`uc-qb-doc${isSolved ? ' is-solved' : ''}`} key={paper.id}>
                  <span className="uc-qb-file" aria-hidden="true">
                    <FileText className="h-4 w-4" />
                    {linkKind(paper.url) && <small>{linkKind(paper.url)}</small>}
                  </span>
                  <div className="uc-qb-main">
                    <div className="uc-qb-top">
                      <span className="uc-qb-code">{paper.course_code}</span>
                      <span className={`uc-qb-tag${(paper.exam_type || '').trim() ? '' : ' is-muted'}`}>
                        {paper.exam_type?.trim() || 'Paper'}
                      </span>
                    </div>
                    <button className="uc-qb-doc-name" onClick={() => window.open(paper.url, '_blank', 'noopener,noreferrer')}>
                      {paper.title}
                    </button>
                    <p className="uc-qb-doc-meta">{paperMetaLine(paper).join(' · ') || 'Shared by a student'}</p>
                  </div>
                  <div className="uc-qb-acts">
                    <button
                      className="uc-qb-ico"
                      aria-pressed={bookmarks.has(paper.id)}
                      aria-label={bookmarks.has(paper.id) ? `Remove bookmark from ${paper.title}` : `Bookmark ${paper.title}`}
                      onClick={() => setBookmarks(new Set(toggleBookmark(paper.id)))}
                    >
                      <Bookmark className={`h-4 w-4${bookmarks.has(paper.id) ? ' fill-current' : ''}`} />
                    </button>
                    <button
                      className={`uc-qb-ico${isSolved ? ' is-done' : ''}`}
                      aria-pressed={isSolved}
                      aria-label={isSolved ? `Mark ${paper.title} unsolved` : `Mark ${paper.title} solved`}
                      onClick={() => setSolved(new Set(toggleSolved(paper.id)))}
                    >
                      {isSolved ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
                    </button>
                    {canRemovePaper(ownedCodes, paperKey(paper)) && (
                      <button className="uc-qb-ico" aria-label={`Remove ${paper.title} from this device`} onClick={() => void remove(paper)}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                    <a className="uc-qb-open" href={paper.url} target="_blank" rel="noreferrer">
                      <ExternalLink className="h-3.5 w-3.5" /><span>Open</span>
                    </a>
                  </div>
                </div>
              ))}
              <div className="uc-plate-foot">
                <span>Practice set for <span className="uc-num">{practiceSet.courseCode}</span></span>
              </div>
            </section>
          </>
        )}

        {!loading && !practiceSet && (
          <section className="uc-plate uc-qb-blank">
            <div className="uc-empty">
              <span><b>No papers for this course.</b> Share the first paper to start a practice set for your batchmates.</span>
            </div>
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="uc-qb-view">
      <section className="uc-plate uc-qb-mast">
        <div className="uc-plate-head">
          <div className="uc-qb-id">
            <span className="uc-cap">Student-shared</span>
            <p className="uc-note">Links students posted themselves. A paper can only be removed from the device that shared it.</p>
          </div>
          <button className="uc-qb-act acc-bg" onClick={() => setShowShare((s) => !s)} aria-expanded={showShare}>
            <Plus className="h-4 w-4" /><span>Share a paper</span>
          </button>
        </div>

        {showShare && (
          <div className="uc-qb-form">
            <span className="uc-cap">Share a paper</span>
            <div className="uc-qb-fields">
              <label className="uc-qb-field">
                <span>Course code *</span>
                <input className="uc-qb-input" value={courseCode} onChange={(e) => setCourseCode(e.target.value)} placeholder="e.g. BAEEE102" />
              </label>
              <label className="uc-qb-field">
                <span>Course title</span>
                <input className="uc-qb-input" value={courseTitle} onChange={(e) => setCourseTitle(e.target.value)} placeholder="e.g. Electrical Circuit Analysis" />
              </label>
              <label className="uc-qb-field">
                <span>Exam type</span>
                <select className="uc-qb-input" value={examType} onChange={(e) => setExamType(e.target.value)}>
                  <option>CAT-1</option>
                  <option>CAT-2</option>
                  <option>FAT</option>
                  <option>Assignment</option>
                  <option>Quiz</option>
                  <option>Lab FAT</option>
                  <option>Other</option>
                </select>
              </label>
              <label className="uc-qb-field">
                <span>Uploaded by (optional)</span>
                <input className="uc-qb-input" value={uploadedBy} onChange={(e) => setUploadedBy(e.target.value)} placeholder="anonymous" />
              </label>
              <label className="uc-qb-field uc-qb-field--wide">
                <span>Title *</span>
                <input className="uc-qb-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. CAT 1 — May 2024" />
              </label>
              <label className="uc-qb-field uc-qb-field--wide">
                <span>Link to the paper * (Google Drive / OneDrive / direct URL)</span>
                <input className="uc-qb-input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://drive.google.com/…" />
              </label>
            </div>
            <div className="uc-qb-form-foot">
              <div className="uc-qb-hint">
                <ShieldAlert className="h-3.5 w-3.5" /> No personal data stored. A paper you share can only be removed from this device.
              </div>
              <button
                className="uc-qb-act acc-bg"
                onClick={() => void submit()}
                disabled={sharing || !courseCode.trim() || !title.trim() || !url.trim()}
              >
                {sharing ? 'Sharing…' : 'Share paper'}
              </button>
            </div>
            {sharedNotice && (
              <div className="uc-qb-ok"><CheckCircle2 className="h-4 w-4" /> {sharedNotice}</div>
            )}
          </div>
        )}

        <div className="uc-qb-tools">
          <div className="uc-qb-search">
            <Search className="h-4 w-4" />
            <input
              aria-label="Search question papers"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search course code, title or exam type…"
            />
          </div>
          <select className="uc-qb-select" aria-label="Filter by course" value={courseFilter} onChange={(e) => setCourseFilter(e.target.value)}>
            <option value="">All courses</option>
            {courses.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select
            className="uc-qb-select"
            aria-label="Filter by solved status"
            value={solvedFilter === null ? '' : solvedFilter ? 'solved' : 'unsolved'}
            onChange={(e) => setSolvedFilter(e.target.value === '' ? null : e.target.value === 'solved')}
          >
            <option value="">Solved: all</option>
            <option value="solved">Solved</option>
            <option value="unsolved">Unsolved</option>
          </select>
          <button
            className={`uc-qb-keep${bookmarkFilter ? ' is-on' : ''}`}
            onClick={() => setBookmarkFilter((v) => (v === null ? true : null))}
            aria-pressed={bookmarkFilter === true}
            title="Show bookmarked papers only"
          >
            <Bookmark className={`h-4 w-4${bookmarkFilter ? ' fill-current' : ''}`} /> Saved
          </button>
        </div>

        {!loading && (examTypes.length > 0 || recents.length > 0) && (
          <div className="uc-qb-facets">
            {examTypes.length > 0 && (
              <div className="uc-qb-frow">
                <span className="uc-qb-flabel">Exam</span>
                <button className={`uc-qb-chip${examTypeFilter === '' ? ' is-on' : ''}`} onClick={() => setExamTypeFilter('')}>All</button>
                {examTypes.map((t) => (
                  <button
                    key={t}
                    className={`uc-qb-chip${examTypeFilter === t ? ' is-on' : ''}`}
                    aria-pressed={examTypeFilter === t}
                    onClick={() => setExamTypeFilter(examTypeFilter === t ? '' : t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
            {recents.length > 0 && (
              <div className="uc-qb-frow">
                <span className="uc-qb-flabel">Recent</span>
                {recents.map((p) => (
                  <button
                    key={p.id}
                    className="uc-qb-chip uc-num"
                    onClick={() => { setCourseFilter(p.course_code); setQuery(''); setExamTypeFilter(''); setBookmarkFilter(null); setSolvedFilter(null); }}
                    title={`${p.course_code} — open its papers`}
                  >
                    {p.course_code}
                    {(p.exam_type || '').trim() && <i>{p.exam_type}</i>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {error && (
        <div className="uc-qb-alert" role="alert">
          <WifiOff className="h-4 w-4" />
          <span>{error}</span>
          <button className="uc-qb-clear" onClick={() => void load(courseFilter || undefined)}>Try again</button>
        </div>
      )}

      {loading ? (
        <section className="uc-plate uc-qb-ledger">
          <div className="uc-qb-loading"><Loader2 className="h-4 w-4 animate-spin" /> Loading papers…</div>
        </section>
      ) : filtered.length === 0 ? (
        <section className="uc-plate uc-qb-blank">
          <div className="uc-empty">
            <span>
              <b>{papers.length === 0 ? 'No papers shared yet.' : 'No papers match these filters.'}</b>{' '}
              {papers.length === 0
                ? 'Share the first one to help your batchmates.'
                : bookmarkFilter
                  ? 'No bookmarked papers yet — tap the bookmark on any paper to keep it here.'
                  : 'Try a different search, or clear the filters.'}
            </span>
            {papers.length > 0 && (
              <button className="uc-qb-clear" onClick={clearFilters}><X className="h-3.5 w-3.5" /> Clear filters</button>
            )}
          </div>
        </section>
      ) : (
        <section className="uc-plate uc-qb-ledger">
          {filtered.map((p) => (
            <div className={`uc-qb-doc${solved.has(p.id) ? ' is-solved' : ''}`} key={p.id}>
              <span className="uc-qb-file" aria-hidden="true">
                <FileText className="h-4 w-4" />
                {linkKind(p.url) && <small>{linkKind(p.url)}</small>}
              </span>
              <div className="uc-qb-main">
                <div className="uc-qb-top">
                  <button
                    className="uc-qb-code is-link"
                    onClick={() => { setOpenCourse(p.course_code); clearFilters(); }}
                    title={`Open every ${p.course_code} paper`}
                  >
                    {p.course_code}
                  </button>
                  <span className={`uc-qb-tag${(p.exam_type || '').trim() ? '' : ' is-muted'}`}>
                    {p.exam_type?.trim() || 'Paper'}
                  </span>
                </div>
                <button className="uc-qb-doc-name" onClick={() => window.open(p.url, '_blank', 'noopener,noreferrer')}>
                  {p.title}
                </button>
                <p className="uc-qb-doc-meta">{paperMetaLine(p).join(' · ') || 'Shared by a student'}</p>
              </div>
              <div className="uc-qb-acts">
                <button
                  className="uc-qb-ico"
                  aria-pressed={bookmarks.has(p.id)}
                  aria-label={bookmarks.has(p.id) ? `Remove bookmark from ${p.title}` : `Bookmark ${p.title}`}
                  onClick={() => setBookmarks(new Set(toggleBookmark(p.id)))}
                >
                  <Bookmark className={`h-4 w-4${bookmarks.has(p.id) ? ' fill-current' : ''}`} />
                </button>
                <button
                  className={`uc-qb-ico${solved.has(p.id) ? ' is-done' : ''}`}
                  aria-pressed={solved.has(p.id)}
                  aria-label={solved.has(p.id) ? `Mark ${p.title} unsolved` : `Mark ${p.title} solved`}
                  onClick={() => setSolved(new Set(toggleSolved(p.id)))}
                >
                  {solved.has(p.id) ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
                </button>
                {canRemovePaper(ownedCodes, paperKey(p)) && (
                  <button className="uc-qb-ico" aria-label={`Remove ${p.title} from this device`} onClick={() => void remove(p)}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
                <a className="uc-qb-open" href={p.url} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-3.5 w-3.5" /><span>Open</span>
                </a>
              </div>
            </div>
          ))}
          <div className="uc-plate-foot">
            <span>
              Showing {filtered.length} of {papers.length} paper{papers.length === 1 ? '' : 's'}
              {filtered.length < papers.length ? ' — refine the search to narrow down' : ''}
            </span>
          </div>
        </section>
      )}

      <section className="uc-plate uc-plate--quiet">
        <div className="uc-qb-hint">
          <Upload className="h-3.5 w-3.5" /> Community-contributed archive — papers are not official unless marked so. Always cross-check with your faculty.
        </div>
      </section>
    </div>
  );
}
