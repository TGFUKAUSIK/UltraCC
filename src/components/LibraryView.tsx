import React, { useEffect, useState } from 'react';
import { ArrowLeft, BookOpen, Info, Search, Loader2, MapPin, Clock, ChevronRight } from 'lucide-react';
import { searchLibraryCatalogue, fetchBookDetail, type Book, type BookDetail } from '../lib/campusClient';
import { formatSyncStamp } from '../utils/timestamp';

/**
 * LibraryView — the VIT Central Library catalogue as a searchable list. A book
 * is one row (cover, title, author, ISBN), the record opens as a single plate
 * with the holdings as rows beneath it. Nothing here is a card grid.
 */
export const LibraryView: React.FC = () => {
  const [query, setQuery] = useState('');
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [selected, setSelected] = useState<Book | null>(null);
  const [detail, setDetail] = useState<BookDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  useEffect(() => {
    const q = query.trim();
    if (!q) { setBooks([]); setError(''); setStale(false); setSyncedAt(null); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true); setError(''); setStale(false);
      try {
        const result = await searchLibraryCatalogue(q);
        if (controller.signal.aborted) return;
        setBooks(result.data ?? []);
        setStale(result.stale);
        setSyncedAt(result.syncedAt);
        setError(result.data ? (result.error ?? '') : (result.error || 'The library catalogue is not answering right now. Try your search again in a moment.'));
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setError('The library catalogue is not answering right now. Try your search again in a moment.');
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query]);

  const openBook = async (book: Book) => {
    setSelected(book); setDetail(null); setDetailError(''); setDetailLoading(true);
    try {
      const result = await fetchBookDetail(book.biblionumber);
      if (!result.data) throw new Error(result.error || 'unavailable');
      setDetail(result.data);
      if (result.stale) setDetailError('Showing the copies this device last received, not the live shelf.');
    } catch {
      setDetailError('Detailed holdings are not answering right now. The catalogue entry above is still correct.');
    }
    finally { setDetailLoading(false); }
  };

  // The stamp says how far the results are behind the shelf, so it reads as
  // distance ("today, 4:10 pm") instead of a locale-dependent date.
  const syncedLabel = syncedAt
    ? `Catalogue updated ${formatSyncStamp(syncedAt)}${stale ? ' · from the last copy on this device' : ''}`
    : '';

  const trimmed = query.trim();

  if (selected) {
    const title = detail?.title || selected.title;
    const author = detail?.author || selected.author || 'Author not listed';
    const cover = selected.coverUrl;
    return (
      <div className="uc-dir-view">
        <section className="uc-plate">
          <div className="uc-dir-detail">
            <button className="uc-dir-back" onClick={() => { setSelected(null); setDetail(null); }}>
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Back to results
            </button>
            <div className="uc-dir-head-row">
              {cover
                ? <img className="uc-dir-cover" src={cover} alt="" />
                : <span className="uc-dir-cover uc-dir-cover--flat"><BookOpen className="h-6 w-6" /></span>}
              <div className="uc-dir-main">
                <h3 className="uc-dir-detail-title">{title}</h3>
                <p className="uc-dir-sub">{author}</p>
                {(detail?.publisher || selected.publisher) && <p className="uc-dir-sub">{detail?.publisher || selected.publisher}</p>}
                {detail?.edition && <p className="uc-dir-sub">{detail.edition}</p>}
                {detail?.isbn && <p className="uc-dir-sub uc-num">ISBN {detail.isbn}</p>}
              </div>
            </div>

            {detail?.summary && <p className="uc-dir-sub uc-dir-sub--block">{detail.summary}</p>}
            {detail?.subjects && detail.subjects.length > 0 && (
              <div className="uc-dir-chips">
                {detail.subjects.map((subject) => <span key={subject} className="uc-dir-tag">{subject}</span>)}
              </div>
            )}

            {detailLoading && <div className="uc-dir-loading"><Loader2 className="h-4 w-4 animate-spin" /> Loading holdings…</div>}
            {detailError && <p className="uc-dir-sub uc-dir-sub--block">{detailError}</p>}

            {detail?.holdings && detail.holdings.length > 0 && (
              <>
                <span className="uc-dir-subhead">Copies &amp; locations</span>
                <div className="uc-dir-ledger">
                  {detail.holdings.map((holding, index) => {
                    const available = holding.status?.toLowerCase().includes('available');
                    return (
                      <div key={holding.itemId || holding.barcode || index} className="uc-dir-row uc-dir-row--acts">
                        <span className="uc-dir-tile"><MapPin className="h-4 w-4" /></span>
                        <div className="uc-dir-main">
                          <span className="uc-dir-title">{holding.shelvingLocation || holding.currentLibrary || 'Location not listed'}</span>
                          {holding.callNumber && <span className="uc-dir-meta">{holding.callNumber}</span>}
                        </div>
                        <span className={`uc-dir-tag ${available ? 'is-good' : 'is-warn'}`}>
                          {holding.status || 'Status not listed'}{holding.dateDue ? ` · due ${holding.dateDue}` : ''}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </section>
        <section className="uc-plate uc-plate--quiet">
          <div className="uc-note-row">
            <Info />
            <span>Titles and holdings come straight from the VIT Central Library catalogue. When the catalogue cannot be reached, the last results this device received are shown and labelled as such.</span>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="uc-dir-view">
      <section className="uc-plate uc-dir-mast">
        <div className="uc-dir-head">
          <div className="uc-dir-id">
            <span className="uc-cap">VIT Central Library</span>
            <h2 className="uc-dir-name">Catalogue</h2>
            <p className="uc-note">Search by title, author or ISBN and see which copy is on the shelf.</p>
          </div>
        </div>
        <div className="uc-dir-tools">
          <div className="uc-dir-search">
            <Search />
            <input
              aria-label="Search the library catalogue"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search title, author or ISBN"
            />
          </div>
          {!loading && trimmed && !error && <span className="uc-dir-count">{books.length} {books.length === 1 ? 'title' : 'titles'}</span>}
        </div>
        {syncedLabel && !loading && <p className="uc-dir-stamp"><Clock />{syncedLabel}</p>}
      </section>

      {loading && (
        <section className="uc-plate">
          <div className="uc-dir-loading"><Loader2 className="h-5 w-5 animate-spin" /> Searching the catalogue…</div>
        </section>
      )}

      {!loading && error && (
        <section className="uc-plate">
          <div className="uc-dir-alert"><Info /><span>{error}</span></div>
        </section>
      )}

      {!loading && !error && !trimmed && (
        <section className="uc-plate">
          <div className="uc-dir-blank">
            <b>Search the shelf.</b> Type a title, an author or an ISBN — results show how many copies the library holds and where each one sits.
          </div>
        </section>
      )}

      {!loading && !error && trimmed && books.length === 0 && (
        <section className="uc-plate">
          <div className="uc-dir-blank">
            <b>Nothing in the catalogue matches “{trimmed}”.</b> The library indexes titles, authors and ISBNs — try fewer words, or search by the author instead of the full title.
            <button className="uc-dir-go" onClick={() => setQuery('')}>Clear search</button>
          </div>
        </section>
      )}

      {!loading && !error && books.length > 0 && (
        <section className="uc-plate uc-dir-ledger">
          {books.map((book) => (
            <button type="button" key={book.biblionumber} onClick={() => openBook(book)} className="uc-dir-row uc-dir-row--media uc-dir-row--acts">
              {book.coverUrl
                ? <img className="uc-dir-cover" src={book.coverUrl} alt="" />
                : <span className="uc-dir-cover uc-dir-cover--flat"><BookOpen className="h-6 w-6" /></span>}
              <div className="uc-dir-main">
                <span className="uc-dir-title">{book.title}</span>
                <span className="uc-dir-meta">{book.author || 'Author not listed'}</span>
                {book.publisher && <span className="uc-dir-meta">{book.publisher}</span>}
                {book.isbn && <span className="uc-dir-meta uc-num">ISBN {book.isbn}</span>}
              </div>
              <span className="uc-dir-acts"><ChevronRight className="h-4 w-4" /></span>
            </button>
          ))}
          <div className="uc-plate-foot">
            <span>Catalogue results</span>
            <span className="uc-num">{books.length}</span>
          </div>
        </section>
      )}

      <section className="uc-plate uc-plate--quiet">
        <div className="uc-note-row">
          <Info />
          <span>Titles and holdings come straight from the VIT Central Library catalogue. UltraCC never fills in a book or a shelf that the catalogue did not report.</span>
        </div>
      </section>
    </div>
  );
};
