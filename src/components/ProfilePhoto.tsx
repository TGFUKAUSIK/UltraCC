import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { getShowProfilePhoto, subscribeShowProfilePhoto } from '../lib/settings';

interface ProfilePhotoProps {
  name?: string | null;
  src?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizes = {
  sm: 'h-8 w-8 text-[11px]',
  md: 'h-11 w-11 text-sm',
  lg: 'h-20 w-20 text-xl',
} as const;

function initialsFor(name?: string | null): string {
  return (name || 'Student').trim().split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'U';
}

/** One account-safe avatar renderer used by every UltraCC identity surface. */
export const ProfilePhoto: React.FC<ProfilePhotoProps> = ({ name, src, size = 'md', className = '' }) => {
  // The "Show VTOP profile picture" preference. When OFF, the real photo is
  // never shown and the initials fallback is displayed instead.
  const showPhotoPref = useSyncExternalStore(subscribeShowProfilePhoto, getShowProfilePhoto);
  const effectiveSrc = showPhotoPref ? src : null;
  const [imageState, setImageState] = useState<'idle' | 'loading' | 'loaded' | 'failed'>(
    effectiveSrc ? 'loading' : 'idle',
  );
  const initials = useMemo(() => initialsFor(name), [name]);
  const imgRef = useRef<HTMLImageElement>(null);

  // Track whether we've already loaded this specific source so re-toggling
  // the preference on doesn't flash through loading→loaded again.
  const loadedSrcRef = useRef<string | null>(null);

  useEffect(() => {
    if (!effectiveSrc) {
      // Preference turned off: hide the image but keep its loaded state cached
      // so turning it back on is instant (no loading flash, no initials flicker).
      setImageState((prev) => prev === 'loaded' ? 'loaded' : 'idle');
      return;
    }
    // Already decoded this exact source? Show immediately.
    if (loadedSrcRef.current === effectiveSrc) {
      setImageState('loaded');
      return;
    }
    // Check if the existing <img> already has the right source decoded.
    const el = imgRef.current;
    if (el && el.src === effectiveSrc && el.complete && el.naturalWidth > 0) {
      loadedSrcRef.current = effectiveSrc;
      setImageState('loaded');
      return;
    }
    setImageState('loading');
  }, [effectiveSrc]);

  // Dev-only diagnostic on failure — safe metadata only (whether a source
  // existed; never its content). The initials fallback never overwrites a
  // valid photo: it renders only when the image genuinely failed or is absent.
  useEffect(() => {
    const devMode = (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV;
    if (imageState === 'failed' && devMode) {
      console.info(`[photo] image load failed; source present: ${effectiveSrc ? 'yes' : 'no'} — falling back to initials`);
    }
  }, [imageState, effectiveSrc]);

  // Only show the image when the preference is ON and it's loaded.
  const showImage = !!effectiveSrc && imageState === 'loaded';
  // Keep the <img> mounted whenever a source URL exists (regardless of the
  // preference toggle) so the browser retains the decoded bitmap. This avoids
  // the unmount/remount cycle that caused initials to flash during on→off→on
  // toggles, making the header name appear to glitch.
  return (
    <span className={`profile-photo ${sizes[size]} ${className}`} aria-label={name || 'Student profile photo'}>
      {effectiveSrc && imageState === 'loading' && <span className="profile-photo-skeleton" aria-hidden="true" />}
      {src && (
        <img
          ref={imgRef}
          src={src}
          alt=""
          className={showImage ? 'profile-photo-image is-loaded' : 'profile-photo-image'}
          onLoad={() => {
            loadedSrcRef.current = src;
            setImageState('loaded');
          }}
          onError={() => {
            // Spurious errors happen when src swaps mid-decode; if the element
            // is actually complete with real dimensions, trust the pixels.
            const el = imgRef.current;
            if (el && el.complete && el.naturalWidth > 0) {
              loadedSrcRef.current = src;
              setImageState('loaded');
            } else {
              setImageState('failed');
            }
          }}
        />
      )}
      {!showImage && <span className="profile-photo-initials">{initials}</span>}
    </span>
  );
};
