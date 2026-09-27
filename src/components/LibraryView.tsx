import React, { useEffect, useState } from 'react';
import { ArrowLeft, BookOpen, Info, Search, Loader2, LibraryBig, MapPin, Clock } from 'lucide-react';
import { searchLibraryCatalogue, fetchBookDetail, type Book, type BookDetail } from '../lib/campusClient';

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
        setError(result.data ? (result.error ?? '') : (result.error || 'The library catalogue is temporarily unavailable.'));
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setError('The library catalogue is temporarily unavailable.');
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
      if (result.stale) setDetailError('Showing the last synced holdings for this record.');
    } catch {
      setDetailError('Detailed holdings are temporarily unavailable. Basic catalogue information is still available.');
    }
    finally { setDetailLoading(false); }
  };

  const syncedLabel = syncedAt
    ? `Last synced ${new Date(syncedAt).toLocaleString()}${stale ? ' · showing cached results' : ''}`
    : '';

  return (
  <div className="space-y-4 pb-12">
    <div className="bg-white border border-zinc-200 rounded-3xl p-6 sm:p-8 shadow-xl">
      <div className="flex items-center gap-3 mb-5">
        <div className="p-2.5 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-600"><BookOpen className="h-6 w-6" /></div>
        <div><h2 className="text-lg font-extrabold text-zinc-900 tracking-tight">VIT Central Library</h2><p className="text-xs text-zinc-500 font-medium">Live catalogue search through the UltraCC library service</p></div>
      </div>
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" /><input aria-label="Search the library catalogue" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search title, author or ISBN" className="w-full rounded-xl border border-zinc-200 bg-white py-2.5 pl-9 pr-3 text-xs text-zinc-900 outline-none focus:border-blue-500" /></div>
      </div>
      {syncedLabel && !loading && <p className="mt-2 flex items-center gap-1.5 text-[10px] font-medium text-zinc-500"><Clock className="h-3 w-3" />{syncedLabel}</p>}
      <div className="mt-4 min-h-[220px]">
        {selected && <div className="mb-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-4"><button onClick={() => { setSelected(null); setDetail(null); }} className="mb-4 inline-flex items-center gap-1.5 text-xs font-bold text-blue-600"><ArrowLeft className="h-3.5 w-3.5" /> Back to results</button><div className="flex gap-3">{selected.coverUrl ? <img src={selected.coverUrl} alt="" className="h-28 w-20 rounded-lg object-cover" /> : <div className="flex h-28 w-20 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600"><BookOpen className="h-7 w-7" /></div>}<div className="min-w-0"><h3 className="text-base font-bold text-zinc-900">{detail?.title || selected.title}</h3><p className="mt-1 text-xs text-zinc-500">{detail?.author || selected.author || 'Author not listed'}</p><p className="mt-1 text-[11px] text-zinc-500">{detail?.publisher || selected.publisher || ''}</p>{detail?.edition && <p className="mt-1 text-[11px] italic text-zinc-500">{detail.edition}</p>}{detail?.isbn && <p className="mt-2 font-mono text-[10px] text-blue-700">ISBN {detail.isbn}</p>}</div></div>{detailLoading && <div className="mt-5 flex items-center gap-2 text-xs text-blue-600"><Loader2 className="h-4 w-4 animate-spin" /> Loading holdings…</div>}{detailError && <p className="mt-4 text-xs text-amber-700">{detailError}</p>}{detail && <div className="mt-5 space-y-4">{detail.summary && <p className="text-xs leading-relaxed text-zinc-900">{detail.summary}</p>}{detail.subjects && detail.subjects.length > 0 && <div className="flex flex-wrap gap-1.5">{detail.subjects.map((subject) => <span key={subject} className="rounded-lg border border-blue-500/20 bg-blue-500/10 px-2 py-1 text-[10px] text-blue-700">{subject}</span>)}</div>}{detail.holdings && detail.holdings.length > 0 && <div><p className="mb-2 text-[10px] font-extrabold uppercase tracking-widest text-zinc-500">Copies &amp; locations</p><div className="space-y-2">{detail.holdings.map((holding, index) => <div key={holding.itemId || holding.barcode || index} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs"><span className="flex items-center gap-1.5 text-zinc-900"><MapPin className="h-3.5 w-3.5 text-blue-600" />{holding.shelvingLocation || holding.currentLibrary || 'Location not listed'}{holding.callNumber ? ` · ${holding.callNumber}` : ''}</span><span className={holding.status?.toLowerCase().includes('available') ? 'text-emerald-600' : 'text-amber-700'}>{holding.status || 'Status not listed'}{holding.dateDue ? ` · due ${holding.dateDue}` : ''}</span></div>)}</div></div>}</div>}</div>}
        {loading && <div className="flex justify-center py-16 text-blue-600"><Loader2 className="h-6 w-6 animate-spin" /></div>}
        {!loading && error && <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-5 text-sm text-rose-700">{error}</div>}
        {!loading && !error && query && books.length === 0 && <div className="rounded-2xl border border-zinc-200 p-8 text-center text-sm text-zinc-500">No books found in the catalogue for this search.</div>}
        {!query && <div className="rounded-2xl border border-dashed border-zinc-200 p-8 text-center text-sm text-zinc-500"><LibraryBig className="mx-auto mb-2 h-8 w-8 text-zinc-600" />Search the VIT Central Library catalogue.</div>}
        <div className="grid gap-3 sm:grid-cols-2">
          {books.map((book) => <button type="button" onClick={() => openBook(book)} key={book.biblionumber} className="flex gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-3 text-left transition hover:border-blue-500/40">
            {book.coverUrl ? <img src={book.coverUrl} alt="" className="h-20 w-14 rounded-lg object-cover" /> : <div className="flex h-20 w-14 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600"><BookOpen className="h-6 w-6" /></div>}
            <div className="min-w-0"><h3 className="truncate text-sm font-bold text-zinc-900">{book.title}</h3><p className="mt-1 truncate text-xs text-zinc-500">{book.author || 'Author not listed'}</p>{book.publisher && <p className="mt-1 truncate text-[11px] text-zinc-500">{book.publisher}</p>}{book.isbn && <p className="mt-2 font-mono text-[10px] text-blue-700">ISBN {book.isbn}</p>}</div>
          </button>)}
        </div>
      </div>
    </div>
    <div className="bg-white border border-zinc-200 rounded-3xl p-5 shadow-xl"><div className="flex items-start gap-2 text-xs text-zinc-500 leading-relaxed"><Info className="h-4 w-4 shrink-0 text-blue-600 mt-0.5" /><span>Book titles and holdings are shown only when the UltraCC library service responds — live results, or the last synced copy when the catalogue is unreachable. UltraCC does not fabricate book records or availability.</span></div></div>
  </div>
  );
};
