import React, { useEffect, useState } from 'react';
import { FileText, Folder, Download, HardDrive, Trash2, CheckCircle2, ExternalLink } from 'lucide-react';
import { LmsMaterial, LmsCourse, CachedMaterial } from '../lib/lms/types';
import { vtopDb } from '../lib/db/vtopDatabase';
import { humanErrorCopy } from '../lib/errorCopy';
import { formatFileSize } from '../utils/fileSize';

interface LmsMaterialsViewProps {
  materials: LmsMaterial[];
  courses: LmsCourse[];
  /** Hard cap for the total offline cache (bytes). Default 200MB. */
  cacheCapBytes?: number;
}

export const DEFAULT_CACHE_CAP = 200 * 1024 * 1024;

/**
 * The materials library: one ruled line per file, the course under the name,
 * and the size of what is already on the device beside it. The three actions
 * (open on LMS, cache offline, remove from the cache) are compact and sit in a
 * single column on the right, because a file list is read, not operated.
 */
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
  const usedPct = Math.min(100, Math.round((cachedTotal / cacheCapBytes) * 100));

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
        setMessage(`Cache full — ${formatFileSize(size)} would exceed the ${formatFileSize(cacheCapBytes)} cap. Delete old files or raise the limit in Settings.`);
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
    <section className="uc-plate uc-mat" aria-label="Course materials">
      <div className="uc-plate-head">
        <div className="uc-mat-id">
          <p className="uc-cap">Course files</p>
          <h3 className="uc-mat-title">Materials</h3>
          <p className="uc-note">LMS files you can keep on this device. {formatFileSize(cachedTotal)} of {formatFileSize(cacheCapBytes)} used.</p>
        </div>
        <span className="uc-mat-gauge" aria-hidden="true">
          <HardDrive size={18} />
        </span>
      </div>

      {message && <p className="uc-note-row uc-mat-msg" role="status">{message}</p>}

      {materials.length === 0 ? (
        <div className="uc-empty">
          <span>No materials have been loaded yet. Sync your LMS account in Settings to list course files and keep them offline.</span>
          <FileText size={18} aria-hidden="true" />
        </div>
      ) : (
        <div className="uc-mat-ledger">
          {materials.map((m) => {
            const cachedHit = cached.find((c) => c.materialId === m.materialId);
            const isFolder = m.fileType === 'folder';
            return (
              <article key={m.materialId} className="uc-mat-row">
                <span className={`uc-mat-kind${isFolder ? ' is-folder' : ''}`} aria-hidden="true">
                  {isFolder ? <Folder size={15} /> : <FileText size={15} />}
                </span>
                <div className="uc-mat-main">
                  <h4 className="uc-mat-name">{m.name}</h4>
                  <p className="uc-mat-course">{courseName(m.courseId)}</p>
                  <p className="uc-mat-tags">
                    {m.fileType && !isFolder && (
                      <span className="uc-mat-tag">{m.fileType.replace('modtype_', '')}</span>
                    )}
                    {cachedHit && (
                      <span className="uc-mat-tag is-offline">
                        <CheckCircle2 size={11} aria-hidden="true" /> offline · {formatFileSize(cachedHit.sizeBytes)}
                      </span>
                    )}
                  </p>
                </div>
                <div className="uc-mat-acts">
                  {m.downloadUrl && (
                    <a
                      href={m.downloadUrl}
                      target="_blank"
                      rel="noreferrer"
                      title="Open on LMS (requires your LMS session)"
                      className="uc-mat-act uc-mat-open"
                    >
                      <ExternalLink size={15} aria-hidden="true" />
                    </a>
                  )}
                  {cachedHit ? (
                    <button
                      type="button"
                      onClick={() => handleDelete(cachedHit)}
                      title="Remove from offline cache"
                      aria-label={`Remove ${m.name} from the offline cache`}
                      className="uc-mat-act uc-mat-drop min-h-[44px] min-w-[44px]"
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleCache(m)}
                      disabled={downloading === m.materialId}
                      title="Keep this file on the device"
                      className="uc-mat-act uc-mat-keep"
                    >
                      {downloading === m.materialId ? <span className="uc-mat-pulse">…</span> : <Download size={14} aria-hidden="true" />}
                      {downloading === m.materialId ? 'Saving' : 'Keep'}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {cached.length > 0 && (
        <div className="uc-mat-cache">
          <div className="uc-mat-cache-head">
            <p className="uc-cap">On this device</p>
            <span className="uc-num">{formatFileSize(cachedTotal)}</span>
          </div>
          <span className="uc-mat-bar" aria-hidden="true"><i style={{ width: `${usedPct}%` }} /></span>
          <div className="uc-mat-cache-list">
            {cached.map((c) => (
              <div key={c.materialId} className="uc-mat-cache-row">
                <span className="uc-mat-cache-name">{c.fileName}</span>
                <span className="uc-num">{formatFileSize(c.sizeBytes)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};
