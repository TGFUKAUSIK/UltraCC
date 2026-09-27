import React, { useEffect, useMemo, useRef, useState } from 'react';

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
  const [imageState, setImageState] = useState<'loading' | 'loaded' | 'failed'>(src ? 'loading' : 'failed');
  const initials = useMemo(() => initialsFor(name), [name]);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    setImageState(src ? 'loading' : 'failed');
  }, [src]);

  // Data-URI images can finish decoding before React's onLoad listener is
  // attached (they need no network). If the element is already complete with
  // real dimensions, promote it to loaded directly — otherwise a perfectly
  // valid photo renders forever as 'loading' and the initials stay visible.
  useEffect(() => {
    const el = imgRef.current;
    if (el && el.complete && el.naturalWidth > 0) setImageState('loaded');
  }, [src]);

  // Dev-only diagnostic on failure — safe metadata only (whether a source
  // existed; never its content). The initials fallback never overwrites a
  // valid photo: it renders only when the image genuinely failed or is absent.
  useEffect(() => {
    const devMode = (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV;
    if (imageState === 'failed' && devMode) {
      console.info(`[photo] image load failed; source present: ${src ? 'yes' : 'no'} — falling back to initials`);
    }
  }, [imageState, src]);

  const showImage = !!src && imageState === 'loaded';
  return (
    <span className={`profile-photo ${sizes[size]} ${className}`} aria-label={name || 'Student profile photo'}>
      {src && imageState === 'loading' && <span className="profile-photo-skeleton" aria-hidden="true" />}
      {src && (
        <img
          ref={imgRef}
          src={src}
          alt=""
          className={showImage ? 'profile-photo-image is-loaded' : 'profile-photo-image'}
          onLoad={() => setImageState('loaded')}
          onError={() => {
            // Spurious errors happen when src swaps mid-decode; if the element
            // is actually complete with real dimensions, trust the pixels.
            const el = imgRef.current;
            if (el && el.complete && el.naturalWidth > 0) setImageState('loaded');
            else setImageState('failed');
          }}
        />
      )}
      {!showImage && <span className="profile-photo-initials">{initials}</span>}
    </span>
  );
};
