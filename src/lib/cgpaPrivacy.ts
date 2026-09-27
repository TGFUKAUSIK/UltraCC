import { useState } from 'react';

export const CGPA_PRIVACY_KEY = 'ultracc.cgpaHidden';

export function readCgpaHidden(): boolean {
  try {
    return window.localStorage.getItem(CGPA_PRIVACY_KEY) === 'true';
  } catch {
    return false;
  }
}

export function useCgpaPrivacy(): [boolean, (hidden: boolean) => void] {
  // Read the preference during the first render, not one effect later: with
  // `useState(false)` + an effect, every mount painted the real CGPA for a
  // frame before masking it — exactly the exposure the setting exists to stop
  // (shoulder-surfing, screen sharing, a screenshot in that frame).
  const [hidden, setHidden] = useState(readCgpaHidden);
  const update = (next: boolean) => {
    setHidden(next);
    try { window.localStorage.setItem(CGPA_PRIVACY_KEY, String(next)); } catch { /* privacy preference is best-effort */ }
  };
  return [hidden, update];
}
