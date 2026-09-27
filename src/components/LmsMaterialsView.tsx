import React, { useEffect, useState } from 'react';
import { FileText, Folder, Download, HardDrive, Trash2, CheckCircle2, ExternalLink } from 'lucide-react';
import { LmsMaterial, LmsCourse, CachedMaterial } from '../lib/lms/types';
import { vtopDb } from '../lib/db/vtopDatabase';
import { humanErrorCopy } from '../lib/errorCopy';

interface LmsMaterialsViewProps {
  materials: LmsMaterial[];
  courses: LmsCourse[];
  /** Hard cap for the total offline cache (bytes). Default 200MB. */
  cacheCapBytes?: number;
}

export const DEFAULT_CACHE_CAP = 200 * 1024 * 1024;

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

export const LmsMaterialsView: React.FC<LmsMaterialsViewProps> = ({ materials, courses, cacheCapBytes = DEFAULT_CACHE_CAP }) => {
  const [cached, setCached] = useState<CachedMaterial[]>([]);
  const [downloading, setDownloading] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refreshCache = async () => {
    setCached(await vtopDb.getCachedMaterials());
  };
  useEffect(() => { refreshCache(); }, []);

  const courseName = (id: number) => courses.find((c) => c.courseId === id)?.name || `Course ${id}`;
  const cachedTotal = cached.reduce((s, c) => s + c.sizeBytes, 0);

  /** Download a material through the gateway into the offline cache (3d). */
  const handleCache = async (m: LmsMaterial) => {
    setDownloading(m.materialId);
    setMessage(null);
    try {
      if (!m.downloadUrl) {
        setMessage('This material has no direct download link (folder/URL activities can only be opened online).');
        return;
      }
      const res = await fetch(m.downloadUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const size = blob.size;
      if (cachedTotal + size > cacheCapBytes) {
        setMessage(`Cache full — ${fmtSize(size)} would exceed the ${fmtSize(cacheCapBytes)} cap. Delete old files or raise the limit in Settings.`);
        return;
      }
      await vtopDb.putCachedMaterial({
        materialId: m.materialId,
        courseId: m.courseId,
        fileName: m.name,
        sizeBytes: size,
        blob,
        cachedAt: Date.now(),
      });
      await refreshCache();
      setMessage(`"${m.name}" cached for offline use.`);
    } catch (e) {
      // An HTTP/IndexedDB stack trace in a toast is noise for a student; the
      // actionable part is "it did not cache, retry when online".
      setMessage(humanErrorCopy(e, `Could not cache "${m.name}". Its file may need the LMS session — try again while online.`));
    } finally {
      setDownloading(null);
    }
  };

  const handleDelete = async (m: CachedMaterial) => {
    try {
      await vtopDb.deleteCachedMaterial(m.materialId);
      await refreshCache();
      setMessage(`"${m.fileName}" removed from the offline cache.`);
    } catch (e) {
      setMessage(humanErrorCopy(e, `Could not remove "${m.fileName}" from this device.`));
    }
  };

  return (
    <div className="space-y-6 pb-12">
      <div className="bg-white border border-zinc-200 rounded-3xl p-6 sm:p-8 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-2xl bg-teal-500/10 border border-teal-500/20 text-teal-600">
              <HardDrive className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-xl font-extrabold text-zinc-900 tracking-tight">Course Materials</h2>
              <p className="text-xs text-zinc-500 font-medium">LMS files with offline caching — {fmtSize(cachedTotal)} of {fmtSize(cacheCapBytes)} used</p>
            </div>
          </div>
        </div>

        {message && (
          <div className="mt-4 p-3 rounded-xl bg-white border border-zinc-200 text-xs text-zinc-900">{message}</div>
        )}

        {materials.length === 0 ? (
          <div className="mt-6 p-8 bg-zinc-50 rounded-2xl border border-zinc-200 text-center">
            <FileText className="h-8 w-8 text-zinc-600 mx-auto mb-2" />
            <p className="text-sm font-bold text-zinc-900">No materials synced</p>
            <p className="text-[11px] text-zinc-500 mt-1 max-w-sm mx-auto leading-relaxed">
              Sync your LMS account (Settings → LMS Account) to list course files and cache them for offline use.
            </p>
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            {materials.map((m) => {
              const cachedHit = cached.find((c) => c.materialId === m.materialId);
              return (
                <div key={m.materialId} className="p-4 rounded-2xl border bg-zinc-50 border-zinc-200 flex items-center justify-between gap-3">
                  <div className="flex items-start space-x-3 min-w-0">
                    <div className={`p-2 rounded-xl shrink-0 ${m.fileType === 'folder' ? 'bg-amber-500/10 text-amber-600 border border-amber-500/20' : 'bg-teal-500/10 text-teal-600 border border-teal-500/20'}`}>
                      {m.fileType === 'folder' ? <Folder className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-sm font-bold text-zinc-900 truncate">{m.name}</h4>
                      <p className="text-[11px] text-zinc-500 mt-0.5">{courseName(m.courseId)}</p>
                      <div className="flex flex-wrap items-center gap-2 mt-1.5">
                        {m.fileType && m.fileType !== 'folder' && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500 border border-zinc-200 uppercase">{m.fileType.replace('modtype_', '')}</span>
                        )}
                        {cachedHit && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 border border-emerald-500/30 flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" /> OFFLINE {fmtSize(cachedHit.sizeBytes)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {m.downloadUrl && (
                      <a
                        href={m.downloadUrl}
                        target="_blank"
                        rel="noreferrer"
                        title="Open on LMS (requires your LMS session)"
                        className="p-2 rounded-xl bg-zinc-100 hover:bg-zinc-200 text-zinc-900 transition"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
                    {cachedHit ? (
                      <button
                        onClick={() => handleDelete(cachedHit)}
                        title="Remove from offline cache"
                        className="p-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-700 border border-rose-500/20 transition cursor-pointer"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    ) : (
                      <button
                        onClick={() => handleCache(m)}
                        disabled={downloading === m.materialId}
                        title="Cache for offline use"
                        className="px-3 py-2 rounded-xl acc-bg text-zinc-900 text-xs font-bold transition hover:opacity-90 disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
                      >
                        {downloading === m.materialId ? <span className="animate-pulse">…</span> : <Download className="h-3.5 w-3.5" />}
                        Cache
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {cached.length > 0 && (
          <div className="mt-6 p-4 rounded-2xl bg-zinc-50 border border-zinc-200">
            <p className="text-[10px] font-extrabold uppercase tracking-widest text-zinc-500 mb-2">Offline cache ({fmtSize(cachedTotal)})</p>
            <div className="space-y-1.5">
              {cached.map((c) => (
                <div key={c.materialId} className="flex justify-between text-xs">
                  <span className="text-zinc-900 truncate">{c.fileName}</span>
                  <span className="text-zinc-500 font-mono">{fmtSize(c.sizeBytes)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
