import React, { useState } from 'react';
import { MapPin, ExternalLink, Info, Search } from 'lucide-react';

interface CampusMapViewProps {
  /** Room/building hint forwarded from "Locate Room" buttons elsewhere. */
  initialSearch?: string;
}

/**
 * Official VIT Chennai WayFinder (chennaiwayfinder.vit.ac.in) is the only
 * source of campus navigation data used by the app. It is embedded when the
 * browser allows it (no X-Frame-Options / CSP frame-ancestors restriction on
 * the site) with an explicit "Open in WayFinder" action for iOS PWAs and any
 * environment where the iframe is blocked. No coordinates or room mappings
 * are fabricated here.
 */
const WAYFINDER_URL = 'https://chennaiwayfinder.vit.ac.in/';

export const CampusMapView: React.FC<CampusMapViewProps> = ({ initialSearch = '' }) => {
  const [iframeFailed, setIframeFailed] = useState(false);
  const [searchHint, setSearchHint] = useState<string>(initialSearch);

  return (
    <div className="space-y-6 pb-12">
      {/* Header Banner Bento Card */}
      <div className="bg-white border border-zinc-200 rounded-3xl p-6 sm:p-8 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="text-zinc-500 text-xs font-bold uppercase tracking-wider mb-1">
              VIT Chennai Campus Navigator
            </div>
            <h2 className="text-2xl font-extrabold text-zinc-900 flex items-center gap-2 tracking-tight">
              <MapPin className="h-6 w-6 text-amber-600" />
              VIT WayFinder
            </h2>
            <p className="text-sm text-zinc-500 mt-1 font-medium">
              The official VIT Chennai WayFinder — buildings, rooms, routes and accessibility.
              {searchHint && (
                <span className="text-amber-700 font-semibold"> Looking for “{searchHint}” — use the WayFinder search box below.</span>
              )}
            </p>
          </div>

          <a
            href={WAYFINDER_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-amber-500 hover:bg-amber-400 text-zinc-950 rounded-2xl text-sm font-extrabold transition cursor-pointer shadow-lg shadow-amber-900/20"
          >
            <ExternalLink className="h-4 w-4" />
            Open WayFinder in New Tab
          </a>
        </div>

        {/* Room search helper (prefills the WayFinder search for the user) */}
        <div className="relative mt-6 max-w-md">
          <Search className="absolute left-3.5 top-3.5 h-4 w-4 text-zinc-500" />
          <input
            type="text"
            aria-label="Room or building to find"
            placeholder="Room / building to find, e.g. SJT 204"
            value={searchHint}
            onChange={(e) => setSearchHint(e.target.value)}
            className="w-full bg-white border border-zinc-200 rounded-2xl pl-10 pr-4 py-3 text-xs text-zinc-900 placeholder-zinc-500 focus:outline-none focus:border-amber-500 font-medium"
          />
        </div>
        <p className="mt-3 text-[11px] text-zinc-500 flex items-start gap-1.5 font-medium">
          <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-zinc-600" />
          Navigation data is the official VIT WayFinder for the Chennai campus. No Vellore locations are used.
        </p>
      </div>

      {/* WayFinder Embed */}
      <div className="bg-white border border-zinc-200 rounded-3xl p-2 shadow-xl overflow-hidden">
        {iframeFailed ? (
          <div className="flex flex-col items-center justify-center text-center p-12 space-y-3">
            <MapPin className="h-10 w-10 text-amber-600" />
            <h3 className="text-lg font-bold text-zinc-900">WayFinder could not be embedded here</h3>
            <p className="text-xs text-zinc-500 max-w-md leading-relaxed">
              Some browsers (and installed iOS PWAs) restrict embedded pages. Open the official
              VIT Chennai WayFinder directly instead — it works fully on mobile.
            </p>
            <a
              href={WAYFINDER_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 rounded-2xl text-sm font-extrabold transition cursor-pointer"
            >
              Open VIT WayFinder
            </a>
          </div>
        ) : (
          <iframe
            src={WAYFINDER_URL}
            title="VIT Chennai WayFinder (official)"
            className="w-full h-[70vh] min-h-[420px] rounded-2xl border-0 bg-white"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            loading="lazy"
            onError={() => setIframeFailed(true)}
          />
        )}
      </div>
    </div>
  );
};
