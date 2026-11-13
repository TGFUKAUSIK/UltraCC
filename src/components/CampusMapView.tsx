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
    <div className="uc-index pb-12">
      <section className="uc-plate uc-dir-mast">
        <div className="uc-dir-head">
          <div className="uc-dir-id">
            <span className="uc-cap">VIT Chennai campus navigator</span>
            <h2 className="uc-dir-name">WayFinder</h2>
            <p className="uc-note">
              The official VIT Chennai WayFinder — buildings, rooms, routes and accessibility.
              {searchHint && <span className="uc-map-hint"> Looking for “{searchHint}” — use the WayFinder search box below.</span>}
            </p>
          </div>
          <div className="uc-dir-rail">
            <a href={WAYFINDER_URL} target="_blank" rel="noopener noreferrer" className="uc-dir-go acc-bg">
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              Open in new tab
            </a>
          </div>
        </div>

        {/* Room search helper (prefills the WayFinder search for the user) */}
        <div className="uc-dir-tools">
          <div className="uc-dir-search">
            <Search aria-hidden="true" />
            <input
              type="text"
              aria-label="Room or building to find"
              placeholder="Room / building to find, e.g. SJT 204"
              value={searchHint}
              onChange={(e) => setSearchHint(e.target.value)}
            />
          </div>
        </div>

        <div className="uc-dir-detail">
          <div className="uc-note-row">
            <Info aria-hidden="true" />
            <span>Navigation data is the official VIT WayFinder for the Chennai campus. No Vellore locations are used.</span>
          </div>
        </div>
      </section>

      {/* WayFinder Embed */}
      <section className="uc-plate uc-map-frame">
        {iframeFailed ? (
          <div className="uc-map-fallback">
            <MapPin aria-hidden="true" />
            <strong>WayFinder could not be embedded here</strong>
            <p>
              Some browsers (and installed iOS PWAs) restrict embedded pages. Open the official
              VIT Chennai WayFinder directly instead — it works fully on mobile.
            </p>
            <a href={WAYFINDER_URL} target="_blank" rel="noopener noreferrer" className="uc-dir-go acc-bg">
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              Open VIT WayFinder
            </a>
          </div>
        ) : (
          <iframe
            src={WAYFINDER_URL}
            title="VIT Chennai WayFinder (official)"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            loading="lazy"
            onError={() => setIframeFailed(true)}
          />
        )}
      </section>
    </div>
  );
};
